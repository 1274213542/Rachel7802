(() => {
  const PATCH_CACHE_VERSION = "frontend-kuromoji-ruby-v4";

  state.tokenizerReady = false;

  warmTokenizer = function warmTokenizer() {
    if (apiBaseUrl) {
      checkLookupApiStatus();
    }

    getTokenizer().catch(() => {
      setDictionaryStatus(apiBaseUrl ? "本地假名词典加载失败，后端待验证" : "使用备用分析", false);
    });
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

            setDictionaryStatus("正在加载假名词典", false);
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
                  apiBaseUrl && state.lookupApiOnline ? "假名词典已就绪，后端释义已连接" : "假名词典已就绪",
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
      setDictionaryStatus("正在加载假名词典", true);
      elements.analysisStatus.textContent = apiBaseUrl
        ? "读音会优先使用浏览器假名词典；详细释义和例句会连接后端。"
        : "线上静态版可使用阅读、假名、收藏和标记；联网释义需要后端服务。";
      return;
    }

    if (location.protocol === "file:") {
      if (apiBaseUrl) {
        setDictionaryStatus("正在加载假名词典", true);
        elements.analysisStatus.textContent = "当前是本地文件页，读音优先使用浏览器假名词典；详细释义会连接线上后端。";
      } else {
        setDictionaryStatus("请使用 http 链接", false);
        elements.analysisStatus.textContent = "当前是本地文件模式，无法使用在线查词；请打开局域网 http 链接。";
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
        setDictionaryStatus(payload.online ? "假名词典已就绪，后端释义已连接" : "假名词典已就绪，后端释义异常", true);
      } else {
        setDictionaryStatus(payload.online ? "后端释义已连接，正在加载假名词典" : "后端词典异常", Boolean(payload.online));
      }
    } catch {
      state.lookupApiOnline = false;
      setDictionaryStatus(
        state.tokenizerReady ? "假名词典已就绪，后端释义暂不可用" : "正在加载假名词典",
        Boolean(state.tokenizerReady),
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
    elements.analysisStatus.textContent = "正在加载假名词典并分析文本...";
    hideTooltip();
    closeDetailPanel();

    let tokens;
    let usedAnalysisCache = false;
    tokens = loadCachedAnalysis(text);
    if (tokens) {
      usedAnalysisCache = true;
      setDictionaryStatus("已使用本地分析缓存", true);
    }

    try {
      if (!tokens) {
        const tokenizer = await getTokenizer();
        tokens = normalizeKuromojiTokens(text, tokenizer.tokenize(text));
      }
    } catch {
      tokens = tokens || null;
    }

    if (!tokens) {
      try {
        elements.analysisStatus.textContent = hasLookupApi() ? "本地假名词典失败，正在尝试后端分析..." : "正在分析文本...";
        tokens = hasLookupApi() ? await fetchBackendAnalysis(text) : null;
        if (!tokens) throw new Error("no backend analysis");
      } catch {
        tokens = fallbackTokenize(text);
        const statusText = apiBaseUrl
          ? state.lookupApiOnline
            ? "后端释义已连接，本地假名词典失败"
            : "使用备用分析，后端暂不可用"
          : isStaticDeployment()
            ? "静态版内置分析"
            : "使用备用分析";
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
        ? "已从本地缓存快速完成分析。桌面端悬停查看，点击打开详情；手机端轻触显示或隐藏。"
        : "分析完成。桌面端悬停查看，点击打开详情；手机端轻触显示或隐藏。"
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
