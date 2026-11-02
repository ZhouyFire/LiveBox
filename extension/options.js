import { PLATFORM_NAMES, roomKey } from './lib/core.js';
import { $, rpc, status, element, busy } from './lib/ui.js';
let state;
function render() {
  $('#subscription-count').textContent = `${state.subscriptions.length} / 100`;
  $('#subscriptions').replaceChildren();
  if (!state.subscriptions.length) $('#subscriptions').append(element('p', 'hint', '清单还是空的，在上方添加你的第一个直播间。'));
  const cache = new Map(state.rooms.map(room => [roomKey(room), room]));
  for (const room of state.subscriptions) {
    const row = element('div', 'subscription-row');
    const info = element('div');
    const result = cache.get(roomKey(room));
    info.append(element('strong', '', `${room.nick || result?.nick || room.roomId} · ${PLATFORM_NAMES[room.platform]}`));
    const link = element('a', 'hint', room.url); link.href = room.url; link.target = '_blank'; link.rel = 'noreferrer'; info.append(link);
    if (result?.error) info.append(element('span', 'room-error', result.error));
    const remove = element('button', 'text-button danger', '移除');
    remove.addEventListener('click', () => busy(remove, async () => { state = await rpc('removeSubscription', { key: roomKey(room) }); render(); status('已移除订阅'); }));
    row.append(info, remove); $('#subscriptions').append(row);
  }
}
function fillSettings() { for (const [key, value] of Object.entries(state.settings)) { const input = $(`#${key}`); if (input) input.type === 'checkbox' ? input.checked = value : input.value = value; } }
$('#add-form').addEventListener('submit', event => {
  event.preventDefault();
  busy(event.submitter, async () => {
    state = await rpc('addSubscriptions', { subscriptions: [{ url: $('#room-url').value.trim(), nick: $('#room-nick').value.trim() }] });
    $('#add-form').reset(); render(); status('已添加。点击“检查状态”建立开播基线。');
  });
});
$('#settings-form').addEventListener('submit', event => {
  event.preventDefault();
  busy(event.submitter, async () => {
    state = await rpc('saveSettings', { settings: { notifications: $('#notifications').checked, interval: Number($('#interval').value), width: Number($('#width').value), height: Number($('#height').value) } });
    status('设置已保存');
  });
});
$('#refresh').addEventListener('click', () => busy($('#refresh'), async () => {
  status('正在检查直播状态…'); state = await rpc('refresh'); render();
  const errors = state.rooms.filter(room => room.error).length;
  status(`检查完成${errors ? `，${errors} 个直播间暂未获取到状态` : ''}`, Boolean(errors));
}));
$('#import-following').addEventListener('click', () => busy($('#import-following'), async () => {
  status('正在导入，请先确保你已在此浏览器登录 B站…');
  state = await rpc('importFollowing'); render(); status(`已读取 ${state.imported} 个关注直播间并合并到清单；请检查状态。`);
}));
$('#export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ version: 1, subscriptions: state.subscriptions }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = element('a'); link.href = url; link.download = 'livebox-subscriptions.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('#import-file').addEventListener('change', async event => {
  try {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 200000) throw new Error('JSON 文件过大，请控制在 200 KB 以内');
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed) && parsed.version !== 1) throw new Error('不支持的导出文件版本');
    state = await rpc('addSubscriptions', { subscriptions: Array.isArray(parsed) ? parsed : parsed.subscriptions });
    render(); status('导入完成，已自动合并重复的直播间');
  } catch (error) { status(error.message, true); }
  finally { event.target.value = ''; }
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.livebox) { state = changes.livebox.newValue; render(); } });
try { state = await rpc('getState'); render(); fillSettings(); } catch (error) { status(error.message, true); }
