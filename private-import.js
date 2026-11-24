// Reviewed readings use UTF-16 offsets, the same offsets as the reader and DOM selections.
function reviewedTokens(text, ruby) {
  if (!Array.isArray(ruby) || ruby.length > 12000) throw new Error("注音条目格式有误。");
  let previousEnd = 0;
  return ruby.map((span, index) => {
    if (!Array.isArray(span) || span.length !== 3) throw new Error("注音条目格式有误。");
    const [start, end, reading] = span;
    if (!Number.isInteger(start) || !Number.isInteger(end) ||
        start < previousEnd || end <= start || end > text.length || end - start > 128 ||
        typeof reading !== "string" || !/^[ぁ-ゖゝゞー]{1,128}$/u.test(reading)) {
      throw new Error("注音的位置或读音有误。");
    }
    const surface = text.slice(start, end);
    if (!/^[\p{Script=Han}々〆ヶヵぁ-ゖァ-ヺー0-9０-９]+$/u.test(surface)) {
      throw new Error("注音的位置与正文不符。");
    }
    previousEnd = end;
    return {
      id: `reviewed-${index}`, start, end, surface, base: surface, reading,
      displayReading: reading, rubySegments: [{ text: surface, reading }],
      lookup: true, reviewed: true,
    };
  });
}

(() => {
  const prefix = "#jr1=";
  const maxJsonBytes = 512 * 1024;
  const maxCompressedBytes = 64 * 1024;
  let importRevision = 0;

  async function decodeLink(encoded) {
    if (encoded.length > Math.ceil(maxCompressedBytes * 4 / 3) ||
        !/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) {
      throw new Error("导入链接不完整或过长。");
    }
    if (!window.DecompressionStream) throw new Error("此浏览器不支持压缩链接，可在收藏夹导入 JSON 文件。");
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxJsonBytes) {
          await reader.cancel();
          throw new Error("文本文件过大。");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return new Blob(chunks).arrayBuffer();
  }

  function parseArticle(buffer) {
    const item = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
    if (item?.v !== 1 || typeof item.title !== "string" || typeof item.text !== "string" ||
        !item.title.trim() || item.title.length > 180 || !item.text || item.text.length > 60000 ||
        item.text !== item.text.trim() || /[\u0000-\u001f]/.test(item.title) ||
        /[\u0000-\u0008\u000b-\u001f]/.test(item.text) ||
        /<\/?[a-z][^>]*>/i.test(item.title + "\n" + item.text)) {
      throw new Error("标题或正文格式有误。");
    }
    reviewedTokens(item.text, item.ruby);
    return { title: item.title.trim(), text: item.text, reviewedRuby: item.ruby };
  }

  function saveArticle(article) {
    loadTextFavorites(true);
    const key = getTextFavoriteKey(article.text);
    const existing = state.textFavorites.get(key);
    if (existing && existing.text !== article.text) throw new Error("此文本与另一条收藏发生冲突。");
    if (existing?.title === article.title &&
        JSON.stringify(existing.reviewedRuby) === JSON.stringify(article.reviewedRuby)) return;
    state.textFavorites.set(key, {
      ...existing, ...article, key, savedAt: existing?.savedAt || new Date().toISOString(),
    });
    try {
      saveTextFavorites();
    } catch {
      if (existing) state.textFavorites.set(key, existing);
      else state.textFavorites.delete(key);
      throw new Error("浏览器无法保存收藏，请检查可用空间或浏览器设置。");
    }
  }

  async function importArticle(readBuffer) {
    const revision = ++importRevision;
    const feedback = document.querySelector("#importReviewedStatus");
    feedback.textContent = "";
    try {
      const article = parseArticle(await readBuffer());
      if (revision !== importRevision) return;
      saveArticle(article);
      elements.sourceText.value = article.text;
      handleSourceInput();
      closeFavorites();
      await analyzeText();
      if (revision === importRevision && state.lastText === article.text) {
        elements.analysisStatus.textContent = "已收藏，已显示校对过的假名。";
      }
    } catch (error) {
      if (revision !== importRevision) return;
      const reason = error instanceof Error && /[\u3400-\u9fff]/.test(error.message)
        ? error.message : "请检查导入链接或文件是否完整。";
      feedback.textContent = elements.analysisStatus.textContent = "导入失败。" + reason;
    }
  }

  function consumeLink() {
    if (!location.hash.startsWith(prefix)) return;
    const encoded = location.hash.slice(prefix.length);
    history.replaceState(history.state, "", location.pathname + location.search);
    void importArticle(() => decodeLink(encoded));
  }

  const fileInput = document.querySelector("#importReviewedFile");
  document.querySelector("#importReviewedButton").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (file) void importArticle(() => {
      if (file.size > maxJsonBytes) throw new Error("文本文件过大。");
      return file.arrayBuffer();
    });
  });
  window.addEventListener("hashchange", consumeLink);
  consumeLink();
})();
