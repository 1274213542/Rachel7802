#!/usr/bin/env python3
import server


def disable_heavy_backend_analyzer(text):
    return None


server.janome_tokenize = disable_heavy_backend_analyzer
server.main()
