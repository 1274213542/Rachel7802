// Apple Shortcuts supplies the private iCloud file in the URL fragment.
(() => {
  const prefix = '#jr-library=';
  const maxBytes = 8 * 1024 * 1024;
  let revision = 0;

  function decodeLibrary(fragment) {
    if (fragment.length > maxBytes * 4) throw new Error();
    // Apple URL Encode escapes the padding and may encode '+' as %2B.
    const encoded = decodeURIComponent(fragment).replace(/[\t\r\n ]/g, '');
    if (encoded.length > 4 * Math.ceil(maxBytes / 3) ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error();
    const binary = atob(encoded);
    if (!binary.length || binary.length > maxBytes) throw new Error();
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
  }

  async function readLibrary(readSnapshot, fromFile = false, current = () => true) {
    const token = ++revision;
    const isCurrent = () => token === revision && current();
    const status = document.getElementById('cloudLibraryStatus');
    const display = (message, error = false) => {
      if (!isCurrent()) return;
      status.hidden = false;
      status.textContent = message;
      if (fromFile) elements.analysisStatus.textContent = message;
      if (error) openFavorites();
    };
    let snapshot;
    try {
      snapshot = readSnapshot();
    } catch {
      display('这次收到的收藏夹不完整。请等 iCloud 同步完，再运行「日语阅读助手」。', true);
      return;
    }
    try {
      await window.readerDrive.ready;
      if (!isCurrent()) return;
      const report = fromFile ? { localCopies: 0 } : null;
      const rows = window.readerDrive.importLibrary(snapshot, report);
      if (!rows.length) {
        display('iCloud 收藏夹已读取。');
        openFavorites();
        return;
      }
      const latest = rows.slice().sort((a,b) =>
        Date.parse(b.updatedAt || b.savedAt) - Date.parse(a.updatedAt || a.savedAt))[0];
      await window.readerDrive.openItem(latest.id);
      if (!isCurrent()) return;
      const modified = new Date(latest.updatedAt || latest.savedAt).toLocaleString('zh-CN', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      const kept = report?.localCopies ? '本机改过的稿件已另外保留。' : '';
      display((fromFile ? '已导入收藏夹文件，当前稿件修改于 ' : '已从 iCloud 打开，最近修改于 ') + modified + '。' + kept);
    } catch (error) {
      display(fromFile ? '导入失败。' + (error.message || '请重新选择收藏夹文件。') : '暂时无法打开这份 iCloud 收藏夹。已保留原有收藏，可稍后从快捷指令重试。', true);
    }
  }

  function readFromShortcut() {
    if (!location.hash.startsWith(prefix)) return;
    const data = location.hash.slice(prefix.length);
    history.replaceState(history.state, '', location.pathname + location.search);
    void readLibrary(() => decodeLibrary(data));
  }

  window.openReaderLibraryFile = (snapshot, current) => readLibrary(() => snapshot, true, current);

  // A normal website cannot read iCloud Drive on iOS. Keep this a user gesture.
  const drawerHeader = document.querySelector('#favoritesDrawer .drawer-header');
  const status = document.createElement('p');
  status.id = 'cloudLibraryStatus';
  status.className = 'muted-status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  drawerHeader.after(status);
  const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (appleMobile) {
    const open = document.createElement('a');
    open.className = 'ghost-button';
    open.textContent = '从 iCloud 打开最新收藏';
    open.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent('日语阅读助手');
    status.after(open);
  }
  window.addEventListener('hashchange', readFromShortcut);
  void readFromShortcut();
})();
