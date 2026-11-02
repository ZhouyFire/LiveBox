(() => {
  const hosts = new Set(['live.bilibili.com', 'www.huya.com', 'www.douyu.com']);
  const excluded = new Set(['directory', 'g', 'l', 'index', 'about', 'activity']);
  function roomUrl(value) {
    try {
      const url = new URL(value, location.href);
      const match = /^\/([a-zA-Z0-9_-]{1,64})\/?$/.exec(url.pathname);
      if (url.protocol !== 'https:' || !hosts.has(url.hostname) || !match || excluded.has(match[1].toLowerCase())) return null;
      if (url.hostname === 'live.bilibili.com' && !/^[1-9]\d{0,15}$/.test(match[1])) return null;
      return `${url.origin}/${match[1]}`;
    } catch { return null; }
  }
  // Shadow DOM keeps the button independent of each site's changing card styles.
  const host = document.createElement('div');
  host.id = 'livebox-mini-launcher';
  host.style.cssText = 'position:fixed;right:20px;bottom:24px;z-index:2147483647';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = 'button{font:12px "Microsoft YaHei",sans-serif;cursor:pointer;border:1px solid #cce5d8;border-radius:20px;color:#fff;background:#087f68;padding:10px 15px;box-shadow:0 3px 15px #0002}button:disabled{opacity:.6}';
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = '▣ 小窗观看'; button.title = '以独立浏览器小窗口打开直播间';
  shadow.append(style, button); document.documentElement.append(host);
  let target = roomUrl(location.href);
  host.hidden = !target;
  document.addEventListener('pointerover', event => {
    const anchor = event.target.closest?.('a[href]');
    const next = anchor ? roomUrl(anchor.href) : null;
    if (!next && event.target === host) return;
    if (!next && !roomUrl(location.href)) return;
    target = next || roomUrl(location.href);
    button.title = `以独立浏览器小窗口打开：${target}`;
    host.hidden = !target;
  }, { passive: true });
  // On a listing page the last hovered room stays selected while moving to this button.
  button.addEventListener('click', async () => {
    if (!target) return;
    button.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ action: 'openRoom', room: { url: target }, small: true });
      if (!response?.ok) throw new Error(response?.error || '后台未响应');
    } catch (error) { button.textContent = '请重新加载扩展后重试'; button.title = error.message; }
    finally { button.disabled = false; }
  });
})();
