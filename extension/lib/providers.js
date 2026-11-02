// Public platform adapters. Platform response schemas may change independently.
const MAX_FOLLOW_PAGES = 20;
const FOLLOW_PAGE_SIZE = 100;

function object(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value;
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function numeric(value, message) {
  if (!['number', 'string'].includes(typeof value) || value === '' || !Number.isFinite(Number(value))) {
    throw new Error(message);
  }
  return Number(value);
}

function roomId(value) {
  const id = String(value ?? '');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new Error('直播间编号无效');
  return id;
}

function canonicalNumericId(value) {
  const id = String(value ?? '');
  if (!/^[1-9]\d{0,15}$/.test(id)) throw new Error('平台返回的直播间编号无效');
  return id;
}

export function safeImage(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.href;
  } catch { return ''; }
}

function epoch(value) {
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value ?? ''))) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    return number < 1e12 ? number * 1000 : number;
  }
  if (typeof value !== 'string' || !value || value.startsWith('0000-')) return null;
  // Platform date strings represent China Standard Time, independent of client timezone.
  const chinaDate = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)
    ? `${value.replace(' ', 'T')}+08:00` : value;
  const date = Date.parse(chinaDate);
  return Number.isFinite(date) && date > 0 ? date : null;
}

async function jsonRequest(url, {fetchImpl, signal}, credentials = 'omit') {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET', credentials, cache: 'no-store',
      signal: signal ?? AbortSignal.timeout(12000),
    });
  } catch (error) {
    if (signal?.aborted || ['AbortError', 'TimeoutError'].includes(error?.name)) {
      throw new Error('平台请求超时或已取消，请稍后重试');
    }
    throw new Error('无法连接直播平台，请检查网络后重试');
  }
  if (!response.ok) throw new Error(`平台请求失败（HTTP ${response.status}）`);
  try { return object(await response.json(), '平台响应结构已变化'); }
  catch { throw new Error('平台未返回有效 JSON，可能需要登录或通过平台验证'); }
}

function checkCode(result, key, success, platform) {
  if (!(key in result)) throw new Error(`${platform}响应结构已变化（缺少状态码）`);
  if (numeric(result[key], `${platform}响应状态码无效`) !== success) {
    throw new Error(`${platform}接口拒绝请求（${String(result[key]).slice(0,16)}），请检查直播间、登录状态或平台验证`);
  }
}

async function bilibili(subscription, options) {
  if (!/^[1-9]\d{0,15}$/.test(subscription.roomId)) throw new Error('B站直播间编号必须为正整数');
  const url = `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${encodeURIComponent(subscription.roomId)}`;
  const result = await jsonRequest(url, options);
  checkCode(result, 'code', 0, 'B站');
  const data = object(result.data, 'B站响应结构已变化（缺少房间数据）');
  const status = numeric(data.live_status, 'B站响应结构已变化（缺少开播状态）');
  if (![0, 1, 2].includes(status)) throw new Error('B站返回未知开播状态');
  const id = canonicalNumericId(data.room_id);
  return {
    ...subscription, roomId: id, url: `https://live.bilibili.com/${id}`,
    title: text(data.title, subscription.title || '直播间'),
    nick: text(data.uname, subscription.nick || `B站 ${id}`),
    cover: safeImage(data.user_cover || data.keyframe), category: text(data.area_name),
    viewers: numeric(data.online, 'B站响应结构已变化（缺少人气）'),
    live: status === 1, startedAt: status === 1 ? epoch(data.live_time) : null, checkedAt: Date.now(),
  };
}

async function huya(subscription, options) {
  const url = new URL('https://www.huya.com/cache.php');
  url.search = new URLSearchParams({m: 'Live', do: 'profileRoom', roomid: subscription.roomId});
  let result;
  try { result = await jsonRequest(url.href, options); }
  catch (error) {
    if (options.signal?.aborted) throw error;
    // Some responses from the JSON route are HTML rather than JSON.
    // Read the same public room's JSON bootstrap without executing page scripts.
    return huyaPage(subscription, options);
  }
  checkCode(result, 'status', 200, '虎牙');
  const data = object(result.data, '虎牙响应结构已变化（缺少房间数据）');
  const live = object(data.liveData, '虎牙响应结构已变化（缺少直播数据）');
  const profile = object(data.profileInfo, '虎牙响应结构已变化（缺少主播数据）');
  if (!['ON', 'OFF'].includes(live.liveStatus)) throw new Error('虎牙返回未知开播状态');
  const id = canonicalNumericId(live.profileRoom);
  return {
    ...subscription, roomId: id, url: `https://www.huya.com/${id}`,
    title: text(live.introduction, subscription.title || '直播间'), nick: text(profile.nick, subscription.nick || `虎牙 ${id}`),
    cover: safeImage(live.screenshot), category: text(live.gameFullName),
    viewers: numeric(live.totalCount, '虎牙响应结构已变化（缺少人气）'),
    live: live.liveStatus === 'ON', startedAt: live.liveStatus === 'ON' ? epoch(live.beginLiveTime) : null,
    checkedAt: Date.now(),
  };
}

function bootstrapObject(html, name) {
  const candidates = [];
  const marker = new RegExp(`(?:^|[;\\r\\n])\\s*(?:var|let|const)\\s+${name}\\s*=\\s*`, 'g');
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    for (const match of script[1].matchAll(marker)) {
      const source = script[1];
      const start = match.index + match[0].length;
      if (source[start] !== '{') throw new Error('虎牙页面房间数据不是严格 JSON');
      let depth = 0, quoted = false, escaped = false, end = -1;
      for (let i = start; i < source.length; i++) {
        const char = source[i];
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === '{') depth++;
        else if (char === '}' && --depth === 0) {end = i + 1; break;}
      }
      if (end === -1 || !/^\s*;/.test(source.slice(end))) throw new Error('虎牙页面房间 JSON 不完整');
      try { candidates.push(object(JSON.parse(source.slice(start, end)), '虎牙页面房间数据无效')); }
      catch { throw new Error('虎牙页面房间数据不是严格 JSON'); }
    }
  }
  if (candidates.length !== 1) throw new Error('虎牙页面未返回唯一房间数据，可能需要平台验证');
  return candidates[0];
}

async function huyaPage(subscription, {fetchImpl, signal}) {
  let response;
  try {
    response = await fetchImpl(`https://www.huya.com/${encodeURIComponent(subscription.roomId)}`, {
      method: 'GET', credentials: 'omit', cache: 'no-store', signal: signal ?? AbortSignal.timeout(12000),
    });
  } catch (error) {
    if (signal?.aborted || ['AbortError', 'TimeoutError'].includes(error?.name)) throw new Error('虎牙房间请求超时或已取消');
    throw new Error('无法连接虎牙房间页面');
  }
  if (!response.ok) throw new Error(`虎牙房间请求失败（HTTP ${response.status}）`);
  const html = await response.text();
  if (html.length > 5000000) throw new Error('虎牙页面过大，无法确认房间数据');
  const live = bootstrapObject(html, 'TT_ROOM_DATA');
  const profile = bootstrapObject(html, 'TT_PROFILE_INFO');
  if (!['ON', 'OFF', 'REPLAY'].includes(live.state)) throw new Error('虎牙页面返回未知开播状态');
  if (typeof live.isOn !== 'boolean' || live.isOn !== (live.state === 'ON')) throw new Error('虎牙页面开播状态不一致');
  const id = canonicalNumericId(live.profileRoom);
  if (canonicalNumericId(profile.profileRoom) !== id) throw new Error('虎牙页面房间编号不一致');
  return {
    ...subscription, roomId: id, url: `https://www.huya.com/${id}`,
    title: text(live.introduction, subscription.title || '直播间'), nick: text(profile.nick, subscription.nick || `虎牙 ${id}`),
    cover: safeImage(live.screenshot), category: text(live.gameFullName),
    viewers: numeric(live.totalCount, '虎牙页面响应结构已变化（缺少人气）'),
    live: live.state === 'ON', startedAt: live.state === 'ON' ? epoch(live.startTime) : null, checkedAt: Date.now(),
  };
}

async function douyu(subscription, options) {
  const url = `https://open.douyucdn.cn/api/RoomApi/room/${encodeURIComponent(subscription.roomId)}`;
  const result = await jsonRequest(url, options);
  checkCode(result, 'error', 0, '斗鱼');
  const data = object(result.data, '斗鱼响应结构已变化（缺少房间数据）');
  const status = numeric(data.room_status, '斗鱼响应结构已变化（缺少开播状态）');
  if (![1, 2].includes(status)) throw new Error('斗鱼返回未知开播状态');
  const id = canonicalNumericId(data.room_id);
  return {
    ...subscription, roomId: id, url: `https://www.douyu.com/${id}`,
    title: text(data.room_name, subscription.title || '直播间'), nick: text(data.owner_name, text(data.nickname, subscription.nick || `斗鱼 ${id}`)),
    cover: safeImage(data.room_thumb || data.room_src), category: text(data.cate_name),
    viewers: numeric(data.online, '斗鱼响应结构已变化（缺少人气）'),
    live: status === 1, startedAt: status === 1 ? epoch(data.start_time) : null, checkedAt: Date.now(),
  };
}

export async function fetchRoom(subscription, {fetchImpl = fetch, signal} = {}) {
  object(subscription, '订阅数据无效');
  const platform = subscription.platform;
  const adapters = {bilibili, huya, douyu};
  if (!Object.hasOwn(adapters, platform)) throw new Error('暂不支持该直播平台');
  return adapters[platform]({...subscription, roomId: roomId(subscription.roomId)}, {fetchImpl, signal});
}

export async function fetchBilibiliFollowing({fetchImpl = fetch, signal} = {}) {
  const rooms = new Map();
  let expectedCount = null;
  for (let page = 1; page <= MAX_FOLLOW_PAGES; page++) {
    const url = new URL('https://api.live.bilibili.com/xlive/web-ucenter/v1/xfetter/GetWebList');
    url.search = new URLSearchParams({page: String(page), page_size: String(FOLLOW_PAGE_SIZE)});
    const result = await jsonRequest(url.href, {fetchImpl, signal}, 'include');
    checkCode(result, 'code', 0, 'B站关注');
    const data = object(result.data, 'B站关注响应结构已变化');
    if (!Array.isArray(data.rooms)) throw new Error('B站关注响应结构已变化（缺少 rooms）');
    if ('count' in data) {
      const count = numeric(data.count, 'B站关注总数无效');
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('B站关注总数无效');
      expectedCount = count;
    }
    let added = 0;
    for (const item of data.rooms) {
      object(item, 'B站关注房间数据无效');
      const id = canonicalNumericId(item.roomid);
      if (!rooms.has(id)) added++;
      rooms.set(id, {platform: 'bilibili', roomId: id, url: `https://live.bilibili.com/${id}`, nick: text(item.uname, `B站 ${id}`)});
    }
    if (expectedCount !== null && rooms.size >= expectedCount) return [...rooms.values()];
    if (!data.rooms.length) {
      if (expectedCount !== null && rooms.size < expectedCount) {
        throw new Error('关注列表分页提前结束，未导入不完整列表，请稍后重试');
      }
      return [...rooms.values()];
    }
    if (page > 1 && added === 0) throw new Error('关注列表分页没有新增房间，未导入不完整列表');
    // Without a total, require an empty terminal page; the server may cap page_size.
  }
  throw new Error(`关注列表超过 ${MAX_FOLLOW_PAGES} 页，未导入不完整列表；请分批手动添加`);
}
