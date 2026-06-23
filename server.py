#!/usr/bin/env python3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import Request, urlopen
import argparse
import json
import os
import socket
import ssl


HTTP_TIMEOUT = 8
OPENCC_TS_CHARACTERS_URL = "https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/TSCharacters.txt"
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
MYMEMORY_API_URL = "https://api.mymemory.translated.net/get"
DEFAULT_OPENAI_MODEL = "gpt-5.4-mini"
TRADITIONAL_TO_SIMPLIFIED = {}


class ReaderHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/lookup":
            self.handle_lookup(parsed)
            return
        if parsed.path == "/api/status":
            self.write_json(
                {
                    "online": True,
                    "sources": ["Jisho/JMdict", "Tatoeba", "OpenCC", "MyMemory public TM", "OpenAI API optional"],
                    "openai": "enabled" if os.environ.get("OPENAI_API_KEY") else "missing_api_key",
                    "openaiModel": os.environ.get("OPENAI_MODEL", DEFAULT_OPENAI_MODEL),
                }
            )
            return
        super().do_GET()

    def handle_lookup(self, parsed):
        query = parse_qs(parsed.query)
        word = first(query.get("word")) or first(query.get("surface"))
        surface = first(query.get("surface")) or word
        reading = first(query.get("reading"))
        pos = first(query.get("pos")) or "词语"
        context = first(query.get("context"))
        self.write_json(lookup_entry(word, surface, reading, pos, context))

    def write_json(self, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        return


def first(values):
    return values[0] if values else ""


def lookup_entry(word, surface, reading, pos, context):
    display_word = surface or word
    jisho_entry = fetch_jisho(word or surface)
    tatoeba_examples = fetch_tatoeba_examples(display_word, word)
    ai_definition = fetch_ai_definition(display_word, reading, pos, context)
    memory_definition = None if ai_definition else fetch_mymemory_definition(word, surface)
    has_openai_key = bool(os.environ.get("OPENAI_API_KEY"))

    reference_definitions = []
    source_links = [
        {
            "name": "Tatoeba API",
            "url": "https://api.tatoeba.org/openapi.json",
            "note": "例句来源；只显示查到的真实句子和中文译文，中文译文用 OpenCC 转为简体显示。",
        }
    ]

    if jisho_entry:
        japanese = choose_japanese(jisho_entry, word, surface)
        reading = reading or to_hiragana(japanese.get("reading", ""))
        senses = jisho_entry.get("senses") or []
        reference_definitions = build_reference_definitions(senses)
        pos = translate_pos((senses[0].get("parts_of_speech") or []) if senses else []) or pos
        source_links.insert(
            0,
            {
                "name": "Jisho / JMdict",
                "url": f"https://jisho.org/search/{quote(word or surface)}",
                "note": "用于读音、词性和日英参考；不当作中文释义。",
            },
        )

    has_chinese_definition = bool(ai_definition or memory_definition)
    has_chinese_examples = bool(tatoeba_examples)
    chinese_definitions = []

    if ai_definition:
        chinese_definitions.append(
            {
                "language": "zh-CN",
                "text": ai_definition.get("brief", ""),
                "source": "OpenAI API",
                "kind": "ai_assisted",
            }
        )
        source_links.append(
            {
                "name": "OpenAI API",
                "url": "https://developers.openai.com/api/docs/api-reference/responses/create",
                "note": "AI 辅助日中释义；不是传统词典条目，会明确标注。",
            }
        )
    elif memory_definition:
        chinese_definitions.append(
            {
                "language": "zh-CN",
                "text": memory_definition.get("brief", ""),
                "source": "MyMemory public translation memory",
                "kind": "public_translation_memory",
            }
        )
        source_links.append(
            {
                "name": "MyMemory",
                "url": f"https://mymemory.translated.net/en/ja/zh-CN/{quote(display_word)}",
                "note": "公开翻译记忆兜底；用于给出中文候选，不等同于专业日中词典。",
            }
        )

    return {
        "word": display_word,
        "reading": reading,
        "pos": pos or "词语",
        "brief": build_brief(ai_definition, memory_definition, has_openai_key),
        "status": build_lookup_status(has_chinese_definition, has_openai_key),
        "chineseDefinitions": chinese_definitions,
        "aiDefinition": ai_definition,
        "memoryDefinition": memory_definition,
        "referenceDefinitions": reference_definitions,
        "examples": tatoeba_examples,
        "grammar": ai_definition.get("usage", "") if ai_definition else build_grammar_notice(pos),
        "sources": source_links,
        "notices": build_notices(
            has_chinese_definition,
            has_chinese_examples,
            bool(reference_definitions),
            bool(ai_definition),
            bool(memory_definition),
            has_openai_key,
        ),
    }


def build_brief(ai_definition, memory_definition, has_openai_key):
    if ai_definition:
        return ai_definition.get("brief", "") or "已取得 AI 辅助中文释义"
    if memory_definition:
        return memory_definition.get("brief", "") or "已取得公开翻译记忆候选"
    if not has_openai_key:
        return "AI 日中释义未启用：服务器缺少 OpenAI API key"
    return "暂无可用中文释义：AI 或在线来源本次未返回结果"


def build_lookup_status(has_chinese_definition, has_openai_key):
    if has_chinese_definition:
        return "ok"
    if not has_openai_key:
        return "missing_openai_api_key"
    return "missing_chinese_definition"


def fetch_jisho(word):
    if not word:
        return None

    url = f"https://jisho.org/api/v1/search/words?keyword={quote(word)}"
    try:
        payload = fetch_json(url, "JapaneseReadingAssistant/1.0")
    except Exception:
        return None

    data = payload.get("data") or []
    return data[0] if data else None


def fetch_tatoeba_examples(surface, base):
    query_terms = unique_nonempty([surface, base])
    for term in query_terms:
        params = {
            "lang": "jpn",
            "q": term,
            "trans:lang": "cmn",
            "showtrans:lang": "cmn",
            "is_unapproved": "no",
            "is_orphan": "no",
            "trans:is_unapproved": "no",
            "trans:is_orphan": "no",
            "sort": "relevance",
            "limit": "20",
        }
        url = f"https://api.tatoeba.org/v1/sentences?{urlencode(params)}"
        try:
            payload = fetch_json(url, "JapaneseReadingAssistant/1.0")
        except Exception:
            continue

        examples = parse_tatoeba_examples(payload, term)
        if examples:
            return examples[:3]
    return []


def fetch_mymemory_definition(word, surface):
    query_terms = unique_nonempty([surface, word])
    for term in query_terms:
        params = {"q": term, "langpair": "ja|zh-CN"}
        url = f"{MYMEMORY_API_URL}?{urlencode(params)}"
        try:
            payload = fetch_json(url, "JapaneseReadingAssistant/1.0")
        except Exception:
            continue

        candidate = choose_mymemory_translation(payload, term)
        if candidate:
            return candidate
    return None


def choose_mymemory_translation(payload, term):
    candidates = []
    response_data = payload.get("responseData") or {}
    if response_data.get("translatedText"):
        candidates.append(
            {
                "translation": response_data.get("translatedText"),
                "match": response_data.get("match", 0),
                "quality": 0,
                "usageCount": 0,
                "source": "responseData",
            }
        )

    for item in payload.get("matches") or []:
        if not isinstance(item, dict) or not item.get("translation"):
            continue
        candidates.append(
            {
                "translation": item.get("translation"),
                "match": item.get("match", 0),
                "quality": item.get("quality", 0),
                "usageCount": item.get("usage-count", 0),
                "source": item.get("created-by") or "public corpus",
            }
        )

    scored = []
    for candidate in candidates:
        text = clean_mymemory_translation(candidate.get("translation", ""))
        if not text or contains_kana(text):
            continue

        match = parse_float(candidate.get("match"), 0)
        quality = parse_float(candidate.get("quality"), 0)
        usage_count = parse_float(candidate.get("usageCount"), 0)
        exact_source_text = normalize_compare(text) in {normalize_compare(term), normalize_compare(to_simplified(term))}
        score = match * 100 + min(quality, 100) * 0.2 + min(usage_count, 10)
        if not exact_source_text:
            score += 18
        else:
            score -= 12
        if len(text) <= 12:
            score += 4

        scored.append((score, text, match, candidate.get("source") or "public corpus"))

    if not scored:
        return None

    scored.sort(key=lambda item: item[0], reverse=True)
    _, text, match, source = scored[0]
    return {
        "brief": text,
        "match": round(match, 3),
        "source": source,
    }


def clean_mymemory_translation(text):
    cleaned = to_simplified(str(text or "").strip())
    return " ".join(cleaned.split())


def contains_kana(text):
    return any("ぁ" <= char <= "ゟ" or "ァ" <= char <= "ヿ" for char in text)


def normalize_compare(text):
    return "".join(str(text or "").lower().split())


def parse_float(value, fallback):
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def fetch_ai_definition(word, reading, pos, context):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key or not word:
        return None

    model = os.environ.get("OPENAI_MODEL", DEFAULT_OPENAI_MODEL)
    prompt = {
        "task": "Japanese word lookup for a Chinese-speaking Japanese learner",
        "word": word,
        "reading": reading,
        "part_of_speech": pos,
        "context": context[:1200] if context else "",
        "requirements": [
            "Return Simplified Chinese only, except Japanese example fragments if absolutely needed.",
            "Explain the likely meaning of the Japanese word in this context.",
            "Do not invent sourced example sentences.",
            "If uncertain, say it is context-dependent.",
            "Return strict JSON with keys: brief, meanings, usage, confidence.",
        ],
    }
    body = {
        "model": model,
        "input": [
            {
                "role": "system",
                "content": "你是严谨的日语-中文学习词典助手。只输出 JSON，不要 Markdown。",
            },
            {
                "role": "user",
                "content": json.dumps(prompt, ensure_ascii=False),
            },
        ],
        "max_output_tokens": 700,
    }
    request = Request(
        OPENAI_RESPONSES_URL,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "JapaneseReadingAssistant/1.0",
        },
        method="POST",
    )

    try:
        context_ssl = ssl._create_unverified_context()
        with urlopen(request, timeout=20, context=context_ssl) as response:
            payload = json.loads(response.read().decode("utf-8"))
        text = extract_response_text(payload)
        parsed = json.loads(strip_json_fence(text))
    except Exception:
        return None

    brief = parsed.get("brief") or ""
    meanings = parsed.get("meanings") if isinstance(parsed.get("meanings"), list) else []
    usage = parsed.get("usage") or ""
    confidence = parsed.get("confidence") or "unknown"

    if not brief and meanings:
        brief = "；".join(str(item) for item in meanings[:3])
    if not brief:
        return None

    return {
        "brief": to_simplified(str(brief)),
        "meanings": [to_simplified(str(item)) for item in meanings],
        "usage": to_simplified(str(usage)) if usage else "AI 已生成基础用法说明，但未提供可验证语法来源。",
        "confidence": str(confidence),
        "model": model,
    }


def extract_response_text(payload):
    if payload.get("output_text"):
        return payload["output_text"]

    chunks = []
    for item in payload.get("output", []):
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                chunks.append(content["text"])
    return "\n".join(chunks)


def strip_json_fence(text):
    value = (text or "").strip()
    if value.startswith("```"):
        value = value.strip("`")
        if value.startswith("json"):
            value = value[4:]
    return value.strip()


def fetch_json(url, user_agent):
    request = Request(url, headers={"User-Agent": user_agent})
    context = ssl._create_unverified_context()
    with urlopen(request, timeout=HTTP_TIMEOUT, context=context) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_text(url, user_agent):
    request = Request(url, headers={"User-Agent": user_agent})
    context = ssl._create_unverified_context()
    with urlopen(request, timeout=HTTP_TIMEOUT, context=context) as response:
        return response.read().decode("utf-8")


def parse_tatoeba_examples(payload, term):
    examples = []
    seen = set()
    for item in payload.get("data", []):
        japanese = item.get("text") or ""
        if term and term not in japanese:
            continue

        translation = first_cmn_translation(item.get("translations") or [])
        if not translation:
            continue

        key = (japanese, translation.get("text", ""))
        if key in seen:
            continue
        seen.add(key)

        sentence_id = item.get("id")
        translation_id = translation.get("id")
        examples.append(
            {
                "japanese": japanese,
                "translation": to_simplified(translation.get("text", "")),
                "translationOriginal": translation.get("text", ""),
                "source": "Tatoeba",
                "sentenceId": sentence_id,
                "translationId": translation_id,
                "sourceUrl": f"https://tatoeba.org/en/sentences/show/{sentence_id}" if sentence_id else "https://tatoeba.org/",
            }
        )
    return examples


def first_cmn_translation(groups):
    for group in groups:
        if isinstance(group, dict):
            group = [group]
        if not isinstance(group, list):
            continue
        for item in group:
            if isinstance(item, dict) and item.get("lang") == "cmn" and item.get("text"):
                return item
    return None


def choose_japanese(jisho, word, surface):
    items = jisho.get("japanese") or []
    for item in items:
        if item.get("word") in {word, surface}:
            return item
    return items[0] if items else {}


def build_reference_definitions(senses):
    definitions = []
    for sense in senses[:4]:
        english = [value for value in sense.get("english_definitions", []) if value]
        if not english:
            continue
        parts = translate_pos(sense.get("parts_of_speech") or [])
        definitions.append(
            {
                "language": "en",
                "text": "; ".join(english[:6]),
                "partOfSpeech": parts,
                "source": "Jisho / JMdict",
            }
        )
    return definitions


def translate_pos(parts):
    labels = []
    rules = [
        ("Noun", "名词"),
        ("Suru verb", "サ变动词"),
        ("Transitive verb", "他动词"),
        ("Intransitive verb", "自动词"),
        ("Adverb", "副词"),
        ("Expression", "表达"),
        ("adjective", "形容词"),
    ]
    for part in parts:
        for needle, label in rules:
            if needle.lower() in part.lower() and label not in labels:
                labels.append(label)
    return " / ".join(labels)


def build_grammar_notice(pos):
    if not pos:
        return "暂无可靠语法说明来源。"
    return f"已从词典来源取得词性：{pos}。当前版本不生成词条专属语法说明，避免误导。"


def build_notices(
    has_chinese_definition,
    has_chinese_examples,
    has_reference,
    has_ai_definition=False,
    has_memory_definition=False,
    has_openai_key=False,
):
    notices = []
    if has_ai_definition:
        notices.append("中文释义由 OpenAI API 生成，属于 AI 辅助解释，不是传统日中词典条目。")
    elif has_memory_definition:
        notices.append("中文释义来自 MyMemory 公开翻译记忆，属于兜底候选；建议结合上下文确认。")
    elif not has_openai_key:
        notices.append("当前服务器没有设置 OPENAI_API_KEY，因此不能生成 AI 日中释义。")
    elif not has_chinese_definition:
        notices.append("OpenAI API 已配置，但本次没有返回可用中文释义；可能是密钥、额度、网络或模型响应格式问题。")
    if not has_chinese_examples:
        notices.append("未在 Tatoeba 查到带中文译文的可靠例句。")
    if has_reference:
        notices.append("日英参考来自 Jisho/JMdict，仅作辅助，不计入中文释义。")
    return notices


def to_hiragana(text):
    return "".join(chr(ord(char) - 0x60) if "ァ" <= char <= "ヶ" else char for char in text)


def to_simplified(text):
    if not TRADITIONAL_TO_SIMPLIFIED:
        return text
    return "".join(TRADITIONAL_TO_SIMPLIFIED.get(char, char) for char in text)


def load_opencc_mapping():
    global TRADITIONAL_TO_SIMPLIFIED
    try:
        text = fetch_text(OPENCC_TS_CHARACTERS_URL, "JapaneseReadingAssistant/1.0")
    except Exception:
        TRADITIONAL_TO_SIMPLIFIED = {
            "會": "会",
            "語": "语",
            "學": "学",
            "應": "应",
            "們": "们",
            "說": "说",
            "體": "体",
            "變": "变",
            "個": "个",
        }
        return

    mapping = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "\t" not in line:
            continue
        traditional, simplified_values = line.split("\t", 1)
        simplified = simplified_values.split(" ")[0]
        if len(traditional) == 1 and len(simplified) == 1:
            mapping[traditional] = simplified
    TRADITIONAL_TO_SIMPLIFIED = mapping


def unique_nonempty(values):
    result = []
    for value in values:
        if value and value not in result:
            result.append(value)
    return result


def local_ip():
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        try:
            sock.close()
        except Exception:
            pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()

    load_opencc_mapping()
    server = ThreadingHTTPServer((args.host, args.port), ReaderHandler)
    print(f"Serving on http://127.0.0.1:{args.port}/")
    print(f"Phone URL: http://{local_ip()}:{args.port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
