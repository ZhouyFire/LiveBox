export const PLATFORM_NAMES = { bilibili: '哔哩哔哩', huya: '虎牙', douyu: '斗鱼' };
export const MAX_SUBSCRIPTIONS = 100;
export const DEFAULT_SETTINGS = Object.freeze({ notifications: true, interval: 3, width: 960, height: 640 });
const HOSTS = { 'live.bilibili.com': 'bilibili', 'www.huya.com': 'huya', 'huya.com': 'huya', 'www.douyu.com': 'douyu', 'douyu.com': 'douyu' };
const ORIGINS = { bilibili: 'https://live.bilibili.com/', huya: 'https://www.huya.com/', douyu: 'https://www.douyu.com/' };

export function roomKey(room) { return `${room.platform}:${room.roomId}`; }
export function cleanText(value, limit = 200) { return String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, limit); }
export function normalizeSubscription(input) {
  if (!input || typeof input !== 'object') throw new Error('直播间格式无效');
  let platform = input.platform;
  let roomId = cleanText(input.roomId, 100);
  if (input.url) {
    let url;
    try { url = new URL(input.url); } catch { throw new Error('请输入完整直播间网址'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('直播间网址无效');
    platform = HOSTS[url.hostname];
    const match = /^\/([a-zA-Z0-9_-]+)\/?$/.exec(url.pathname);
    if (!platform || !match) throw new Error('仅支持 B站、虎牙或斗鱼的直播间网址');
    roomId = match[1];
  }
  if (!Object.hasOwn(ORIGINS, platform) || !/^[a-zA-Z0-9_-]{1,64}$/.test(roomId)) throw new Error('平台或房间号无效');
  if (platform === 'bilibili' && !/^[1-9]\d{0,15}$/.test(roomId)) throw new Error('B站房间号必须为 1–16 位正整数');
  if (['directory', 'g', 'l', 'index', 'about', 'activity'].includes(roomId.toLowerCase())) throw new Error('这是列表页，请使用具体直播间网址');
  return { platform, roomId, url: ORIGINS[platform] + roomId, nick: cleanText(input.nick, 80) };
}

export function validateSettings(input = {}) {
  const output = { ...DEFAULT_SETTINGS };
  if (input.notifications !== undefined) {
    if (typeof input.notifications !== 'boolean') throw new Error('通知开关无效');
    output.notifications = input.notifications;
  }
  for (const [key, min, max] of [['interval', 1, 1440], ['width', 480, 1920], ['height', 320, 1080]]) {
    const value = input[key] ?? output[key];
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} 必须为 ${min}–${max} 的整数`);
    output[key] = value;
  }
  return output;
}

export function mergeSubscriptions(current, incoming) {
  if (!Array.isArray(incoming)) throw new Error('导入内容必须是直播间数组');
  if (incoming.length > MAX_SUBSCRIPTIONS) throw new Error(`一次最多导入 ${MAX_SUBSCRIPTIONS} 个直播间`);
  // Validate the entire import before changing any state.
  const normalized = incoming.map(normalizeSubscription);
  const byId = new Map(current.map(room => [roomKey(room), room]));
  for (const room of normalized) {
    const old = byId.get(roomKey(room));
    byId.set(roomKey(room), { ...old, ...room, nick: old?.nick || room.nick });
  }
  if (byId.size > MAX_SUBSCRIPTIONS) throw new Error(`订阅总数不能超过 ${MAX_SUBSCRIPTIONS}`);
  return [...byId.values()];
}

export function reconcile(previous, subscriptions, results, now = Date.now()) {
  const prior = new Map(previous.map(room => [roomKey(room), room]));
  const notifications = new Map();
  const roomMap = new Map();
  const subscriptionMap = new Map();
  subscriptions.forEach((sub, index) => {
    const result = results[index];
    const resolved = result?.ok ? normalizeSubscription({ ...result.room, nick: sub.nick }) : sub;
    const key = roomKey(resolved);
    const old = prior.get(key) || prior.get(roomKey(sub));
    const knownSub = subscriptionMap.get(key);
    const canonical = { ...resolved, nick: knownSub?.nick || resolved.nick };
    subscriptionMap.set(key, canonical);
    if (!result?.ok) {
      if (!roomMap.has(key)) roomMap.set(key, { ...old, ...canonical, error: cleanText(result?.error || '未获取到状态'), attemptedAt: now });
      return;
    }
    const room = { ...result.room, ...canonical, nick: canonical.nick || result.room.nick, error: null, lastGoodLive: result.room.live, checkedAt: now, attemptedAt: now };
    // First successful fetch is a baseline. An error never resets the last known state.
    if (old?.lastGoodLive === false && room.live === true) notifications.set(key, room);
    roomMap.set(key, room);
  });
  return { rooms: [...roomMap.values()], subscriptions: [...subscriptionMap.values()], notifications: [...notifications.values()] };
}

export async function mapLimit(values, limit, task) {
  const result = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) { const index = next++; result[index] = await task(values[index], index); }
  }));
  return result;
}
