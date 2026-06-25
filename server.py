#!/usr/bin/env python3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import Request, urlopen
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
import re
import socket
import ssl

try:
    from janome.tokenizer import Tokenizer as JanomeTokenizer
except Exception:
    JanomeTokenizer = None


HTTP_TIMEOUT = 8
OPENCC_TS_CHARACTERS_URL = "https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/TSCharacters.txt"
OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
MYMEMORY_API_URL = "https://api.mymemory.translated.net/get"
DEFAULT_OPENAI_MODEL = "gpt-5.4-mini"
TRADITIONAL_TO_SIMPLIFIED = {}
JISHO_CACHE = {}
JANOME_TOKENIZER = None

FALLBACK_WORD_HINTS = {
    "昨日": {"reading": "きのう", "pos": "名词", "meaning": "昨天"},
    "今日": {"reading": "きょう", "pos": "名词", "meaning": "今天"},
    "明日": {"reading": "あした", "pos": "名词", "meaning": "明天"},
    "東京": {"reading": "とうきょう", "pos": "名词", "meaning": "东京"},
    "大阪": {"reading": "おおさか", "pos": "名词", "meaning": "大阪"},
    "京都": {"reading": "きょうと", "pos": "名词", "meaning": "京都"},
    "図書館": {"reading": "としょかん", "pos": "名词", "meaning": "图书馆"},
    "学校": {"reading": "がっこう", "pos": "名词", "meaning": "学校"},
    "大学": {"reading": "だいがく", "pos": "名词", "meaning": "大学"},
    "先生": {"reading": "せんせい", "pos": "名词", "meaning": "老师"},
    "学生": {"reading": "がくせい", "pos": "名词", "meaning": "学生"},
    "日本": {"reading": "にほん", "pos": "名词", "meaning": "日本"},
    "日本語": {"reading": "にほんご", "pos": "名词", "meaning": "日语"},
    "中国語": {"reading": "ちゅうごくご", "pos": "名词", "meaning": "中文"},
    "英語": {"reading": "えいご", "pos": "名词", "meaning": "英语"},
    "文章": {"reading": "ぶんしょう", "pos": "名词", "meaning": "文章；文本"},
    "単語": {"reading": "たんご", "pos": "名词", "meaning": "单词"},
    "文法": {"reading": "ぶんぽう", "pos": "名词", "meaning": "语法"},
    "使い方": {"reading": "つかいかた", "pos": "名词", "meaning": "使用方法；用法"},
    "理解": {"reading": "りかい", "pos": "名词 / サ变动词", "meaning": "理解"},
    "勉強": {"reading": "べんきょう", "pos": "名词 / サ变动词", "meaning": "学习"},
    "研究": {"reading": "けんきゅう", "pos": "名词 / サ变动词", "meaning": "研究"},
    "生活": {"reading": "せいかつ", "pos": "名词 / サ变动词", "meaning": "生活"},
    "文化": {"reading": "ぶんか", "pos": "名词", "meaning": "文化"},
    "社会": {"reading": "しゃかい", "pos": "名词", "meaning": "社会"},
}

FALLBACK_WORDS_BY_LENGTH = sorted(FALLBACK_WORD_HINTS, key=len, reverse=True)
PARTICLES = ["から", "まで", "ながら", "こと", "もの", "ため", "よう", "ので", "の", "で", "を", "も", "は", "が", "に", "へ", "と", "や"]
JAPANESE_RUN_RE = re.compile(r"[\u3040-\u30ff\u3400-\u9fff々〆〤]+|[^\u3040-\u30ff\u3400-\u9fff々〆〤]+")
JAPANESE_ONLY_RE = re.compile(r"^[\u3040-\u30ff\u3400-\u9fff々〆〤]+$")


class ReaderHandler(SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/lookup":
            self.handle_lookup(parsed)
            return
        if parsed.path == "/api/analyze":
            query = parse_qs(parsed.query)
            self.write_json(analyze_text(first(query.get("text"))))
            return
        if parsed.path == "/api/status":
            self.write_json(
                {
                    "online": True,
                    "analyzer": "janome" if JanomeTokenizer else "fallback",
                    "sources": ["Janome local dictionary", "Jisho/JMdict", "Tatoeba", "OpenCC", "MyMemory public TM", "OpenAI API optional"],
                    "openai": "enabled" if os.environ.get("OPENAI_API_KEY") else "missing_api_key",
                    "openaiModel": os.environ.get("OPENAI_MODEL", DEFAULT_OPENAI_MODEL),
                }
            )
            return
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/analyze":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(min(length, 120000))
        text = raw.decode("utf-8", errors="replace")
        self.write_json(analyze_text(text))

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


def analyze_text(text):
    text = (text or "").strip()
    notices = []
    if not text:
        return {"tokens": [], "lookupCount": 0, "readableCount": 0, "source": "backend_fallback", "notices": ["文本为空。"]}

    tokens = janome_tokenize(text)
    if tokens:
        source = "backend_janome"
    else:
        tokens = fallback_tokenize(text)
        source = "backend_jisho_enriched"
        enriched_count, skipped_count = enrich_tokens_with_jisho(tokens)
        notices.append("后端完整日语词典未启用，已使用备用分析。")
        if skipped_count:
            notices.append(f"为避免在线查询过慢，本次只补全前 {enriched_count} 个需要联网确认读音的词。")

    lookup_count = sum(1 for token in tokens if token.get("lookup"))
    readable_count = sum(1 for token in tokens if token.get("lookup") and token.get("reading"))
    return {
        "tokens": tokens,
        "lookupCount": lookup_count,
        "readableCount": readable_count,
        "source": source,
        "notices": notices,
    }

def get_janome_tokenizer():
    global JANOME_TOKENIZER
    if not JanomeTokenizer:
        return None
    if JANOME_TOKENIZER is None:
        JANOME_TOKENIZER = JanomeTokenizer()
    return JANOME_TOKENIZER


def janome_tokenize(text):
    tokenizer = get_janome_tokenizer()
    if not tokenizer:
        return []

    tokens = []
    cursor = 0
    index = 0
    try:
        analyzed_tokens = list(tokenizer.tokenize(text))
    except Exception:
        return []

    for analyzed in analyzed_tokens:
        surface = analyzed.surface or ""
        if not surface:
            continue

        found = text.find(surface, cursor)
        if found < 0:
            found = cursor

        if found > cursor:
            skipped = text[cursor:found]
            tokens.append(create_janome_token(skipped, skipped, "", "", cursor, index, False))
            index += 1

        start = found
        end = found + len(surface)
        base = analyzed.base_form if analyzed.base_form and analyzed.base_form != "*" else surface
        reading = to_hiragana(analyzed.reading if analyzed.reading and analyzed.reading != "*" else "")
        pos = translate_janome_pos(analyzed.part_of_speech or "")
        tokens.append(create_janome_token(surface, base, reading, pos, start, index, has_kanji(surface)))
        cursor = end
        index += 1

    if cursor < len(text):
        trailing = text[cursor:]
        tokens.append(create_janome_token(trailing, trailing, "", "", cursor, index, False))

    return tokens


def create_janome_token(surface, base, reading, pos, start, index, lookup):
    ruby_segments = build_ruby_segments(surface, reading)
    return {
        "id": f"token-{index}",
        "surface": surface,
        "base": base or surface,
        "reading": reading,
        "displayReading": "".join(segment.get("reading", "") for segment in ruby_segments if segment.get("reading")),
        "rubySegments": ruby_segments,
        "pos": pos or "词语",
        "start": start,
        "end": start + len(surface),
        "lookup": bool(lookup),
    }


def translate_janome_pos(pos_text):
    primary = (pos_text or "").split(",")[0]
    return {
        "名詞": "名词",
        "動詞": "动词",
        "形容詞": "形容词",
        "形容動詞": "形容动词",
        "副詞": "副词",
        "連体詞": "连体词",
        "接続詞": "接续词",
        "感動詞": "感叹词",
        "助詞": "助词",
        "助動詞": "助动词",
        "記号": "符号",
        "接頭詞": "接头词",
        "フィラー": "填充词",
        "その他": "其他",
    }.get(primary, primary or "词语")


def fallback_tokenize(text):
    tokens = []
    index = 0
    for match in JAPANESE_RUN_RE.finditer(text):
        surface = match.group(0)
        if JAPANESE_ONLY_RE.match(surface):
            split_tokens = tokenize_japanese_run(surface, match.start(), index)
            tokens.extend(split_tokens)
            index += len(split_tokens)
        else:
            tokens.append(create_fallback_token(surface, match.start(), index, False))
            index += 1
    return tokens


def tokenize_japanese_run(run, offset, start_index):
    tokens = []
    cursor = 0
    index = start_index
    while cursor < len(run):
        matched_seed = next((word for word in FALLBACK_WORDS_BY_LENGTH if run.startswith(word, cursor)), "")
        if matched_seed:
            tokens.append(create_fallback_token(matched_seed, offset + cursor, index, True))
            cursor += len(matched_seed)
            index += 1
            continue

        matched_particle = next((particle for particle in PARTICLES if run.startswith(particle, cursor)), "")
        if matched_particle:
            tokens.append(create_fallback_token(matched_particle, offset + cursor, index, False))
            cursor += len(matched_particle)
            index += 1
            continue

        next_cursor = cursor + 1
        while next_cursor < len(run):
            has_seed = any(run.startswith(word, next_cursor) for word in FALLBACK_WORDS_BY_LENGTH)
            has_particle = any(run.startswith(particle, next_cursor) for particle in PARTICLES)
            if has_seed or has_particle or should_split_before(run, cursor, next_cursor):
                break
            next_cursor += 1

        surface = run[cursor:next_cursor]
        tokens.append(create_fallback_token(surface, offset + cursor, index, has_kanji(surface)))
        cursor = next_cursor
        index += 1
    return tokens


def should_split_before(run, cursor, index):
    if index <= cursor or index >= len(run) or not is_kanji_char(run[index]):
        return False
    previous_chunk = run[cursor:index]
    return has_kanji(previous_chunk) and contains_kana(previous_chunk)


def create_fallback_token(surface, start, index, lookup=None):
    hint = FALLBACK_WORD_HINTS.get(surface, {})
    reading = hint.get("reading", "")
    ruby_segments = build_ruby_segments(surface, reading)
    should_lookup = has_kanji(surface) if lookup is None else lookup
    return {
        "id": f"token-{index}",
        "surface": surface,
        "base": surface,
        "reading": reading,
        "displayReading": "".join(segment.get("reading", "") for segment in ruby_segments if segment.get("reading")),
        "rubySegments": ruby_segments,
        "pos": hint.get("pos", "词语"),
        "start": start,
        "end": start + len(surface),
        "lookup": bool(should_lookup),
    }


def enrich_tokens_with_jisho(tokens, max_terms=80):
    unique_terms = []
    for token in tokens:
        surface = token.get("surface", "")
        if not token.get("lookup") or token.get("reading") or not surface:
            continue
        if surface not in unique_terms:
            unique_terms.append(surface)

    skipped_count = max(0, len(unique_terms) - max_terms)
    terms_to_fetch = unique_terms[:max_terms]
    entries_by_term = fetch_jisho_entries_concurrently(terms_to_fetch)

    for term, entry in entries_by_term.items():
        if not entry:
            continue
        japanese = choose_exact_japanese(entry, term)
        if not japanese:
            continue
        reading = build_surface_reading(term, to_hiragana(japanese.get("reading", "")), japanese.get("word", ""))
        ruby_segments = build_ruby_segments(term, reading)
        senses = entry.get("senses") or []
        pos = translate_pos((senses[0].get("parts_of_speech") or []) if senses else [])
        for token in tokens:
            if token.get("surface") == term:
                if reading:
                    token["reading"] = reading
                    token["displayReading"] = "".join(
                        segment.get("reading", "") for segment in ruby_segments if segment.get("reading")
                    )
                    token["rubySegments"] = ruby_segments
                if pos:
                    token["pos"] = pos
    return min(len(unique_terms), max_terms), skipped_count


def fetch_jisho_entries_concurrently(terms, max_workers=8):
    if not terms:
        return {}

    results = {}
    missing_terms = []
    for term in terms:
        if term in JISHO_CACHE:
            results[term] = JISHO_CACHE[term]
        else:
            missing_terms.append(term)

    if not missing_terms:
        return results

    worker_count = min(max_workers, len(missing_terms))
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        future_to_term = {executor.submit(fetch_jisho_cached, term): term for term in missing_terms}
        for future in as_completed(future_to_term):
            term = future_to_term[future]
            try:
                results[term] = future.result()
            except Exception:
                results[term] = None

    return results


def fetch_jisho_cached(word):
    if word not in JISHO_CACHE:
        JISHO_CACHE[word] = fetch_jisho(word)
    return JISHO_CACHE[word]


def build_surface_reading(surface, dictionary_reading, dictionary_word):
    reading = to_hiragana(dictionary_reading or "")
    surface_suffix = kana_suffix_after_last_kanji(surface)
    if not reading or not surface_suffix:
        return reading

    base_suffix = kana_suffix_after_last_kanji(dictionary_word or "")
    stem = reading
    if base_suffix:
        base_suffix = to_hiragana(base_suffix)
        if stem.endswith(base_suffix):
            stem = stem[: -len(base_suffix)]

    overlap = longest_overlap(stem, surface_suffix)
    return stem + surface_suffix[overlap:]


def build_ruby_segments(surface, reading):
    surface = surface or ""
    reading = to_hiragana(reading or "")
    if not surface or not reading or not has_kanji(surface):
        return [{"text": surface}]

    chunks = split_kana_kanji_chunks(surface)
    segments = []
    reading_index = 0

    for chunk_index, chunk in enumerate(chunks):
        text = chunk["text"]
        if chunk["kind"] == "kana":
            kana = to_hiragana(text)
            if reading.startswith(kana, reading_index):
                reading_index += len(kana)
            segments.append({"text": text})
            continue

        next_kana = ""
        for later in chunks[chunk_index + 1 :]:
            if later["kind"] == "kana":
                next_kana = to_hiragana(later["text"])
                break

        if next_kana:
            next_index = reading.find(next_kana, reading_index)
            if next_index >= reading_index:
                chunk_reading = reading[reading_index:next_index]
            else:
                next_index = reading_index
                chunk_reading = ""
        else:
            next_index = len(reading)
            chunk_reading = reading[reading_index:]

        if chunk_reading:
            segments.append({"text": text, "reading": chunk_reading})
        else:
            segments.append({"text": text})
        reading_index = next_index

    return segments


def split_kana_kanji_chunks(text):
    chunks = []
    current = ""
    current_kind = ""
    for char in text:
        kind = "kanji" if is_kanji_char(char) else "kana" if is_kana_char(char) else "other"
        if current and kind != current_kind:
            chunks.append({"kind": current_kind, "text": current})
            current = ""
        current += char
        current_kind = kind
    if current:
        chunks.append({"kind": current_kind, "text": current})
    return chunks


def translate_japanese_pos(pos):
    return {
        "名詞": "名词",
        "動詞": "动词",
        "形容詞": "形容词",
        "形容動詞": "な形容词",
        "副詞": "副词",
        "連体詞": "连体词",
        "接続詞": "接续词",
        "助詞": "助词",
        "助動詞": "助动词",
        "感動詞": "感叹词",
        "記号": "符号",
    }.get(pos, pos or "词语")


def kana_suffix_after_last_kanji(text):
    value = to_hiragana(text or "")
    last_kanji = -1
    for index, char in enumerate(value):
        if has_kanji(char):
            last_kanji = index
    if last_kanji < 0 or last_kanji + 1 >= len(value):
        return ""
    suffix = value[last_kanji + 1 :]
    return suffix if contains_kana(suffix) else ""


def longest_overlap(left, right):
    max_length = min(len(left), len(right))
    for size in range(max_length, 0, -1):
        if left.endswith(right[:size]):
            return size
    return 0


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


def has_kanji(text):
    return any("\u3400" <= char <= "\u9fff" or char in "々〆〤" for char in text)


def is_kanji_char(char):
    return "\u3400" <= char <= "\u9fff" or char in "々〆〤"


def is_kana_char(char):
    return "\u3040" <= char <= "\u30ff"


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


def choose_exact_japanese(jisho, surface):
    target = normalize_compare(surface)
    for item in jisho.get("japanese") or []:
        if normalize_compare(item.get("word", "")) == target:
            return item
    return None


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
