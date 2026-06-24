#!/usr/bin/env python3
import server


def disable_heavy_backend_analyzer(text):
    return None


def lightweight_analyze_text(text):
    text = (text or "").strip()
    if not text:
        return {
            "tokens": [],
            "lookupCount": 0,
            "readableCount": 0,
            "source": "backend_lightweight",
            "notices": ["文本为空。"],
        }

    tokens = server.fallback_tokenize(text)
    lookup_count = sum(1 for token in tokens if token.get("lookup"))
    readable_count = sum(1 for token in tokens if token.get("lookup") and token.get("reading"))
    return {
        "tokens": tokens,
        "lookupCount": lookup_count,
        "readableCount": readable_count,
        "source": "backend_lightweight",
        "notices": ["线上读音由浏览器假名词典处理；后端分析接口保持轻量，避免免费服务内存崩溃。"],
    }


server.janome_tokenize = disable_heavy_backend_analyzer
server.analyze_text = lightweight_analyze_text
server.main()
