import { DEFAULT_SETTINGS, normalizeSubscription, validateSettings, mergeSubscriptions, roomKey, reconcile, mapLimit } from './core.js';
import { fetchRoom, fetchBilibiliFollowing } from './providers.js';
export const ALARM_NAME = 'livebox-refresh';

export function createController(api, dependencies = {}) {
  const getRoom = dependencies.fetchRoom || fetchRoom;
  const getFollowing = dependencies.fetchFollowing || fetchBilibiliFollowing;
  let queue = Promise.resolve();
  let refreshPromise;
  const serialize = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  function resolveKey(key, aliases = {}) {
    const visited = new Set();
    while (aliases[key] && aliases[key] !== key && !visited.has(key)) { visited.add(key); key = aliases[key]; }
    return key;
  }
  async function read() {
    const { livebox } = await api.storage.local.get('livebox');
    return { subscriptions: [], rooms: [], aliases: {}, settings: { ...DEFAULT_SETTINGS }, lastRefresh: null, ...livebox };
  }
  async function write(state) { await api.storage.local.set({ livebox: state }); }
  async function ensureAlarm(settings) {
    const current = await api.alarms.get(ALARM_NAME);
    if (!settings.notifications) { if (current) await api.alarms.clear(ALARM_NAME); return; }
    if (!current || current.periodInMinutes !== settings.interval) await api.alarms.create(ALARM_NAME, { delayInMinutes: settings.interval, periodInMinutes: settings.interval });
  }
  async function updateBadge(rooms) {
    const count = rooms.filter(room => !room.error && room.live).length;
    await api.action.setBadgeText({ text: count ? String(count) : '' });
    await api.action.setBadgeBackgroundColor({ color: '#087f68' });
  }
  async function refreshWork() {
    const state = await read();
    const results = await mapLimit(state.subscriptions, 6, async sub => {
      try { return { ok: true, room: await getRoom(sub, { signal: AbortSignal.timeout(9000) }) }; }
      catch (error) { return { ok: false, error: error.name === 'TimeoutError' || error.name === 'AbortError' ? '请求超时，请稍后重试' : error.message }; }
    });
    const result = reconcile(state.rooms, state.subscriptions, results);
    // Keep short/alias identities so an already queued UI action still targets the resolved room.
    state.subscriptions.forEach((sub, index) => {
      if (results[index]?.ok) state.aliases[roomKey(sub)] = roomKey(normalizeSubscription(results[index].room));
    });
    state.rooms = result.rooms;
    state.subscriptions = result.subscriptions;
    state.lastRefresh = Date.now();
    // Persist the transition before delivering notifications: a worker restart must not duplicate them.
    await write(state);
    await updateBadge(state.rooms);
    const failures = [];
    if (state.settings.notifications) {
      for (const room of result.notifications) {
        try {
          await api.notifications.create(`livebox:${roomKey(room)}`, { type: 'basic', iconUrl: api.runtime.getURL('icons/icon128.png'), title: `${room.nick || room.roomId} 开播了`, message: room.title || '点击前往直播间', contextMessage: room.platform });
        } catch (error) { failures.push(error.message); }
      }
    }
    // Surface OS/browser notification failures without discarding room state.
    state.notificationError = failures.length ? failures.join('; ') : null;
    await write(state);
    return { ...state, refreshing: false };
  }
  function refresh() {
    if (!refreshPromise) refreshPromise = serialize(refreshWork).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }
  async function dispatch(message) {
    switch (message?.action) {
      case 'getState': return { ...await read(), refreshing: Boolean(refreshPromise) };
      case 'refresh': return refresh();
      case 'addSubscriptions': return serialize(async () => {
        const state = await read();
        state.subscriptions = mergeSubscriptions(state.subscriptions, message.subscriptions);
        await write(state);
        return state;
      });
      case 'removeSubscription': return serialize(async () => {
        const state = await read();
        const target = resolveKey(message.key, state.aliases);
        state.subscriptions = state.subscriptions.filter(sub => resolveKey(roomKey(sub), state.aliases) !== target);
        state.rooms = state.rooms.filter(sub => resolveKey(roomKey(sub), state.aliases) !== target);
        const obsolete = Object.keys(state.aliases).filter(key => resolveKey(key, state.aliases) === target);
        for (const key of obsolete) delete state.aliases[key];
        await write(state);
        await updateBadge(state.rooms);
        return state;
      });
      case 'saveSettings': return serialize(async () => {
        const settings = validateSettings(message.settings);
        const state = await read();
        await ensureAlarm(settings);
        state.settings = settings;
        await write(state);
        return state;
      });
      case 'importFollowing': return serialize(async () => {
        const subscriptions = await getFollowing({ signal: AbortSignal.timeout(20000) });
        const state = await read();
        state.subscriptions = mergeSubscriptions(state.subscriptions, subscriptions);
        await write(state);
        return { ...state, imported: subscriptions.length };
      });
      case 'openRoom': {
        const room = normalizeSubscription(message.room);
        if (message.small) {
          const { settings } = await read();
          return api.windows.create({ url: room.url, type: 'popup', width: settings.width, height: settings.height, focused: true });
        }
        return api.tabs.create({ url: room.url });
      }
      default: throw new Error('未知操作');
    }
  }
  return { dispatch, refresh, initialize: () => serialize(async () => { const state = await read(); await ensureAlarm(state.settings); }) };
}
