import { PLATFORM_NAMES, roomKey } from './lib/core.js';
import { $, rpc, status, element, safeImage, busy } from './lib/ui.js';
let state;
const openOptions = () => chrome.runtime.openOptionsPage();
for (const id of ['settings', 'manage', 'add-first']) $(`#${id}`).addEventListener('click', openOptions);
function render() {
  if (!state) return;
  const cached = new Map(state.rooms.map(room => [roomKey(room), room]));
  const rooms = state.subscriptions.map(sub => ({ ...cached.get(roomKey(sub)), ...sub, nick: sub.nick || cached.get(roomKey(sub))?.nick || sub.roomId }));
  const liveCount = rooms.filter(room => room.live && !room.error).length;
  $('#live-count').textContent = liveCount;
  $('#updated').textContent = state.refreshing ? '正在刷新…' : state.lastRefresh ? `${new Date(state.lastRefresh).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 检查` : '还未刷新';
  const query = $('#search').value.trim().toLowerCase();
  const filtered = rooms.filter(room => (!$('#platform').value || room.platform === $('#platform').value) && (!$('#live-only').checked || room.live && !room.error) && `${room.nick} ${room.title || ''}`.toLowerCase().includes(query));
  filtered.sort((a, b) => Number(b.live && !b.error) - Number(a.live && !a.error));
  $('#rooms').replaceChildren();
  $('#empty').hidden = rooms.length > 0;
  for (const room of filtered) {
    const card = element('article', 'room-card');
    const cover = element('div', `cover ${room.platform}`);
    cover.append(element('span', 'cover-placeholder', PLATFORM_NAMES[room.platform].slice(0, 1)));
    const imageUrl = safeImage(room.cover);
    if (imageUrl) { const img = element('img'); img.src = imageUrl; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.addEventListener('error', () => img.remove()); cover.append(img); }
    const isLive = room.live && !room.error;
    cover.append(element('span', `live-tag ${isLive ? 'on' : ''}`, room.error ? '状态未知' : isLive ? '● 直播中' : room.checkedAt ? '未开播' : '待检查'));
    const info = element('div', 'room-info');
    info.append(element('span', `platform-label ${room.platform}`, PLATFORM_NAMES[room.platform]));
    info.append(element('h3', '', room.title || room.nick));
    const details = [room.nick, room.category].filter(Boolean).join(' · ');
    info.append(element('p', 'room-meta', details));
    if (room.error) { const error = element('p', 'room-error', room.error); error.title = room.error; info.append(error); }
    else if (isLive) {
      let subtitle = Number.isFinite(room.viewers) ? `${Intl.NumberFormat('zh-CN', { notation: 'compact' }).format(room.viewers)} 人气` : '正在直播';
      if (room.startedAt && room.startedAt < Date.now()) subtitle += ` · 已播 ${Math.floor((Date.now() - room.startedAt) / 60000)} 分钟`;
      info.append(element('p', 'room-meta', subtitle));
    }
    const actions = element('div', 'room-actions');
    for (const [label, small] of [['进入直播间 ↗', false], ['▣ 小窗观看', true]]) {
      const button = element('button', `button ${small ? 'secondary' : 'primary'}`, label);
      button.addEventListener('click', () => busy(button, () => rpc('openRoom', { room, small })));
      actions.append(button);
    }
    card.append(cover, info, actions);
    $('#rooms').append(card);
  }
  if (rooms.length && !filtered.length) $('#rooms').append(element('p', 'no-results', '没有符合筛选条件的直播间'));
  if (state.notificationError) status(`通知未成功发送：${state.notificationError}`, true);
}
async function refresh() {
  await busy($('#refresh'), async () => { status('正在检查直播状态…'); state = await rpc('refresh'); status(''); render(); });
}
$('#refresh').addEventListener('click', refresh);
for (const id of ['search', 'platform', 'live-only']) $(`#${id}`).addEventListener('input', render);
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.livebox) { state = changes.livebox.newValue; render(); } });
try { state = await rpc('getState'); render(); if (state.subscriptions.length) await refresh(); }
catch (error) { status(error.message, true); }
