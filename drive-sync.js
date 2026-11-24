// One Mac writes the user's chosen iCloud Drive file. Phones can merge its private snapshot.
(() => {
  const fileName = "收藏夹.json";
  const textKey = "japanese-reader-text-favorites";
  const wordKey = "japanese-reader-favorites";
  const deletionsKey = "japanese-reader-drive-deletions-1";
  const maxFileBytes = 8 * 1024 * 1024;
  const status = document.querySelector("#driveSyncStatus");
  const connect = document.querySelector("#driveConnectButton");
  const supported = typeof window.showDirectoryPicker === "function" && !!window.indexedDB;
  let folder = null;
  let activeKey = null;
  let writeTimer;
  let running = false;
  let rerun = false;
  const publisherKey = "japanese-reader-drive-publisher";
  const observed = { items: new Map(), words: new Map() };

  const current = kind => kind === "items" ? state.textFavorites : state.favorites;
  const storageKey = kind => kind === "items" ? textKey : wordKey;
  const nativeMap = records => new Map(records.map(record => [record.key, record]));
  const idOf = (item, kind) => kind === "items" ? item.id || item.key : item.key;
  const timeOf = record => Date.parse(record?.updatedAt || record?.savedAt || "") || 0;
  const dateAfter = record => new Date(Math.max(Date.now(), timeOf(record) + 1)).toISOString();
  const displayStatus = message => { status.textContent = message; };

  function storedArray(key) {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(value)) throw new Error("浏览器里的收藏格式有误。");
    return value;
  }

  function storedTombstones() {
    const raw = JSON.parse(localStorage.getItem(deletionsKey) || '{"items":[],"words":[]}');
    if (!Array.isArray(raw.items) || !Array.isArray(raw.words)) throw new Error("无法读取移除记录。");
    return raw;
  }

  function toFile(item) {
    const record = {
      id: idOf(item, "items"), title: item.title || buildTextFavoriteTitle(item.text), text: item.text,
      savedAt: item.savedAt, updatedAt: item.updatedAt || item.savedAt,
    };
    if (Array.isArray(item.reviewedRuby)) record.ruby = item.reviewedRuby;
    else if (Array.isArray(item.autoRuby)) record.autoRuby = item.autoRuby;
    if (item.parentUpdatedAt) record.parentUpdatedAt = item.parentUpdatedAt;
    return record;
  }

  function fromFile(item) {
    const favorite = {
      id: item.id, key: getTextFavoriteKey(item.text), title: item.title, text: item.text,
      savedAt: item.savedAt || item.updatedAt, updatedAt: item.updatedAt, drivePrivate: true,
    };
    if (item.parentUpdatedAt) favorite.parentUpdatedAt = item.parentUpdatedAt;
    if (item.ruby) favorite.reviewedRuby = item.ruby;
    else if (item.autoRuby) favorite.autoRuby = item.autoRuby;
    return favorite;
  }

  function library() {
    const removed = storedTombstones();
    return {
      v: 1, kind: "jr-library", items: storedArray(textKey).map(toFile), deleted: removed.items,
      words: storedArray(wordKey).map(({ key, word, reading, meaning, savedAt, updatedAt }) => ({ key, word, reading, meaning, savedAt, updatedAt: updatedAt || savedAt })),
      deletedWords: removed.words,
    };
  }

  function validate(snapshot) {
    const dated = x => typeof x?.updatedAt === "string" && Number.isFinite(Date.parse(x.updatedAt));
    const validString = (x, max) => typeof x === "string" && x.length > 0 && x.length <= max;
    if (snapshot?.v !== 1 || snapshot.kind !== "jr-library" || !Array.isArray(snapshot.items)) {
      throw new Error("请选择日语阅读助手的收藏夹文件。");
    }
    for (const name of ["items", "deleted", "words", "deletedWords"]) {
      const rows = snapshot[name] === undefined ? [] : snapshot[name];
      if (!Array.isArray(rows) || rows.length > 12000) throw new Error("收藏夹记录格式有误。");
      const ids = new Set();
      for (const row of rows) {
        const id = name === "words" ? row?.key : row?.id;
        if (!validString(id, 2048) || !dated(row) || ids.has(id)) throw new Error("收藏记录或修改时间无效。");
        ids.add(id);
        if (name === "items") {
          if (!validString(row.text, 200000) || row.text !== row.text.trim() || !validString(row.title, 1024)) {
            throw new Error("收藏的正文或标题有误。");
          }
          if (row.ruby !== undefined) reviewedTokens(row.text, row.ruby);
          if (row.autoRuby !== undefined) reviewedTokens(row.text, row.autoRuby);
        } else if (name === "words" &&
            (!validString(row.word, 1024) || typeof row.meaning !== "string" || typeof row.reading !== "string")) {
          throw new Error("单词收藏记录有误。");
        }
      }
    }
  }

  // Both sides are read before a write. An explicit removal wins over an older copy.
  function mergeRows(kind, left, right, leftGone, rightGone) {
    const rows = new Map(), gone = new Map();
    for (const item of [...left, ...right]) {
      const id = kind === "items" ? item.id : item.key;
      const old = rows.get(id);
      if (kind === "items" && old && item.parentUpdatedAt && old.parentUpdatedAt === item.parentUpdatedAt && old.text !== item.text) {
        const loser = timeOf(item) > timeOf(old) ? old : item;
        const copyId = id + "-conflict-" + getTextFavoriteKey(loser.text);
        rows.set(copyId, { ...loser, id: copyId, title: loser.title + "（冲突副本）" });
      }
      if (!old || timeOf(item) > timeOf(old) ||
          (timeOf(item) === timeOf(old) && !old.ruby && item.ruby)) rows.set(id, item);
    }
    for (const entry of [...leftGone, ...rightGone]) {
      if (!gone.has(entry.id) || timeOf(entry) > timeOf(gone.get(entry.id))) gone.set(entry.id, entry);
    }
    for (const [id, removal] of gone) {
      if (timeOf(rows.get(id)) > timeOf(removal)) gone.delete(id);
      else rows.delete(id);
    }
    return [[...rows.values()], [...gone.values()]];
  }

  function isPublisher() {
    return !!folder || localStorage.getItem(publisherKey) === "1";
  }

  function importLibrary(inbound) {
    if (isPublisher()) {
      validate(inbound);
      const ids = new Set(inbound.items.map(i => i.id));
      return [...state.textFavorites.values()].filter(i => ids.has(idOf(i, "items")));
    }
    return mergeSnapshot(inbound, false);
  }

  function mergeSnapshot(inbound, fromDisk) {
    validate(inbound);
    const local = library();
    const localItems = new Map(storedArray(textKey).map(i => [idOf(i, "items"), i]));
    const localWords = new Map(storedArray(wordKey).map(i => [i.key, i]));
    const owns = (set, id) => fromDisk || !set.has(id) || set.get(id).driveMirrored;
    const incomingItems = inbound.items.filter(i => owns(localItems, i.id) || localItems.get(i.id).text === i.text);
    const incomingWords = (inbound.words || []).filter(i => owns(localWords, i.key) ||
      localWords.get(i.key).word === i.word && localWords.get(i.key).reading === i.reading);
    const mergedDeletes = (inbound.deleted || []).filter(i => owns(localItems, i.id));
    const mergedWordDeletes = (inbound.deletedWords || []).filter(i => owns(localWords, i.id));
    const [items, deleted] = mergeRows("items", local.items, incomingItems, local.deleted, mergedDeletes);
    const [words, deletedWords] = mergeRows("words", local.words, incomingWords, local.deletedWords, mergedWordDeletes);
    const incomingIds = new Set(incomingItems.map(i => i.id));
    const wordIds = new Set(incomingWords.map(i => i.key));
    const nativeItems = new Map();
    for (const record of items) {
      const prior = localItems.get(record.id);
      const mirrored = incomingIds.has(record.id) || prior?.driveMirrored;
      const entry = fromDisk || mirrored ? { ...fromFile(record), driveMirrored: !!mirrored } : prior || fromFile(record);
      const duplicate = nativeItems.get(entry.key);
      if (duplicate && duplicate.text !== entry.text) throw new Error("有两篇不同的文本使用了相同的收藏编号。");
      if (!duplicate) nativeItems.set(entry.key, entry);
      else {
        // A manually imported copy can precede the first cloud import. Adopt the cloud identity.
        const preferred = incomingIds.has(entry.id) && !incomingIds.has(duplicate.id) ? entry
          : incomingIds.has(duplicate.id) && !incomingIds.has(entry.id) ? duplicate
          : timeOf(entry) > timeOf(duplicate) ? entry : duplicate;
        const reviewed = preferred.reviewedRuby || entry.reviewedRuby || duplicate.reviewedRuby;
        nativeItems.set(entry.key, reviewed ? { ...preferred, reviewedRuby: reviewed } : preferred);
      }
    }
    const activeId = activeKey && idOf(state.textFavorites.get(activeKey) || {}, "items");
    // localStorage is authoritative across tabs; keep in-memory views in step with successful writes.
    const nativeWords = words.map(w => ({ ...w, driveMirrored: !!(wordIds.has(w.key) || localWords.get(w.key)?.driveMirrored) }));
    const updates = new Map([[textKey, [...nativeItems.values()]], [wordKey, nativeWords], [deletionsKey, { items: deleted, words: deletedWords }]]);
    const originals = new Map();
    try {
      for (const [key, value] of updates) {
        const old = localStorage.getItem(key);
        localStorage.setItem(key, JSON.stringify(value));
        originals.set(key, old);
      }
    } catch (error) {
      for (const [key, value] of originals) {
        if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
      }
      throw error;
    }
    state.textFavorites = nativeItems;
    state.favorites = nativeMap(nativeWords);
    observe("items");
    observe("words");
    // A stale open editor must never blindly edit the remote revision that just arrived.
    if (activeId && !nativeItems.has(activeKey)) activeKey = null;
    updateTextFavoriteButton();
    if (elements.favoritesDrawer.getAttribute("aria-hidden") === "false") renderFavorites();
    return [...nativeItems.values()].filter(item => incomingIds.has(item.id));
  }

  function observe(kind) {
    observed[kind] = new Map(current(kind));
  }

  function automaticRubyFor(text) {
    if (state.lastText !== text || !Array.isArray(state.lastTokens)) return undefined;
    const result = [];
    for (const token of state.lastTokens) {
      let offset = token.start;
      const segments = token.rubySegments || buildRubySegments(token.surface, token.reading || "");
      for (const part of segments) {
        const end = offset + part.text.length;
        if (part.reading && /^[ぁ-ゖゝゞー]{1,128}$/u.test(part.reading) &&
            /^[\p{Script=Han}々〆ヶヵぁ-ゖァ-ヺー0-9０-９]+$/u.test(part.text) &&
            text.slice(offset, end) === part.text && (offset >= (result.at(-1)?.[1] || 0))) {
          result.push([offset, end, part.reading]);
        }
        offset = end;
      }
    }
    return result.length ? result : undefined;
  }

  function saveChanges(kind) {
    const entries = current(kind), before = observed[kind];
    const persisted = nativeMap(storedArray(storageKey(kind)));
    const oldById = new Map([...before.values()].map(x => [idOf(x, kind), x]));
    const removed = storedTombstones();
    const tombstones = new Map(removed[kind].map(x => [x.id, x]));
    const persistentIds = new Map([...persisted.values()].map(x => [idOf(x, kind), x]));
    const currentIds = new Set([...entries.values()].map(x => idOf(x, kind)));
    for (const [key, previous] of before) {
      const id = idOf(previous, kind);
      if (!entries.has(key)) {
        const latest = persistentIds.get(id);
        if (latest && timeOf(latest) > timeOf(previous) && latest !== previous) continue;
        persisted.delete(key);
        if (!currentIds.has(id)) tombstones.set(id, { id, updatedAt: dateAfter(previous) });
      }
    }
    for (const [key, item] of entries) {
      if (item === before.get(key)) continue;
      const id = idOf(item, kind);
      const previous = oldById.get(id);
      const record = { ...item, updatedAt: dateAfter(previous || tombstones.get(id)) };
      if (kind === "items") {
        const remote = persistentIds.get(id);
        const conflict = previous && (timeOf(tombstones.get(id)) > timeOf(previous) ||
          remote && remote.text !== item.text && remote.text !== previous.text);
        record.id = conflict ? id + "-conflict-" + key : id;
        if (conflict) record.title += "（冲突副本）";
        else if (previous) record.parentUpdatedAt = previous.updatedAt || previous.savedAt;
        if (!record.reviewedRuby && !record.autoRuby) record.autoRuby = automaticRubyFor(record.text);
        if (folder) record.drivePrivate = true;
      }
      persisted.set(key, record);
      tombstones.delete(idOf(record, kind));
    }
    removed[kind] = [...tombstones.values()];
    localStorage.setItem(storageKey(kind), JSON.stringify([...persisted.values()]));
    localStorage.setItem(deletionsKey, JSON.stringify(removed));
    if (kind === "items") state.textFavorites = persisted;
    else state.favorites = persisted;
    observe(kind);
    schedule();
  }

  // Map exact unchanged spans. Never transfer a reading to a different surviving occurrence by guess.
  function carryRuby(oldText, newText, spans) {
    const left = commonPrefixLength(oldText, newText);
    const right = Math.min(commonSuffixLength(oldText, newText), Math.min(oldText.length, newText.length) - left);
    const delta = newText.length - oldText.length;
    return spans.flatMap(([start, end, reading]) => {
      if (end <= left) return [[start, end, reading]];
      if (start >= oldText.length - right) return [[start + delta, end + delta, reading]];
      const before = oldText.slice(Math.max(left, start - 10), start);
      const after = oldText.slice(end, Math.min(oldText.length - right, end + 10));
      if (before.length < 3 || after.length < 3) return [];
      const anchor = before + oldText.slice(start, end) + after;
      const changed = newText.slice(left, newText.length - right);
      const position = changed.indexOf(anchor);
      if (position < 0 || changed.indexOf(anchor, position + 1) >= 0) return [];
      const mapped = left + position + before.length;
      return [[mapped, mapped + end - start, reading]];
    }).filter((entry, index, list) => !index || entry[0] >= list[index - 1][1]);
  }

  function select(text) {
    const key = getTextFavoriteKey(text || "");
    activeKey = state.textFavorites.get(key)?.text === text ? key : null;
  }

  function edit(value) {
    const text = value.trim();
    const old = state.textFavorites.get(activeKey);
    if (!old || !text || text === old.text) return;
    const key = getTextFavoriteKey(text);
    if (state.textFavorites.has(key) && key !== activeKey) {
      displayStatus("当前内容与另一篇收藏相同，已保留两篇原稿。");
      return;
    }
    const next = { ...old, key, id: idOf(old, "items"), text };
    if (old.title === buildTextFavoriteTitle(old.text)) next.title = buildTextFavoriteTitle(text);
    if (old.reviewedRuby) next.reviewedRuby = carryRuby(old.text, text, old.reviewedRuby);
    if (old.autoRuby) next.autoRuby = carryRuby(old.text, text, old.autoRuby);
    const previousKey = activeKey;
    const localCopy = old.driveMirrored && !isPublisher();
    if (localCopy) {
      next.id = key;
      next.driveMirrored = false;
      next.title += "（本机副本）";
      delete next.parentUpdatedAt;
    } else state.textFavorites.delete(previousKey);
    state.textFavorites.set(key, next);
    try {
      saveChanges("items");
      activeKey = key;
    } catch (error) {
      state.textFavorites.delete(key);
      state.textFavorites.set(previousKey, old);
      displayStatus(error.message);
    }
  }

  async function openItem(id) {
    const item = [...state.textFavorites.values()].find(row => idOf(row, "items") === id);
    if (!item) return false;
    elements.sourceText.value = item.text;
    handleSourceInput();
    closeFavorites();
    await analyzeText();
    return true;
  }

  async function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("japanese-reader-drive", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("handles");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function folderReference(value) {
    const db = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("handles", value ? "readwrite" : "readonly");
        const store = tx.objectStore("handles");
        const request = value ? store.put(value, "library") : store.get("library");
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = tx.onerror = () => reject(tx.error || request.error);
      });
    } finally {
      db.close();
    }
  }

  const readWrite = { mode: "readwrite" };
  function schedule() {
    if (!folder) return;
    clearTimeout(writeTimer);
    displayStatus("正在将收藏写入 iCloud 云盘文件…");
    writeTimer = setTimeout(flush, 400);
  }

  async function mergeFile() {
    if (await folder.queryPermission(readWrite) !== "granted") {
      connect.textContent = "恢复 iCloud 云盘连接";
      throw new Error("需要重新允许浏览器访问收藏夹。");
    }
    const handle = await folder.getFileHandle(fileName, { create: true });
    for (let retry = 0; retry < 3; retry++) {
      const file = await handle.getFile();
      if (file.size > maxFileBytes) throw new Error("收藏夹文件过大。");
      const oldText = await file.text();
      if (oldText) mergeSnapshot(JSON.parse(oldText), true);
      const data = JSON.stringify(library());
      if (new Blob([data]).size > maxFileBytes) throw new Error("收藏夹文件过大。");
      if (data !== oldText) {
        const stream = await handle.createWritable();
        try {
          if (await (await handle.getFile()).text() !== oldText) { await stream.abort(); continue; }
          await stream.write(data);
          await stream.close();
        } catch (error) {
          try { await stream.abort(); } catch { /* Already closed. */ }
          throw error;
        }
      }
      connect.textContent = "已连接 iCloud 云盘";
      displayStatus("已写入「" + folder.name + "/" + fileName + "」。");
      return;
    }
    throw new Error("收藏夹正在被修改，稍后会重新同步。");
  }

  async function flush() {
    if (!folder) return;
    if (running) { rerun = true; return; }
    running = true;
    try {
      const action = () => mergeFile();
      if (navigator.locks) await navigator.locks.request("japanese-reader-drive-write", action);
      else await action();
    } catch (error) {
      displayStatus("收藏保留在此浏览器。" + (error.name === "NotAllowedError" ? "请重新允许访问 iCloud 云盘文件夹。" : error.message));
    } finally {
      running = false;
      if (rerun) { rerun = false; schedule(); }
    }
  }

  async function chooseFolder() {
    const wasConnected = !!folder;
    try {
      if (!folder || await folder.queryPermission(readWrite) === "granted") {
        folder = await window.showDirectoryPicker({ mode: "readwrite", id: "japanese-reader-library" });
      } else if (await folder.requestPermission(readWrite) !== "granted") {
        displayStatus("此浏览器尚未获准写入 iCloud 云盘。");
        return;
      }
      await folderReference(folder);
      localStorage.setItem(publisherKey, "1");
      await flush();
    } catch (error) {
      if (error.name !== "AbortError") displayStatus("无法连接 iCloud 云盘。" + error.message);
      else if (!wasConnected) displayStatus("Mac 首次连接时，选择 iCloud 云盘 → 快捷指令 → 日语阅读助手。");
    }
  }

  connect.hidden = !supported;
  if (supported) displayStatus("Mac 首次连接时，选择 iCloud 云盘 → 快捷指令 → 日语阅读助手。");
  else connect.style.display = "none";
  connect.addEventListener("click", chooseFolder);
  let restored;
  const ready = new Promise(resolve => { restored = resolve; });
  window.readerDrive = { ready, importLibrary, openItem, isPublisher, observe, saveChanges, select, edit };
  window.addEventListener("storage", event => {
    if (event.key === textKey) { loadTextFavorites(); updateTextFavoriteButton(); }
    if (event.key === wordKey) loadFavorites();
    if (elements.favoritesDrawer.getAttribute("aria-hidden") === "false") renderFavorites();
  });
  document.addEventListener("DOMContentLoaded", async () => {
    try {
      if (supported) folder = await folderReference();
    } catch { /* The reader remains usable with local favorites. */ }
    finally { restored(); }
    if (folder) await flush();
  });
  document.addEventListener("visibilitychange", () => {
    if (folder && document.visibilityState === "visible") flush();
    else if (folder && writeTimer) { clearTimeout(writeTimer); flush(); }
  });
})();
