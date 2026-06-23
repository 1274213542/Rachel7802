const state = {
  tokenizer: null,
  tokenizerLoading: null,
  tokens: new Map(),
  lastText: "",
  lastTokens: [],
  lookupCache: new Map(),
  favorites: new Map(),
  textFavorites: new Map(),
  kuromojiScriptLoading: null,
  lookupApiOnline: false,
  visibleReadingKeys: new Set(),
  savedReadingKeys: new Set(),
  highlights: [],
  highlightColor: "lemon",
  lastReaderSelection: null,
  highlightToolbarPointerDown: false,
  isEditingReader: false,
  editStartOffset: 0,
  showAllReadings: false,
  activeTokenId: null,
  mobileOpenTokenId: null,
  tooltipHideTimer: null,
  tooltipPointerInside: false,
  settings: {
    fontSize: 20,
    lineHeight: 2.05,
  },
};

const elements = {
  workspace: document.querySelector("#workspace"),
  inputPanel: document.querySelector("#inputPanel"),
  sourceText: document.querySelector("#sourceText"),
  sourceSummary: document.querySelector("#sourceSummary"),
  sourceToggleButton: document.querySelector("#sourceToggleButton"),
  sourceDockButton: document.querySelector("#sourceDockButton"),
  analyzeButton: document.querySelector("#analyzeButton"),
  allReadingsButton: document.querySelector("#allReadingsButton"),
  readerEditButton: document.querySelector("#readerEditButton"),
  markHighlightButton: document.querySelector("#markHighlightButton"),
  clearHighlightsButton: document.querySelector("#clearHighlightsButton"),
  editSelectionButton: document.querySelector("#editSelectionButton"),
  saveTextButton: document.querySelector("#saveTextButton"),
  clearButton: document.querySelector("#clearButton"),
  reader: document.querySelector("#reader"),
  tooltip: document.querySelector("#tooltip"),
  highlightToolbar: document.querySelector("#highlightToolbar"),
  detailPanel: document.querySelector("#detailPanel"),
  detailContent: document.querySelector("#detailContent"),
  closeDetailButton: document.querySelector("#closeDetailButton"),
  tokenCount: document.querySelector("#tokenCount"),
  analysisStatus: document.querySelector("#analysisStatus"),
  dictionaryStatus: document.querySelector("#dictionaryStatus"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsDrawer: document.querySelector("#settingsDrawer"),
  settingsBackdrop: document.querySelector("#settingsBackdrop"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  fontSizeRange: document.querySelector("#fontSizeRange"),
  fontSizeValue: document.querySelector("#fontSizeValue"),
  lineHeightRange: document.querySelector("#lineHeightRange"),
  lineHeightValue: document.querySelector("#lineHeightValue"),
  resetSettingsButton: document.querySelector("#resetSettingsButton"),
  favoritesButton: document.querySelector("#favoritesButton"),
  favoritesDrawer: document.querySelector("#favoritesDrawer"),
  closeFavoritesButton: document.querySelector("#closeFavoritesButton"),
  drawerBackdrop: document.querySelector("#drawerBackdrop"),
  favoritesList: document.querySelector("#favoritesList"),
  colorSwatches: [...document.querySelectorAll("[data-highlight-color]")],
};

const apiBaseUrl = getConfiguredApiBaseUrl();

const fallbackWordHints = {
  昨日: { reading: "きのう", pos: "名词", meaning: "昨天" },
  東京: { reading: "とうきょう", pos: "名词", meaning: "东京" },
  図書館: { reading: "としょかん", pos: "名词", meaning: "图书馆" },
  日本語: { reading: "にほんご", pos: "名词", meaning: "日语" },
  文章: { reading: "ぶんしょう", pos: "名词", meaning: "文章；文本" },
  単語: { reading: "たんご", pos: "名词", meaning: "单词" },
  文法: { reading: "ぶんぽう", pos: "名词", meaning: "语法" },
  使い方: { reading: "つかいかた", pos: "名词", meaning: "使用方法；用法" },
  理解: { reading: "りかい", pos: "名词 / サ变动词", meaning: "理解" },
};

const fallbackWordsByLength = Object.keys(fallbackWordHints).sort((a, b) => b.length - a.length);

const posLabels = {
  名詞: "名词",
  動詞: "动词",
  形容詞: "い形容词",
  形容動詞: "な形容词",
  副詞: "副词",
  連体詞: "连体词",
  接続詞: "接续词",
  助詞: "助词",
  助動詞: "助动词",
  感動詞: "感叹词",
  記号: "符号",
};

document.addEventListener("DOMContentLoaded", () => {
  loadFavorites();
  loadTextFavorites();
  loadSavedReadings();
  loadSettings();
  bindEvents();
  updateTextFavoriteButton();
  updateAllReadingsButton();
  updateHighlightButtons();
  updateReaderEditButton();
  updateSourceSummary();
  updateOnlineModeHint();
  warmTokenizer();
});

function bindEvents() {
  elements.analyzeButton.addEventListener("click", analyzeText);
  elements.allReadingsButton.addEventListener("click", toggleAllReadings);
  elements.readerEditButton.addEventListener("click", toggleReaderEditMode);
  elements.markHighlightButton.addEventListener("mousedown", keepReaderSelection);
  elements.markHighlightButton.addEventListener("click", markSelectedHighlight);
  elements.clearHighlightsButton.addEventListener("mousedown", keepReaderSelection);
  elements.clearHighlightsButton.addEventListener("click", clearCurrentHighlights);
  elements.editSelectionButton.addEventListener("mousedown", keepReaderSelection);
  elements.editSelectionButton.addEventListener("click", editSelectedText);
  elements.colorSwatches.forEach((button) => {
    button.addEventListener("mousedown", keepReaderSelection);
    button.addEventListener("click", () => selectHighlightColor(button));
  });
  elements.saveTextButton.addEventListener("click", toggleCurrentTextFavorite);
  elements.sourceToggleButton.addEventListener("click", toggleSourcePanel);
  elements.sourceDockButton.addEventListener("click", expandSourcePanel);
  elements.sourceText.addEventListener("input", handleSourceInput);
  elements.clearButton.addEventListener("click", clearInput);
  elements.closeDetailButton.addEventListener("click", closeDetailPanel);
  elements.settingsButton.addEventListener("click", openSettings);
  elements.closeSettingsButton.addEventListener("click", closeSettings);
  elements.settingsBackdrop.addEventListener("click", closeSettings);
  elements.fontSizeRange.addEventListener("input", updateFontSize);
  elements.lineHeightRange.addEventListener("input", updateLineHeight);
  elements.resetSettingsButton.addEventListener("click", resetSettings);
  elements.favoritesButton.addEventListener("click", openFavorites);
  elements.closeFavoritesButton.addEventListener("click", closeFavorites);
  elements.drawerBackdrop.addEventListener("click", closeFavorites);
  elements.reader.addEventListener("pointerover", handlePointerOver);
  elements.reader.addEventListener("pointerout", handlePointerOut);
  elements.reader.addEventListener("click", handleTokenClick);
  elements.reader.addEventListener("dblclick", handleTokenDoubleClick);
  elements.tooltip.addEventListener("pointerenter", handleTooltipPointerEnter);
  elements.tooltip.addEventListener("pointerleave", handleTooltipPointerLeave);
  elements.highlightToolbar.addEventListener("pointerdown", rememberHighlightToolbarPointer);
  elements.highlightToolbar.addEventListener("mousedown", keepReaderSelection);
  document.addEventListener("click", handleOutsideClick);
  document.addEventListener("selectionchange", handleReaderSelectionChange);
  window.addEventListener("resize", positionActiveTooltip);
}

function keepReaderSelection(event) {
  event.preventDefault();
}

function rememberHighlightToolbarPointer() {
  state.highlightToolbarPointerDown = true;
  window.setTimeout(() => {
    state.highlightToolbarPointerDown = false;
  }, 450);
}

function clearInput() {
  elements.sourceText.value = "";
  handleSourceInput();
  expandSourcePanel();
  elements.sourceText.focus();
}

function handleSourceInput() {
  updateTextFavoriteButton();
  if (elements.sourceText.value.trim() !== state.lastText) {
    state.showAllReadings = false;
    state.visibleReadingKeys.clear();
    state.highlights = [];
    state.isEditingReader = false;
    hideHighlightToolbar();
  }
  updateAllReadingsButton();
  updateHighlightButtons();
  updateReaderEditButton();
  updateSourceSummary();
}

function toggleSourcePanel() {
  const collapsed = elements.inputPanel.classList.toggle("collapsed");
  elements.workspace.classList.toggle("source-collapsed", collapsed);
  elements.sourceToggleButton.textContent = collapsed ? "展开输入" : "收起输入";
  updateSourceSummary();
}

function collapseSourcePanel() {
  elements.inputPanel.classList.add("collapsed");
  elements.workspace.classList.add("source-collapsed");
  elements.sourceToggleButton.textContent = "展开输入";
  updateSourceSummary();
}

function expandSourcePanel() {
  elements.inputPanel.classList.remove("collapsed");
  elements.workspace.classList.remove("source-collapsed");
  elements.sourceToggleButton.textContent = "收起输入";
  updateSourceSummary();
  requestAnimationFrame(() => {
    elements.sourceText.focus();
  });
}

function updateSourceSummary() {
  const text = elements.sourceText.value.trim();
  const compact = text.replace(/\s+/g, " ");
  elements.sourceSummary.textContent = compact.length > 90 ? `${compact.slice(0, 90)}...` : compact;
}

async function warmTokenizer() {
  if (isStaticDeployment()) {
    setDictionaryStatus(apiBaseUrl ? "后端词典待验证" : "静态版已就绪", true);
    if (apiBaseUrl) checkLookupApiStatus();
    return;
  }

  try {
    await getTokenizer();
  } catch {
    setDictionaryStatus("使用备用分析", false);
  } finally {
    if (location.protocol === "file:") {
      setDictionaryStatus("查词需 http 链接", false);
    }
  }
}

function getTokenizer() {
  if (isStaticDeployment()) {
    return Promise.reject(new Error("static deployment uses fallback tokenizer"));
  }

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

        setDictionaryStatus("正在加载词典", false);
        window.kuromoji
          .builder({ dicPath: "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/" })
          .build((error, tokenizer) => {
            if (error) {
              reject(error);
              return;
            }
            state.tokenizer = tokenizer;
            setDictionaryStatus("分词词典已就绪", true);
            resolve(tokenizer);
          });
        }),
    )
    .catch((error) => {
      state.tokenizerLoading = null;
      throw error;
    });

  return state.tokenizerLoading;
}

function loadKuromojiLibrary(timeout = 3500) {
  if (window.kuromoji) return Promise.resolve();
  if (state.kuromojiScriptLoading) return state.kuromojiScriptLoading;

  state.kuromojiScriptLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timer = window.setTimeout(() => {
      state.kuromojiScriptLoading = null;
      reject(new Error("kuromoji script timeout"));
    }, timeout);

    script.src = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/build/kuromoji.js";
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      state.kuromojiScriptLoading = null;
      reject(new Error("kuromoji script failed"));
    };
    document.head.append(script);
  });

  return state.kuromojiScriptLoading;
}

function setDictionaryStatus(text, ready) {
  elements.dictionaryStatus.textContent = text;
  elements.dictionaryStatus.classList.toggle("ready", ready);
}

function updateOnlineModeHint() {
  if (isStaticDeployment()) {
    setDictionaryStatus(apiBaseUrl ? "后端词典待验证" : "静态版已就绪", true);
    elements.analysisStatus.textContent = apiBaseUrl
      ? "已配置后端词典地址，正在验证连接。"
      : "线上静态版可使用阅读、假名、收藏和标记；联网释义需要后端服务。";
    return;
  }

  if (location.protocol === "file:") {
    setDictionaryStatus("请使用 http 链接", false);
    elements.analysisStatus.textContent = "当前是本地文件模式，无法使用在线查词；请打开局域网 http 链接。";
  }
}

function isStaticDeployment() {
  return location.hostname.endsWith(".github.io");
}

function hasLookupApi() {
  return location.protocol.startsWith("http") && (!isStaticDeployment() || Boolean(apiBaseUrl));
}

function getConfiguredApiBaseUrl() {
  const params = new URLSearchParams(location.search);
  const fromQuery = normalizeApiBaseUrl(params.get("api"));
  if (fromQuery) {
    localStorage.setItem("japanese-reader-api-base-url", fromQuery);
    return fromQuery;
  }
  return normalizeApiBaseUrl(localStorage.getItem("japanese-reader-api-base-url"));
}

function normalizeApiBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

async function checkLookupApiStatus() {
  try {
    const response = await fetchWithTimeout(`${apiBaseUrl}/api/status`, 60000);
    if (!response.ok) throw new Error("status unavailable");
    const payload = await response.json();
    state.lookupApiOnline = Boolean(payload.online);
    setDictionaryStatus(payload.online ? "后端词典已连接" : "后端词典异常", Boolean(payload.online));
  } catch {
    state.lookupApiOnline = false;
    setDictionaryStatus("后端词典暂不可用", false);
  }
}

function buildLookupApiUrl(params) {
  const path = `/api/lookup?${params.toString()}`;
  return apiBaseUrl ? `${apiBaseUrl}${path}` : path;
}

async function analyzeText() {
  const text = elements.sourceText.value.trim();
  if (!text) {
    elements.analysisStatus.textContent = "请先输入一段日语文本。";
    return;
  }

  elements.analyzeButton.disabled = true;
  elements.analysisStatus.textContent = "正在分析文本...";
  hideTooltip();
  closeDetailPanel();

  let tokens;
  try {
    const tokenizer = await getTokenizer();
    tokens = normalizeKuromojiTokens(text, tokenizer.tokenize(text));
  } catch {
    tokens = fallbackTokenize(text);
    const statusText = apiBaseUrl
      ? state.lookupApiOnline
        ? "后端词典已连接"
        : "后端词典待验证"
      : isStaticDeployment()
        ? "静态版内置分析"
        : "使用备用分析";
    setDictionaryStatus(statusText, Boolean(apiBaseUrl ? state.lookupApiOnline : isStaticDeployment()));
  }

  state.lastText = text;
  state.lastTokens = tokens;
  state.isEditingReader = false;
  state.highlights = loadHighlightsForText(text);
  renderReader(text, tokens);
  elements.analyzeButton.disabled = false;
  const lookupCount = tokens.filter((token) => token.lookup).length;
  elements.tokenCount.textContent = `${lookupCount} 个可查词`;
  updateAllReadingsButton();
  updateHighlightButtons();
  updateReaderEditButton();
  collapseSourcePanel();
  elements.analysisStatus.textContent = lookupCount
    ? "分析完成。桌面端悬停查看，点击打开详情；手机端轻触显示或隐藏。"
    : "分析完成，但没有识别到包含汉字的词语。";
}

function normalizeKuromojiTokens(text, rawTokens) {
  let cursor = 0;
  return rawTokens.map((token, index) => {
    const surface = token.surface_form;
    const foundAt = text.indexOf(surface, cursor);
    const start = foundAt >= 0 ? foundAt : cursor;
    const end = start + surface.length;
    cursor = end;

    const base = token.basic_form && token.basic_form !== "*" ? token.basic_form : surface;
    const reading = token.reading && token.reading !== "*" ? kanaToHiragana(token.reading) : "";
    const pos = posLabels[token.pos] || token.pos || "词语";
    const lookup = hasKanji(surface) && token.pos !== "記号";

    return {
      id: `token-${index}`,
      surface,
      base,
      reading,
      pos,
      start,
      end,
      lookup,
    };
  });
}

function fallbackTokenize(text) {
  const pattern = /[\u3040-\u30ff\u3400-\u9fff々〆〤]+|[^\u3040-\u30ff\u3400-\u9fff々〆〤]+/g;
  const tokens = [];
  let match;
  let index = 0;

  while ((match = pattern.exec(text))) {
    const surface = match[0];
    if (/^[\u3040-\u30ff\u3400-\u9fff々〆〤]+$/.test(surface)) {
      const splitTokens = tokenizeJapaneseRun(surface, match.index, index);
      splitTokens.forEach((token) => tokens.push(token));
      index += splitTokens.length;
    } else {
      tokens.push(createFallbackToken(surface, match.index, index, false));
      index += 1;
    }
  }

  return tokens;
}

function tokenizeJapaneseRun(run, offset, startIndex) {
  const tokens = [];
  const particles = ["から", "まで", "ながら", "こと", "もの", "の", "で", "を", "も", "は", "が", "に", "へ", "と", "や"];
  let cursor = 0;
  let index = startIndex;

  while (cursor < run.length) {
    const matchedSeed = fallbackWordsByLength.find((word) => run.startsWith(word, cursor));
    if (matchedSeed) {
      tokens.push(createFallbackToken(matchedSeed, offset + cursor, index, true));
      cursor += matchedSeed.length;
      index += 1;
      continue;
    }

    const matchedParticle = particles.find((particle) => run.startsWith(particle, cursor));
    if (matchedParticle) {
      tokens.push(createFallbackToken(matchedParticle, offset + cursor, index, false));
      cursor += matchedParticle.length;
      index += 1;
      continue;
    }

    let next = cursor + 1;
    while (next < run.length) {
      const hasUpcomingSeed = fallbackWordsByLength.some((word) => run.startsWith(word, next));
      const hasUpcomingParticle = particles.some((particle) => run.startsWith(particle, next));
      if (hasUpcomingSeed || hasUpcomingParticle) break;
      next += 1;
    }

    const surface = run.slice(cursor, next);
    tokens.push(createFallbackToken(surface, offset + cursor, index, hasKanji(surface)));
    cursor = next;
    index += 1;
  }

  return tokens;
}

function createFallbackToken(surface, start, index, lookup = hasKanji(surface)) {
  const hint = fallbackWordHints[surface] || {};
  return {
    id: `token-${index}`,
    surface,
    base: surface,
    reading: hint.reading || "",
    pos: hint.pos || "词语",
    start,
    end: start + surface.length,
    lookup,
  };
}

function renderReader(text, tokens) {
  state.tokens.clear();
  elements.reader.classList.remove("empty");
  elements.reader.innerHTML = "";

  let cursor = 0;
  tokens.forEach((token) => {
    if (token.start > cursor) {
      appendHighlightedText(elements.reader, text.slice(cursor, token.start), cursor);
    }

    if (token.lookup) {
      state.tokens.set(token.id, token);
      const span = document.createElement("span");
      span.className = "lookup-token";
      const highlightColor = getHighlightColorForRange(token.start, token.end);
      if (highlightColor) {
        span.classList.add("marked-text");
        span.dataset.highlightColor = highlightColor;
      }
      if (shouldShowTokenReading(token)) {
        span.classList.add("with-reading");
        span.dataset.reading = token.reading;
      }
      span.dataset.tokenId = token.id;
      span.tabIndex = 0;
      renderTokenContent(span, token);
      elements.reader.append(span);
    } else {
      appendHighlightedText(elements.reader, token.surface, token.start);
    }

    cursor = token.end;
  });

  if (cursor < text.length) {
    appendHighlightedText(elements.reader, text.slice(cursor), cursor);
  }
}

function appendHighlightedText(parent, text, startOffset) {
  if (!text) return;
  let cursor = 0;

  while (cursor < text.length) {
    const absoluteIndex = startOffset + cursor;
    const color = getHighlightColorAt(absoluteIndex);
    let next = cursor + 1;
    while (next < text.length && getHighlightColorAt(startOffset + next) === color) {
      next += 1;
    }

    const chunk = text.slice(cursor, next);
    if (color) {
      const mark = document.createElement("mark");
      mark.className = "marked-text";
      mark.dataset.highlightColor = color;
      mark.textContent = chunk;
      parent.append(mark);
    } else {
      parent.append(document.createTextNode(chunk));
    }
    cursor = next;
  }
}

function getHighlightColorAt(index) {
  for (let itemIndex = state.highlights.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = state.highlights[itemIndex];
    if (index >= item.start && index < item.end) return item.color;
  }
  return "";
}

function getHighlightColorForRange(start, end) {
  for (let itemIndex = state.highlights.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = state.highlights[itemIndex];
    if (Math.max(start, item.start) < Math.min(end, item.end)) return item.color;
  }
  return "";
}

function renderTokenContent(span, token) {
  span.textContent = "";
  span.textContent = token.surface;
  if (shouldShowTokenReading(token)) {
    span.setAttribute("aria-label", `${token.surface} ${token.reading}`);
  } else {
    span.removeAttribute("aria-label");
    delete span.dataset.reading;
  }
}

function shouldShowTokenReading(token) {
  return Boolean(
    token?.reading &&
      (state.showAllReadings || state.visibleReadingKeys.has(getReadingKey(token)) || state.savedReadingKeys.has(getReadingKey(token))),
  );
}

function getReadingKey(token) {
  return `${token.surface}|${token.reading || ""}`;
}

function applyTokenReadingState(tokenId) {
  const token = state.tokens.get(tokenId);
  const tokenElement = document.querySelector(`[data-token-id="${tokenId}"]`);
  if (!token || !tokenElement) return;

  const showReading = shouldShowTokenReading(token);
  tokenElement.classList.toggle("with-reading", showReading);
  if (showReading) {
    tokenElement.dataset.reading = token.reading;
  } else {
    delete tokenElement.dataset.reading;
  }
  renderTokenContent(tokenElement, token);
}

function showSingleReading(tokenId) {
  const token = state.tokens.get(tokenId);
  if (!token?.reading) return;
  state.visibleReadingKeys.add(getReadingKey(token));
  applyTokenReadingState(tokenId);
}

function clearTemporaryReadings(exceptTokenId = "") {
  const keepToken = exceptTokenId ? state.tokens.get(exceptTokenId) : null;
  const keepKey = keepToken ? getReadingKey(keepToken) : "";
  const keysToClear = new Set(
    [...state.visibleReadingKeys].filter((key) => key !== keepKey && !state.savedReadingKeys.has(key)),
  );
  if (!keysToClear.size) return;

  keysToClear.forEach((key) => state.visibleReadingKeys.delete(key));
  state.tokens.forEach((token) => {
    if (keysToClear.has(getReadingKey(token))) {
      applyTokenReadingState(token.id);
    }
  });
}

function hideSingleReading(tokenId) {
  const token = state.tokens.get(tokenId);
  if (!token) return;
  const key = getReadingKey(token);
  state.visibleReadingKeys.delete(key);
  state.savedReadingKeys.delete(key);
  saveSavedReadings();
  applyTokenReadingState(tokenId);
}

function toggleSavedReading(tokenId) {
  const token = state.tokens.get(tokenId);
  if (!token?.reading) return;
  const key = getReadingKey(token);
  if (state.savedReadingKeys.has(key)) {
    state.savedReadingKeys.delete(key);
    state.visibleReadingKeys.delete(key);
  } else {
    state.savedReadingKeys.add(key);
    state.visibleReadingKeys.add(key);
  }
  saveSavedReadings();
  applyTokenReadingState(tokenId);
}

function saveReading(tokenId) {
  const token = state.tokens.get(tokenId);
  if (!token?.reading) return;
  const key = getReadingKey(token);
  state.savedReadingKeys.add(key);
  state.visibleReadingKeys.add(key);
  saveSavedReadings();
  applyTokenReadingState(tokenId);
}

function toggleAllReadings() {
  const hasCurrentAnalysis = state.lastText && elements.sourceText.value.trim() === state.lastText;
  if (!hasCurrentAnalysis) {
    elements.analysisStatus.textContent = "请先分析当前文本，然后再显示全部假名。";
    updateAllReadingsButton();
    return;
  }

  state.showAllReadings = !state.showAllReadings;
  hideTooltip();
  closeDetailPanel();
  renderReader(state.lastText, state.lastTokens);
  updateAllReadingsButton();
  elements.analysisStatus.textContent = state.showAllReadings
    ? "已显示整篇文章的假名读音。"
    : "已隐藏整篇文章的假名读音。";
}

function updateAllReadingsButton() {
  const hasCurrentAnalysis = state.lastText && elements.sourceText.value.trim() === state.lastText;
  const hasReadableTokens = state.lastTokens.some((token) => token.lookup && token.reading);
  elements.allReadingsButton.disabled = !(hasCurrentAnalysis && hasReadableTokens);
  elements.allReadingsButton.textContent = state.showAllReadings ? "隐藏全部假名" : "显示全部假名";
  elements.allReadingsButton.classList.toggle("saved-text", state.showAllReadings);
}

function selectHighlightColor(button) {
  state.highlightColor = button.dataset.highlightColor || "lemon";
  elements.colorSwatches.forEach((item) => item.classList.toggle("active", item === button));
}

function markSelectedHighlight() {
  if (!hasCurrentAnalysis()) {
    elements.analysisStatus.textContent = "请先分析文本，然后在阅读区选中要标记的句子。";
    return;
  }

  const range = getActiveReaderSelectionRange();
  if (!range) {
    elements.analysisStatus.textContent = "请先在阅读区选中一句话或一段文字。";
    return;
  }

  state.highlights.push(buildHighlightRecord(range.start, range.end, state.highlightColor, state.lastText));
  state.highlights.sort((a, b) => a.start - b.start || a.end - b.end);
  saveHighlightsForText();
  window.getSelection()?.removeAllRanges();
  hideHighlightToolbar();
  renderReader(state.lastText, state.lastTokens);
  updateHighlightButtons();
  elements.analysisStatus.textContent = "已给选中的文字加上重点标记。";
}

function clearCurrentHighlights() {
  if (!hasCurrentAnalysis()) return;

  const range = getActiveReaderSelectionRange();
  if (range) {
    state.highlights = state.highlights.filter((item) => Math.max(item.start, range.start) >= Math.min(item.end, range.end));
    window.getSelection()?.removeAllRanges();
    hideHighlightToolbar();
    elements.analysisStatus.textContent = "已清除选中范围内的重点标记。";
  } else {
    state.highlights = [];
    elements.analysisStatus.textContent = "已清除当前文章的全部重点标记。";
  }

  saveHighlightsForText();
  renderReader(state.lastText, state.lastTokens);
  updateHighlightButtons();
}

function getReaderSelectionRange() {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || selection.isCollapsed) return null;
  if (!nodeInsideReader(selection.anchorNode) || !nodeInsideReader(selection.focusNode)) return null;

  const selectedRange = selection.getRangeAt(0);
  const startRange = document.createRange();
  startRange.selectNodeContents(elements.reader);
  startRange.setEnd(selectedRange.startContainer, selectedRange.startOffset);

  const endRange = document.createRange();
  endRange.selectNodeContents(elements.reader);
  endRange.setEnd(selectedRange.endContainer, selectedRange.endOffset);

  const start = clampNumber(startRange.toString().length, 0, state.lastText.length, 0);
  const end = clampNumber(endRange.toString().length, 0, state.lastText.length, 0);
  const normalizedStart = Math.min(start, end);
  const normalizedEnd = Math.max(start, end);
  if (normalizedEnd <= normalizedStart) return null;
  return { start: normalizedStart, end: normalizedEnd };
}

function getActiveReaderSelectionRange() {
  const currentRange = getReaderSelectionRange();
  if (currentRange) {
    state.lastReaderSelection = currentRange;
    return currentRange;
  }

  if (!state.lastReaderSelection || !state.lastText) return null;
  const start = clampNumber(state.lastReaderSelection.start, 0, state.lastText.length, 0);
  const end = clampNumber(state.lastReaderSelection.end, 0, state.lastText.length, 0);
  if (end <= start) return null;
  return { start, end };
}

function nodeInsideReader(node) {
  if (!node) return false;
  return elements.reader.contains(node.nodeType === Node.TEXT_NODE ? node.parentNode : node);
}

function hasCurrentAnalysis() {
  return Boolean(state.lastText && elements.sourceText.value.trim() === state.lastText);
}

function updateHighlightButtons() {
  const ready = hasCurrentAnalysis() && !state.isEditingReader;
  elements.markHighlightButton.disabled = !ready;
  elements.clearHighlightsButton.disabled = !ready || !state.highlights.length;
  elements.editSelectionButton.disabled = !ready;
}

function handleReaderSelectionChange() {
  if (state.isEditingReader || !hasCurrentAnalysis()) {
    hideHighlightToolbar();
    return;
  }

  const selection = window.getSelection();
  const readerRange = getReaderSelectionRange();
  if (!selection || !selection.rangeCount || !readerRange) {
    if (
      isTouchMode() &&
      state.highlightToolbarPointerDown &&
      state.lastReaderSelection &&
      elements.highlightToolbar.classList.contains("visible")
    ) {
      return;
    }
    hideHighlightToolbar();
    return;
  }

  state.lastReaderSelection = readerRange;
  positionHighlightToolbar(selection.getRangeAt(0));
}

function positionHighlightToolbar(range) {
  elements.highlightToolbar.classList.add("visible");
  elements.highlightToolbar.setAttribute("aria-hidden", "false");

  if (isTouchMode()) {
    const viewport = window.visualViewport;
    const viewportBottom = viewport ? window.innerHeight - viewport.height - viewport.offsetTop : 0;
    const bottom = Math.max(12, Math.round(viewportBottom + 12));
    elements.highlightToolbar.classList.add("mobile");
    elements.highlightToolbar.style.left = "12px";
    elements.highlightToolbar.style.right = "12px";
    elements.highlightToolbar.style.top = "";
    elements.highlightToolbar.style.bottom = `${bottom}px`;
    return;
  }

  const rect = getVisibleRangeRect(range);
  if (!rect) {
    hideHighlightToolbar();
    return;
  }

  elements.highlightToolbar.classList.remove("mobile");
  elements.highlightToolbar.style.right = "";
  elements.highlightToolbar.style.bottom = "";
  const toolbarRect = elements.highlightToolbar.getBoundingClientRect();
  const width = toolbarRect.width || 260;
  const height = toolbarRect.height || 44;
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 12);
  const above = rect.top - height - 10;
  const below = rect.bottom + 10;
  const top = above > 10 ? above : Math.min(below, window.innerHeight - height - 12);
  elements.highlightToolbar.style.left = `${left}px`;
  elements.highlightToolbar.style.top = `${top}px`;
}

function getVisibleRangeRect(range) {
  const rects = [...range.getClientRects()].filter((rect) => rect.width || rect.height);
  if (rects.length) return rects[0];
  const rect = range.getBoundingClientRect();
  return rect.width || rect.height ? rect : null;
}

function hideHighlightToolbar() {
  elements.highlightToolbar.classList.remove("visible");
  elements.highlightToolbar.classList.remove("mobile");
  elements.highlightToolbar.setAttribute("aria-hidden", "true");
  elements.highlightToolbar.style.left = "";
  elements.highlightToolbar.style.right = "";
  elements.highlightToolbar.style.top = "";
  elements.highlightToolbar.style.bottom = "";
  state.lastReaderSelection = null;
}

function toggleReaderEditMode() {
  if (state.isEditingReader) {
    finishReaderEditMode();
    return;
  }
  openReaderEditMode(state.editStartOffset || estimateOffsetFromReaderScroll());
}

function openReaderEditMode(offset = 0) {
  if (!hasCurrentAnalysis()) {
    elements.analysisStatus.textContent = "请先分析文本，然后再打开阅读区编辑模式。";
    return;
  }

  hideTooltip();
  hideHighlightToolbar();
  closeDetailPanel();
  state.isEditingReader = true;
  state.editStartOffset = clampNumber(offset, 0, state.lastText.length, 0);
  elements.reader.classList.remove("empty");
  elements.reader.classList.add("editing");
  elements.reader.innerHTML = "";

  const editor = document.createElement("textarea");
  editor.id = "readerEditArea";
  editor.className = "reader-edit-area";
  editor.spellcheck = false;
  editor.value = state.lastText;
  elements.reader.append(editor);
  requestAnimationFrame(() => {
    editor.focus();
    editor.setSelectionRange(state.editStartOffset, state.editStartOffset);
    scrollTextareaToOffset(editor, state.editStartOffset);
  });
  updateReaderEditButton();
  updateHighlightButtons();
  elements.analysisStatus.textContent = "阅读区编辑模式已打开。修改完成后点“完成编辑”。";
}

function finishReaderEditMode() {
  const editor = document.querySelector("#readerEditArea");
  const text = (editor?.value || "").trim();
  if (!text) {
    elements.analysisStatus.textContent = "阅读区内容不能为空。";
    editor?.focus();
    return;
  }

  const oldHighlightCount = state.highlights.length;
  const carriedHighlights = carryHighlightsToEditedText(text);
  state.isEditingReader = false;
  elements.reader.classList.remove("editing");
  elements.sourceText.value = text;
  state.showAllReadings = false;
  state.visibleReadingKeys.clear();
  hideHighlightToolbar();
  updateTextFavoriteButton();
  saveHighlightsForSpecificText(text, carriedHighlights);
  analyzeText().then(() => {
    const droppedCount = Math.max(0, oldHighlightCount - carriedHighlights.length);
    if (droppedCount) {
      elements.analysisStatus.textContent = `编辑完成。已保留 ${carriedHighlights.length} 个重点标记，${droppedCount} 个标记因内容变化过大未自动恢复。`;
    }
  });
}

function editSelectedText() {
  const range = getActiveReaderSelectionRange();
  if (!range) {
    openReaderEditMode(state.editStartOffset || estimateOffsetFromReaderScroll());
    return;
  }
  window.getSelection()?.removeAllRanges();
  openReaderEditMode(range.start);
}

function estimateOffsetFromReaderScroll() {
  if (!state.lastText) return 0;
  const maxScroll = Math.max(1, elements.reader.scrollHeight - elements.reader.clientHeight);
  return Math.round((elements.reader.scrollTop / maxScroll) * state.lastText.length);
}

function scrollTextareaToOffset(editor, offset) {
  const ratio = state.lastText.length ? offset / state.lastText.length : 0;
  editor.scrollTop = Math.max(0, (editor.scrollHeight - editor.clientHeight) * ratio - editor.clientHeight * 0.25);
}

function buildHighlightRecord(start, end, color, sourceText, id = "") {
  return {
    id: id || `hl-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    start,
    end,
    color,
    text: sourceText.slice(start, end),
    before: sourceText.slice(Math.max(0, start - 18), start),
    after: sourceText.slice(end, Math.min(sourceText.length, end + 18)),
  };
}

function carryHighlightsToEditedText(text) {
  if (!state.highlights.length) return [];
  const oldText = state.lastText;
  const carried = [];

  state.highlights.forEach((item) => {
    const sourceText = item.text || oldText.slice(item.start, item.end);
    if (!sourceText) return;

    const mapped = findHighlightInEditedText(item, sourceText, text, oldText);
    if (!mapped) return;
    carried.push(buildHighlightRecord(mapped.start, mapped.end, item.color || "lemon", text, item.id));
  });

  return carried.sort((a, b) => a.start - b.start || a.end - b.end);
}

function findHighlightInEditedText(item, highlightedText, newText, oldText) {
  const candidates = findAllOccurrences(newText, highlightedText);
  if (!candidates.length) return null;

  const before = item.before ?? oldText.slice(Math.max(0, item.start - 18), item.start);
  const after = item.after ?? oldText.slice(item.end, Math.min(oldText.length, item.end + 18));
  const scored = candidates.map((start) => {
    const end = start + highlightedText.length;
    const newBefore = newText.slice(Math.max(0, start - before.length), start);
    const newAfter = newText.slice(end, Math.min(newText.length, end + after.length));
    const contextScore = commonSuffixLength(before, newBefore) + commonPrefixLength(after, newAfter);
    const distancePenalty = Math.abs(start - item.start) / Math.max(24, oldText.length) / 2;
    return { start, end, score: contextScore - distancePenalty };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  const hasContext = (before.length + after.length) > 0;
  const minimumScore = hasContext ? Math.min(4, before.length + after.length) : 0;

  if (candidates.length === 1 || (best.score >= minimumScore && (!second || best.score - second.score >= 1))) {
    return { start: best.start, end: best.end };
  }

  return null;
}

function findAllOccurrences(text, needle) {
  const positions = [];
  let start = 0;
  while (needle && start <= text.length) {
    const index = text.indexOf(needle, start);
    if (index < 0) break;
    positions.push(index);
    start = index + Math.max(1, needle.length);
  }
  return positions;
}

function commonSuffixLength(a, b) {
  let count = 0;
  while (count < a.length && count < b.length && a[a.length - 1 - count] === b[b.length - 1 - count]) {
    count += 1;
  }
  return count;
}

function commonPrefixLength(a, b) {
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) {
    count += 1;
  }
  return count;
}

function updateReaderEditButton() {
  const ready = hasCurrentAnalysis() || state.isEditingReader;
  elements.readerEditButton.disabled = !ready;
  elements.readerEditButton.textContent = state.isEditingReader ? "完成编辑" : "编辑阅读区";
  elements.readerEditButton.classList.toggle("saved-text", state.isEditingReader);
}

function loadHighlightsForText(text) {
  try {
    const raw = localStorage.getItem(getHighlightStorageKey(text));
    const items = raw ? JSON.parse(raw) : [];
    return items
      .filter((item) => Number.isInteger(item.start) && Number.isInteger(item.end) && item.start >= 0 && item.end <= text.length)
      .map((item) => ({
        id: item.id || `hl-${item.start}-${item.end}`,
        start: item.start,
        end: item.end,
        color: item.color || "lemon",
        text: item.text || text.slice(item.start, item.end),
        before: item.before || text.slice(Math.max(0, item.start - 18), item.start),
        after: item.after || text.slice(item.end, Math.min(text.length, item.end + 18)),
      }));
  } catch {
    return [];
  }
}

function saveHighlightsForText() {
  if (!state.lastText) return;
  saveHighlightsForSpecificText(state.lastText, state.highlights);
}

function saveHighlightsForSpecificText(text, highlights) {
  if (!text) return;
  localStorage.setItem(getHighlightStorageKey(text), JSON.stringify(highlights || []));
}

function getHighlightStorageKey(text) {
  return `japanese-reader-highlights:${getTextFavoriteKey(text || "")}`;
}

function handlePointerOver(event) {
  if (state.isEditingReader) return;
  if (isTouchMode()) return;
  const tokenElement = event.target.closest(".lookup-token");
  if (!tokenElement || !elements.reader.contains(tokenElement)) return;
  cancelTooltipHide();
  showTooltipForElement(tokenElement);
}

function handlePointerOut(event) {
  if (state.isEditingReader) return;
  if (isTouchMode()) return;
  const tokenElement = event.target.closest(".lookup-token");
  if (!tokenElement) return;
  if (event.relatedTarget && elements.tooltip.contains(event.relatedTarget)) {
    cancelTooltipHide();
    return;
  }
  scheduleTooltipHide();
}

function handleTokenClick(event) {
  if (state.isEditingReader) return;
  const tokenElement = event.target.closest(".lookup-token");
  if (!tokenElement) return;
  event.stopPropagation();

  clearTemporaryReadings(tokenElement.dataset.tokenId);
  showSingleReading(tokenElement.dataset.tokenId);
  const token = state.tokens.get(tokenElement.dataset.tokenId);
  state.editStartOffset = token?.start || 0;
  state.mobileOpenTokenId = tokenElement.dataset.tokenId;
  showTooltipForElement(tokenElement);

  if (isTouchMode()) {
    return;
  }
}

function handleTokenDoubleClick(event) {
  if (state.isEditingReader) return;
  const tokenElement = event.target.closest(".lookup-token");
  if (!tokenElement) return;
  event.preventDefault();
  event.stopPropagation();

  clearTemporaryReadings(tokenElement.dataset.tokenId);
  saveReading(tokenElement.dataset.tokenId);
  state.mobileOpenTokenId = tokenElement.dataset.tokenId;
  showTooltipForElement(tokenElement);
  elements.analysisStatus.textContent = "已保存这个词的假名读音。";
}

function handleTooltipPointerEnter() {
  if (isTouchMode()) return;
  state.tooltipPointerInside = true;
  cancelTooltipHide();
}

function handleTooltipPointerLeave() {
  if (isTouchMode()) return;
  state.tooltipPointerInside = false;
  scheduleTooltipHide(180);
}

function handleOutsideClick(event) {
  if (!elements.highlightToolbar.contains(event.target) && !elements.reader.contains(event.target)) {
    hideHighlightToolbar();
  }

  if (!elements.tooltip.contains(event.target) && !event.target.closest(".lookup-token")) {
    state.mobileOpenTokenId = null;
    state.tooltipPointerInside = false;
    cancelTooltipHide();
    clearTemporaryReadings();
    hideTooltip();
    clearActiveTokens();
  }
}

async function showTooltipForElement(tokenElement) {
  clearActiveTokens();
  tokenElement.classList.add("active");
  state.activeTokenId = tokenElement.dataset.tokenId;
  const token = state.tokens.get(state.activeTokenId);
  positionTooltip(tokenElement);
  renderTooltip({ reading: token.reading || "读音查询中", brief: "正在查询释义..." }, state.activeTokenId);
  elements.tooltip.classList.add("visible");
  elements.tooltip.setAttribute("aria-hidden", "false");

  const entry = await lookupWord(token);
  if (state.activeTokenId === token.id || state.mobileOpenTokenId === token.id) {
    renderTooltip(entry, token.id);
    positionTooltip(tokenElement);
  }
}

function renderTooltip(entry, tokenId) {
  elements.tooltip.innerHTML = "";
  const token = state.tokens.get(tokenId);
  const reading = document.createElement("span");
  reading.className = "tooltip-reading";
  reading.textContent = entry.reading || "读音暂缺";

  const meaning = document.createElement("span");
  meaning.className = "tooltip-meaning";
  meaning.textContent = getBriefText(entry);

  elements.tooltip.append(reading, meaning);

  const actions = document.createElement("div");
  actions.className = "tooltip-actions";

  if (token?.reading) {
    const isSavedReading = state.savedReadingKeys.has(getReadingKey(token));
    const saveReadingButton = document.createElement("button");
    saveReadingButton.type = "button";
    saveReadingButton.className = "tooltip-action";
    saveReadingButton.textContent = isSavedReading ? "取消保存假名" : "保存假名";
    saveReadingButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleSavedReading(tokenId);
      renderTooltip(entry, tokenId);
    });
    actions.append(saveReadingButton);

    if (!isSavedReading && state.visibleReadingKeys.has(getReadingKey(token))) {
      const temporaryNote = document.createElement("span");
      temporaryNote.className = "tooltip-note";
      temporaryNote.textContent = "当前仅临时显示，点保存才会保留。";
      elements.tooltip.append(temporaryNote);

      const hideReadingButton = document.createElement("button");
      hideReadingButton.type = "button";
      hideReadingButton.className = "tooltip-action secondary";
      hideReadingButton.textContent = "隐藏假名";
      hideReadingButton.addEventListener("click", (event) => {
        event.stopPropagation();
        hideSingleReading(tokenId);
        renderTooltip(entry, tokenId);
      });
      actions.append(hideReadingButton);
    }
  }

  const detailButton = document.createElement("button");
  detailButton.type = "button";
  detailButton.className = "tooltip-action secondary";
  detailButton.textContent = "查看详情";
  detailButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openDetail(tokenId);
  });
  actions.append(detailButton);

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "tooltip-action secondary";
  editButton.textContent = "编辑此处";
  editButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const editToken = state.tokens.get(tokenId);
    openReaderEditMode(editToken?.start || 0);
  });
  actions.append(editButton);
  elements.tooltip.append(actions);
}

function positionTooltip(tokenElement) {
  const rect = tokenElement.getBoundingClientRect();
  const tooltipWidth = Math.min(310, window.innerWidth - 28);
  const left = Math.min(Math.max(14, rect.left), window.innerWidth - tooltipWidth - 14);
  const below = rect.bottom + 10;
  const above = rect.top - 110;
  const top = below + 120 < window.innerHeight ? below : Math.max(14, above);
  elements.tooltip.style.left = `${left}px`;
  elements.tooltip.style.top = `${top}px`;
}

function positionActiveTooltip() {
  if (!state.activeTokenId || !elements.tooltip.classList.contains("visible")) return;
  const tokenElement = document.querySelector(`[data-token-id="${state.activeTokenId}"]`);
  if (tokenElement) positionTooltip(tokenElement);
}

function hideTooltip() {
  cancelTooltipHide();
  state.tooltipPointerInside = false;
  elements.tooltip.classList.remove("visible");
  elements.tooltip.setAttribute("aria-hidden", "true");
}

function scheduleTooltipHide(delay = 420) {
  cancelTooltipHide();
  state.tooltipHideTimer = window.setTimeout(() => {
    state.tooltipHideTimer = null;
    if (state.tooltipPointerInside) return;
    state.mobileOpenTokenId = null;
    clearTemporaryReadings();
    hideTooltip();
    clearActiveTokens();
  }, delay);
}

function cancelTooltipHide() {
  if (!state.tooltipHideTimer) return;
  window.clearTimeout(state.tooltipHideTimer);
  state.tooltipHideTimer = null;
}

function clearActiveTokens() {
  document.querySelectorAll(".lookup-token.active").forEach((node) => node.classList.remove("active"));
}

async function openDetail(tokenId) {
  const token = state.tokens.get(tokenId);
  if (!token) return;
  elements.detailPanel.setAttribute("aria-hidden", "false");
  renderDetailLoading(token);
  const entry = await lookupWord(token);
  renderDetail(token, entry);
}

function closeDetailPanel() {
  elements.detailPanel.setAttribute("aria-hidden", "true");
  clearTemporaryReadings();
}

function renderDetailLoading(token) {
  elements.detailContent.innerHTML = `
    <div class="detail-title-row">
      <div>
        <h2 class="word-title">${escapeHtml(token.surface)}</h2>
        <p class="word-reading">${escapeHtml(token.reading || "读音查询中")}</p>
      </div>
    </div>
    <div class="detail-card">
      <h3>在线查询中</h3>
      <p>正在查询可追溯词典和真实例句来源。</p>
    </div>
  `;
}

function renderDetail(token, entry) {
  const favoriteKey = getFavoriteKey(token, entry);
  const isSaved = state.favorites.has(favoriteKey);
  const chineseDefinitions = entry.chineseDefinitions || [];
  const referenceDefinitions = entry.referenceDefinitions || [];
  const examples = entry.examples || [];
  const notices = entry.notices || [];
  const sources = entry.sources || [];
  elements.detailContent.innerHTML = `
    <div class="detail-title-row">
      <div>
        <h2 class="word-title">${escapeHtml(token.surface)}</h2>
        <p class="word-reading">${escapeHtml(entry.reading || token.reading || "读音暂缺")}</p>
      </div>
      <button class="primary-button favorite-button ${isSaved ? "saved" : ""}" type="button" id="favoriteToggle">
        ${isSaved ? "已收藏" : "收藏"}
      </button>
    </div>
    <div class="word-meta">
      <span class="tag">${escapeHtml(entry.pos || token.pos || "词语")}</span>
      <span class="tag">基本形：${escapeHtml(token.base || token.surface)}</span>
      <span class="tag">在线来源</span>
      ${entry.aiDefinition ? `<span class="tag ai-tag">AI辅助</span>` : ""}
      ${entry.memoryDefinition ? `<span class="tag memory-tag">翻译记忆</span>` : ""}
    </div>
    <div class="detail-card">
      <h3>中文释义</h3>
      ${renderChineseDefinitions(chineseDefinitions, entry)}
    </div>
    <div class="detail-card">
      <h3>真实例句</h3>
      ${renderExamples(examples)}
    </div>
    <div class="detail-card">
      <h3>日英参考</h3>
      ${renderReferenceDefinitions(referenceDefinitions)}
    </div>
    <div class="detail-card">
      <h3>语法 / 用法说明</h3>
      <p>${escapeHtml(entry.grammar || "暂无可靠语法说明来源。")}</p>
    </div>
    <div class="detail-card">
      <h3>来源与限制</h3>
      ${renderNotices(notices)}
      ${renderSources(sources)}
    </div>
  `;

  document.querySelector("#favoriteToggle").addEventListener("click", () => toggleFavorite(token, entry));
}

async function lookupWord(token) {
  const key = token.base || token.surface;
  if (state.lookupCache.has(key)) return state.lookupCache.get(key);
  const entry = await fetchTrustedLookup(token);
  state.lookupCache.set(key, entry);
  return entry;
}

async function fetchTrustedLookup(token) {
  const localHint = fallbackWordHints[token.surface] || fallbackWordHints[token.base] || {};
  const staticBrief = localHint.meaning || "线上静态版未连接后端词典；已保留读音和词性信息。";
  const offlineBrief =
    location.protocol === "file:"
      ? "当前是 file:// 打开，无法连接在线查词"
      : apiBaseUrl
        ? "后端词典暂时不可用；已保留读音和词性信息。"
      : isStaticDeployment()
        ? staticBrief
        : "在线查词服务暂时不可用";
  const fallback = {
    word: token.surface,
    reading: token.reading || localHint.reading || "",
    pos: token.pos || localHint.pos || "词语",
    brief: offlineBrief,
    status: "offline_or_unavailable",
    chineseDefinitions: localHint.meaning ? [localHint.meaning] : [],
    referenceDefinitions: [],
    examples: [],
    grammar: isStaticDeployment() ? "线上静态版暂不提供可靠语法说明；启用后端后可显示更完整解释。" : "暂无可靠语法说明来源。",
    notices: [
      location.protocol === "file:"
        ? "当前是 file:// 打开，无法使用在线查词服务；请使用 http:// 局域网链接。"
        : apiBaseUrl
          ? "已配置后端词典地址，但本次请求没有成功；请确认后端服务正在运行。"
        : isStaticDeployment()
          ? "当前是 GitHub Pages 静态版。阅读、假名、收藏和标记可用；联网词典和例句需要单独部署后端服务。"
          : "在线查词服务暂时不可用。",
    ],
    sources: [],
    aiDefinition: null,
    memoryDefinition: null,
  };

  if (!hasLookupApi()) return fallback;

  try {
    const params = new URLSearchParams({
      word: token.base || token.surface,
      surface: token.surface,
      reading: token.reading || "",
      pos: token.pos || "",
      context: elements.sourceText.value || "",
    });
    const response = await fetchWithTimeout(buildLookupApiUrl(params), apiBaseUrl ? 60000 : 7000);
    if (!response.ok) return fallback;
    const payload = await response.json();
    return normalizeLookupPayload(token, payload);
  } catch {
    return fallback;
  }
}

function normalizeLookupPayload(token, payload) {
  return {
    word: payload.word || token.surface,
    reading: payload.reading || token.reading || "",
    pos: payload.pos || token.pos || "词语",
    brief: payload.brief || "暂无可靠中文释义",
    status: payload.status || "unknown",
    chineseDefinitions: Array.isArray(payload.chineseDefinitions) ? payload.chineseDefinitions : [],
    referenceDefinitions: Array.isArray(payload.referenceDefinitions) ? payload.referenceDefinitions : [],
    examples: Array.isArray(payload.examples) ? payload.examples : [],
    grammar: payload.grammar || "暂无可靠语法说明来源。",
    notices: Array.isArray(payload.notices) ? payload.notices : [],
    sources: Array.isArray(payload.sources) ? payload.sources : [],
    aiDefinition: payload.aiDefinition || null,
    memoryDefinition: payload.memoryDefinition || null,
  };
}

function getBriefText(entry) {
  const chineseDefinition = entry.chineseDefinitions?.[0]?.text;
  if (chineseDefinition) return chineseDefinition;
  return entry.brief || "暂无可靠中文释义";
}

function renderChineseDefinitions(definitions, entry) {
  if (!definitions.length) {
    if (entry?.status === "missing_openai_api_key") {
      return `<p class="empty-source">AI 日中释义未启用：服务器没有 OpenAI API key，所以目前无法生成准确的中文释义。</p>`;
    }
    if (entry?.status === "offline_or_unavailable") {
      return `<p class="empty-source">在线查词服务没有连接成功。请使用 http:// 链接打开，并确认本地服务器正在运行。</p>`;
    }
    return `<p class="empty-source">暂未找到可靠的日中词典释义。系统不会用英文释义或机器翻译冒充中文释义。</p>`;
  }

  return `
    <ul class="source-list">
      ${definitions
        .map(
          (item) => `
            <li>
              <p>${escapeHtml(item.text)}</p>
              <p class="detail-note">来源：${escapeHtml(item.source || "未标明")}</p>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function renderExamples(examples) {
  if (!examples.length) {
    return `<p class="empty-source">暂未在 Tatoeba 查到带中文译文的可靠例句。</p>`;
  }

  return `
    <div class="example-list">
      ${examples
        .map(
          (item) => `
            <article class="example-item">
              <p lang="ja">${escapeHtml(item.japanese)}</p>
              <p>${escapeHtml(item.translation)}</p>
              <a class="source-link" href="${escapeHtml(item.sourceUrl || "https://tatoeba.org/")}" target="_blank" rel="noreferrer">
                Tatoeba #${escapeHtml(item.sentenceId || "")}
              </a>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderReferenceDefinitions(definitions) {
  if (!definitions.length) {
    return `<p class="empty-source">暂未查到日英参考释义。</p>`;
  }

  return `
    <ul class="source-list">
      ${definitions
        .map(
          (item) => `
            <li>
              <p>${escapeHtml(item.text)}</p>
              <p class="detail-note">${escapeHtml(item.partOfSpeech || "词性未标明")} · ${escapeHtml(item.source || "来源未标明")} · ${escapeHtml(item.language || "en")}</p>
            </li>
          `,
        )
        .join("")}
    </ul>
  `;
}

function renderNotices(notices) {
  if (!notices.length) return "";
  return `
    <ul class="notice-list">
      ${notices.map((notice) => `<li>${escapeHtml(notice)}</li>`).join("")}
    </ul>
  `;
}

function renderSources(sources) {
  if (!sources.length) return "";
  return `
    <div class="sources">
      ${sources
        .map(
          (source) => `
            <a class="source-link" href="${escapeHtml(source.url || "#")}" target="_blank" rel="noreferrer">
              ${escapeHtml(source.name || "来源")}
            </a>
            ${source.note ? `<p class="detail-note">${escapeHtml(source.note)}</p>` : ""}
          `,
        )
        .join("")}
    </div>
  `;
}

function fetchWithTimeout(url, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

function toggleFavorite(token, entry) {
  const key = getFavoriteKey(token, entry);
  if (state.favorites.has(key)) {
    state.favorites.delete(key);
  } else {
    state.favorites.set(key, {
      key,
      word: token.surface,
      reading: entry.reading || token.reading || "",
      meaning: entry.brief || "",
      savedAt: new Date().toISOString(),
    });
  }

  saveFavorites();
  renderDetail(token, entry);
}

function getFavoriteKey(token, entry) {
  return `${token.surface}|${entry.reading || token.reading || ""}`;
}

function toggleCurrentTextFavorite() {
  const text = elements.sourceText.value.trim();
  if (!text) {
    elements.analysisStatus.textContent = "请先输入一段想收藏的日语文本。";
    updateTextFavoriteButton();
    return;
  }

  const key = getTextFavoriteKey(text);
  if (state.textFavorites.has(key)) {
    state.textFavorites.delete(key);
    elements.analysisStatus.textContent = "已从收藏夹移除这段文本。";
  } else {
    state.textFavorites.set(key, {
      key,
      text,
      title: buildTextFavoriteTitle(text),
      savedAt: new Date().toISOString(),
    });
    elements.analysisStatus.textContent = "已收藏这段文本，可在收藏夹里重新打开。";
  }

  saveTextFavorites();
  updateTextFavoriteButton();
}

function updateTextFavoriteButton() {
  const text = elements.sourceText.value.trim();
  const hasText = Boolean(text);
  const isSaved = hasText && state.textFavorites.has(getTextFavoriteKey(text));
  elements.saveTextButton.disabled = !hasText;
  elements.saveTextButton.textContent = isSaved ? "已收藏本文" : "收藏本文";
  elements.saveTextButton.classList.toggle("saved-text", isSaved);
}

function getTextFavoriteKey(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `text-${text.length}-${(hash >>> 0).toString(16)}`;
}

function buildTextFavoriteTitle(text) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > 32 ? `${compact.slice(0, 32)}...` : compact || "未命名文本";
}

function loadFavorites() {
  try {
    const raw = localStorage.getItem("japanese-reader-favorites");
    const items = raw ? JSON.parse(raw) : [];
    state.favorites = new Map(items.map((item) => [item.key, item]));
  } catch {
    state.favorites = new Map();
  }
}

function saveFavorites() {
  localStorage.setItem("japanese-reader-favorites", JSON.stringify([...state.favorites.values()]));
}

function loadTextFavorites() {
  try {
    const raw = localStorage.getItem("japanese-reader-text-favorites");
    const items = raw ? JSON.parse(raw) : [];
    state.textFavorites = new Map(items.map((item) => [item.key, item]));
  } catch {
    state.textFavorites = new Map();
  }
}

function saveTextFavorites() {
  localStorage.setItem("japanese-reader-text-favorites", JSON.stringify([...state.textFavorites.values()]));
}

function loadSavedReadings() {
  try {
    const raw = localStorage.getItem("japanese-reader-saved-readings");
    const items = raw ? JSON.parse(raw) : [];
    state.savedReadingKeys = new Set(items.filter(Boolean));
  } catch {
    state.savedReadingKeys = new Set();
  }
}

function saveSavedReadings() {
  localStorage.setItem("japanese-reader-saved-readings", JSON.stringify([...state.savedReadingKeys.values()]));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem("japanese-reader-settings");
    const saved = raw ? JSON.parse(raw) : {};
    state.settings.fontSize = clampNumber(saved.fontSize, 16, 30, 20);
    state.settings.lineHeight = clampNumber(saved.lineHeight, 1.55, 2.5, 2.05);
  } catch {
    state.settings = { fontSize: 20, lineHeight: 2.05 };
  }

  applyReaderSettings();
}

function saveSettings() {
  localStorage.setItem("japanese-reader-settings", JSON.stringify(state.settings));
}

function applyReaderSettings() {
  document.documentElement.style.setProperty("--reader-font-size", `${state.settings.fontSize}px`);
  document.documentElement.style.setProperty("--reader-line-height", String(state.settings.lineHeight));
  elements.fontSizeRange.value = String(state.settings.fontSize);
  elements.fontSizeValue.textContent = `${state.settings.fontSize}px`;
  elements.lineHeightRange.value = String(state.settings.lineHeight);
  elements.lineHeightValue.textContent = state.settings.lineHeight.toFixed(2).replace(/0$/, "");
}

function updateFontSize(event) {
  state.settings.fontSize = clampNumber(Number(event.target.value), 16, 30, 20);
  applyReaderSettings();
  saveSettings();
}

function updateLineHeight(event) {
  state.settings.lineHeight = clampNumber(Number(event.target.value), 1.55, 2.5, 2.05);
  applyReaderSettings();
  saveSettings();
}

function resetSettings() {
  state.settings = { fontSize: 20, lineHeight: 2.05 };
  applyReaderSettings();
  saveSettings();
}

function openSettings() {
  elements.settingsDrawer.classList.add("open");
  elements.settingsDrawer.setAttribute("aria-hidden", "false");
}

function closeSettings() {
  elements.settingsDrawer.classList.remove("open");
  elements.settingsDrawer.setAttribute("aria-hidden", "true");
}

function openFavorites() {
  renderFavorites();
  elements.favoritesDrawer.classList.add("open");
  elements.favoritesDrawer.setAttribute("aria-hidden", "false");
}

function closeFavorites() {
  elements.favoritesDrawer.classList.remove("open");
  elements.favoritesDrawer.setAttribute("aria-hidden", "true");
}

function renderFavorites() {
  const favorites = [...state.favorites.values()].sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  const textFavorites = [...state.textFavorites.values()].sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  elements.favoritesList.innerHTML = "";

  if (!favorites.length && !textFavorites.length) {
    elements.favoritesList.innerHTML = `<p class="empty-detail">还没有收藏记录。</p>`;
    return;
  }

  if (textFavorites.length) {
    const section = document.createElement("section");
    section.className = "favorite-section";
    section.innerHTML = `<h3>文本记录</h3>`;

    textFavorites.forEach((item) => {
      const node = document.createElement("article");
      node.className = "favorite-item text-favorite-item";
      node.innerHTML = `
        <div class="favorite-main">
          <div>
            <div class="favorite-word">${escapeHtml(item.title || buildTextFavoriteTitle(item.text || ""))}</div>
            <div class="favorite-reading">${escapeHtml(`${(item.text || "").length} 字`)}</div>
          </div>
          <div class="favorite-actions">
            <button class="remove-button load-text-button" type="button">载入</button>
            <button class="remove-button remove-text-button" type="button">移除</button>
          </div>
        </div>
        <p class="favorite-meaning text-preview">${escapeHtml(item.text || "")}</p>
        <p class="favorite-date">${formatDate(item.savedAt)}</p>
      `;
      node.querySelector(".load-text-button").addEventListener("click", () => {
        elements.sourceText.value = item.text || "";
        handleSourceInput();
        closeFavorites();
        analyzeText();
        elements.sourceText.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      node.querySelector(".remove-text-button").addEventListener("click", () => {
        state.textFavorites.delete(item.key);
        saveTextFavorites();
        updateTextFavoriteButton();
        renderFavorites();
      });
      section.append(node);
    });

    elements.favoritesList.append(section);
  }

  if (!favorites.length) return;

  const wordsSection = document.createElement("section");
  wordsSection.className = "favorite-section";
  wordsSection.innerHTML = `<h3>单词收藏</h3>`;

  favorites.forEach((item) => {
    const node = document.createElement("article");
    node.className = "favorite-item";
    node.innerHTML = `
      <div class="favorite-main">
        <div>
          <div class="favorite-word">${escapeHtml(item.word)}</div>
          <div class="favorite-reading">${escapeHtml(item.reading || "读音暂缺")}</div>
        </div>
        <button class="remove-button" type="button">移除</button>
      </div>
      <p class="favorite-meaning">${escapeHtml(item.meaning || "暂无释义")}</p>
      <p class="favorite-date">${formatDate(item.savedAt)}</p>
    `;
    node.querySelector(".remove-button").addEventListener("click", () => {
      state.favorites.delete(item.key);
      saveFavorites();
      renderFavorites();
    });
    wordsSection.append(node);
  });

  elements.favoritesList.append(wordsSection);
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "";
  }
}

function hasKanji(text) {
  return /[\u3400-\u9fff々〆〤]/.test(text);
}

function kanaToHiragana(text) {
  return text.replace(/[\u30a1-\u30f6]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

function isTouchMode() {
  return window.matchMedia("(pointer: coarse)").matches;
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
