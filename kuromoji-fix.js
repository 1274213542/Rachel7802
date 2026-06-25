(() => {
  const PATCH_CACHE_VERSION = "backend-janome-ruby-v1";
  const PATCH_FALLBACK_HINTS = {
    変形: { reading: "へんけい", pos: "名词 / サ变动词", meaning: "变形；改变形状" },
    使っ: { reading: "つか", pos: "动词", meaning: "使用" },
    使う: { reading: "つかう", pos: "动词", meaning: "使用" },
    例文: { reading: "れいぶん", pos: "名词", meaning: "例句" },
    新しい: { reading: "あたらしい", pos: "い形容词", meaning: "新的" },
    資料: { reading: "しりょう", pos: "名词", meaning: "资料" },
    確認: { reading: "かくにん", pos: "名词 / サ变动词", meaning: "确认" },
    長い: { reading: "ながい", pos: "い形容词", meaning: "长的" },
    読み方: { reading: "よみかた", pos: "名词", meaning: "读法" },
    取り扱い: { reading: "とりあつかい", pos: "名词", meaning: "处理；操作；对待" },
    説明: { reading: "せつめい", pos: "名词 / サ变动词", meaning: "说明" },
  };

  state.tokenizerReady = false;
  Object.assign(fallbackWordHints, PATCH_FALLBACK_HINTS);
  fallbackWordsByLength.splice(0, fallbackWordsByLength.length, ...Object.keys(fallbackWordHints).sort((a, b) => b.length - a.length));

  warmTokenizer = function warmTokenizer() {
    if (apiBaseUrl) {
      checkLookupApiStatus();
    }

    if (!apiBaseUrl) {
      setDictionaryStatus("准备中", true);
    }
  };

  getTokenizer = function getTokenizer() {
    if (state.tokenizer) return Promise.resolve(state.tokenizer);
    if (state.tokenizerLoading) return state.tokenizerLoading;

    state.tokenizerLoading = loadKuromojiLibrary()
      .then(
        () =>
          new Promise((resolve, reject) => {
            if (!window.kuromoji) {
              reject(new Error("kuromoji unavailable"));
              return;
            }

            setDictionaryStatus("准备中", false);
            window.kuromoji
              .builder({ dicPath: "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/" })
              .build((error, tokenizer) => {
                if (error) {
                  reject(error);
                  return;
                }
                state.tokenizer = tokenizer;
                state.tokenizerReady = true;
                setDictionaryStatus(
                  apiBaseUrl && state.lookupApiOnline ? "可用" : "可用",
                  true,
                );
                resolve(tokenizer);
              });
          }),
      )
      .catch((error) => {
        state.tokenizerLoading = null;
        state.tokenizerReady = false;
        throw error;
      });

    return state.tokenizerLoading;
  };

  updateOnlineModeHint = function updateOnlineModeHint() {
    if (isStaticDeployment()) {
      setDictionaryStatus("准备中", true);
      elements.analysisStatus.textContent = apiBaseUrl
        ? "连接中"
        : "待分析";
      return;
    }

    if (location.protocol === "file:") {
      if (apiBaseUrl) {
        setDictionaryStatus("准备中", true);
        elements.analysisStatus.textContent = "连接中";
      } else {
        setDictionaryStatus("请使用 http 链接", false);
        elements.analysisStatus.textContent = "请使用 http 链接";
      }
    }
  };

  checkLookupApiStatus = async function checkLookupApiStatus() {
    try {
      const response = await fetchWithTimeout(`${apiBaseUrl}/api/status`, 60000);
      if (!response.ok) throw new Error("status unavailable");
      const payload = await response.json();
      state.lookupApiOnline = Boolean(payload.online);
      if (state.tokenizerReady) {
        setDictionaryStatus(payload.online ? "可用" : "部分可用", true);
      } else {
        setDictionaryStatus(payload.online ? "可用" : "异常", Boolean(payload.online));
      }
    } catch {
      state.lookupApiOnline = false;
      setDictionaryStatus(
        state.tokenizerReady ? "部分可用" : "准备中",
        true,
      );
    }
  };

  analyzeText = async function analyzeText() {
    const text = elements.sourceText.value.trim();
    if (!text) {
      elements.analysisStatus.textContent = "请先输入一段日语文本。";
      return;
    }

    elements.analyzeButton.disabled = true;
    elements.analysisStatus.textContent = "正在分析...";
    hideTooltip();
    closeDetailPanel();

    let tokens;
    let usedAnalysisCache = false;
    let tokenizerFailed = false;
    tokens = loadCachedAnalysis(text);
    if (tokens) {
      usedAnalysisCache = true;
      setDictionaryStatus("可用", true);
    }

    if (!tokens && hasLookupApi()) {
      try {
        elements.analysisStatus.textContent = "正在分析...";
        tokens = await fetchBackendAnalysis(text);
      } catch {
        tokens = null;
      }
    }

    try {
      if (!tokens && !isStaticDeployment()) {
        const tokenizer = await withPatchTimeout(getTokenizer(), isStaticDeployment() ? 12000 : 18000);
        tokens = normalizeKuromojiTokens(text, tokenizer.tokenize(text));
      }
    } catch {
      tokenizerFailed = true;
      tokens = tokens || null;
    }

    if (!tokens) {
      if (tokenizerFailed && isStaticDeployment()) {
        tokens = fallbackTokenize(text);
      }
    }

    if (!tokens) {
      try {
        elements.analysisStatus.textContent = "正在分析...";
        tokens = hasLookupApi() ? await fetchBackendAnalysis(text) : null;
        if (!tokens) throw new Error("no backend analysis");
        if (tokenizerFailed) {
          tokens = chooseMoreReadablePatchTokens(tokens, fallbackTokenize(text));
        }
      } catch {
        tokens = fallbackTokenize(text);
        const statusText = apiBaseUrl
          ? state.lookupApiOnline
            ? "可用"
            : "备用分析"
          : isStaticDeployment()
            ? "备用分析"
            : "备用分析";
        setDictionaryStatus(statusText, Boolean(apiBaseUrl ? state.lookupApiOnline : isStaticDeployment()));
      }
    }

    state.lastText = text;
    state.lastTokens = tokens;
    state.isEditingReader = false;
    state.highlights = loadHighlightsForText(text);
    renderReader(text, tokens);
    saveCachedAnalysis(text, tokens);
    elements.analyzeButton.disabled = false;
    const lookupCount = tokens.filter((token) => token.lookup).length;
    elements.tokenCount.textContent = `${lookupCount} 个可查词`;
    updateAllReadingsButton();
    updateHighlightButtons();
    updateReaderEditButton();
    collapseSourcePanel();
    elements.analysisStatus.textContent = lookupCount
      ? usedAnalysisCache
        ? "分析完成。"
        : "分析完成。"
      : "分析完成，但没有识别到包含汉字的词语。";
  };

  loadCachedAnalysis = function loadCachedAnalysis(text) {
    try {
      const raw = localStorage.getItem(getAnalysisCacheKey(text));
      if (!raw) return null;
      const payload = JSON.parse(raw);
      if (payload.version !== PATCH_CACHE_VERSION || payload.text !== text) return null;
      const tokens = normalizeBackendTokens(text, payload.tokens);
      return tokens.length ? tokens : null;
    } catch {
      return null;
    }
  };

  saveCachedAnalysis = function saveCachedAnalysis(text, tokens) {
    if (!text || !Array.isArray(tokens) || !tokens.length) return;
    try {
      localStorage.setItem(
        getAnalysisCacheKey(text),
        JSON.stringify({
          version: PATCH_CACHE_VERSION,
          savedAt: new Date().toISOString(),
          text,
          tokens: tokens.map(({ id, surface, base, reading, displayReading, rubySegments, pos, start, end, lookup }) => ({
            id,
            surface,
            base,
            reading,
            displayReading,
            rubySegments,
            pos,
            start,
            end,
            lookup,
          })),
        }),
      );
    } catch {
      // Local storage can be full or unavailable in private browsing.
    }
  };

  getAnalysisCacheKey = function getAnalysisCacheKey(text) {
    return `japanese-reader-analysis:${PATCH_CACHE_VERSION}:${getTextFavoriteKey(text)}`;
  };

  buildRubySegments = function buildRubySegments(surface, reading) {
    const word = String(surface || "");
    const hiraganaReading = kanaToHiragana(String(reading || ""));
    if (!word || !hiraganaReading || !hasKanji(word)) return [{ text: word }];

    const chunks = splitKanaKanjiChunks(word);
    const segments = [];
    let readingIndex = 0;

    chunks.forEach((chunk, chunkIndex) => {
      if (chunk.kind === "kana") {
        const kana = kanaToHiragana(chunk.text);
        if (hiraganaReading.startsWith(kana, readingIndex)) {
          readingIndex += kana.length;
        }
        segments.push({ text: chunk.text });
        return;
      }

      let nextKana = "";
      for (let index = chunkIndex + 1; index < chunks.length; index += 1) {
        if (chunks[index].kind === "kana") {
          nextKana = kanaToHiragana(chunks[index].text);
          break;
        }
      }

      let nextIndex = hiraganaReading.length;
      let chunkReading = hiraganaReading.slice(readingIndex);
      if (nextKana) {
        const foundAt = hiraganaReading.indexOf(nextKana, readingIndex);
        if (foundAt >= readingIndex) {
          nextIndex = foundAt;
          chunkReading = hiraganaReading.slice(readingIndex, nextIndex);
        } else {
          nextIndex = hiraganaReading.length;
          chunkReading = hiraganaReading.slice(readingIndex);
        }
      }

      segments.push(chunkReading ? { text: chunk.text, reading: chunkReading } : { text: chunk.text });
      readingIndex = nextIndex;
    });

    return segments;
  };

  function withPatchTimeout(promise, timeout) {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("timeout")), timeout);
      promise.then(
        (value) => {
          window.clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          window.clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  function chooseMoreReadablePatchTokens(primaryTokens, fallbackTokens) {
    return countReadablePatchTokens(fallbackTokens) > countReadablePatchTokens(primaryTokens) ? fallbackTokens : primaryTokens;
  }

  function countReadablePatchTokens(tokens) {
    if (!Array.isArray(tokens)) return 0;
    return tokens.filter((token) => token.lookup && getRubyDisplayReading(token.surface || "", token.reading || "", token.rubySegments)).length;
  }

  function hideTemporaryReadingForMobileToken(token) {
    if (!token || state.showAllReadings) return;
    const key = getReadingKey(token);
    if (state.savedReadingKeys.has(key)) return;
    state.visibleReadingKeys.delete(key);
    applyTokenReadingState(token.id);
  }

  handleTokenClick = function handleTokenClick(event) {
    if (state.isEditingReader) return;
    const tokenElement = event.target.closest(".lookup-token");
    if (!tokenElement) return;
    event.stopPropagation();

    const tokenId = tokenElement.dataset.tokenId;
    const token = state.tokens.get(tokenId);
    if (isTouchMode() && state.mobileOpenTokenId === tokenId && elements.tooltip.classList.contains("visible")) {
      state.mobileOpenTokenId = null;
      cancelTooltipHide();
      hideTooltip();
      clearActiveTokens();
      hideTemporaryReadingForMobileToken(token);
      return;
    }

    clearTemporaryReadings(tokenId);
    showSingleReading(tokenId);
    state.editStartOffset = token?.start || 0;
    state.mobileOpenTokenId = tokenId;
    showTooltipForElement(tokenElement);

    if (isTouchMode()) {
      return;
    }
  };
})();
