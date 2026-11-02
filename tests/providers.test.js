import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchRoom, fetchBilibiliFollowing, safeImage} from '../extension/lib/providers.js';

const reply = data => async () => ({ok: true, status: 200, json: async () => structuredClone(data)});
const bili = {code: 0, data: {room_id: 100, live_status: 1, title: '测试直播', online: 12, live_time: '2024-01-01 12:00:00', user_cover: '//i0.hdslb.com/test.jpg', area_name: '游戏'}};
const huya = {status: 200, data: {profileInfo: {nick: '主播'}, liveData: {profileRoom: 200, liveStatus: 'ON', introduction: '标题', screenshot: 'https://huyaimg.example/a.jpg', totalCount: '123', gameFullName: '游戏', beginLiveTime: 1700000000}}};
const douyu = {error: 0, data: {room_id: 300, room_status: '1', room_name: '标题', nickname: '主播', online: 100, room_src: 'https://douyuimg.example/a.jpg', start_time: 1700000000, cate_name: '游戏'}};

test('B站回包状态规范化、房间短号与中国标准时间', async () => {
  let request;
  const result = await fetchRoom({platform: 'bilibili', roomId: '6', nick: '我的主播'}, {fetchImpl: async (url, options) => {
    request = {url, options}; return {ok: true, json: async () => bili};
  }});
  assert.equal(result.roomId, '100');
  assert.equal(result.url, 'https://live.bilibili.com/100');
  assert.equal(result.nick, '我的主播');
  assert.equal(result.live, true);
  assert.equal(result.startedAt, Date.parse('2024-01-01T04:00:00Z'));
  assert.equal(result.cover, 'https://i0.hdslb.com/test.jpg');
  assert.equal(request.options.credentials, 'omit');
});

test('B站离线和轮播均不作开播处理', async () => {
  for (const status of [0, 2]) {
    const result = await fetchRoom({platform: 'bilibili', roomId: '100'}, {fetchImpl: reply({...bili, data: {...bili.data, live_status: status}})});
    assert.equal(result.live, false); assert.equal(result.startedAt, null);
  }
});

test('虎牙别名被平台数字房号规范化，保留来源信息', async () => {
  let request;
  const result = await fetchRoom({platform: 'huya', roomId: 'tester', custom: true}, {fetchImpl: async url => {request = url; return {ok: true, json: async () => huya};}});
  assert.equal(result.roomId, '200'); assert.equal(result.live, true); assert.equal(result.custom, true);
  assert.equal(result.startedAt, 1700000000000); assert.match(request, /roomid=tester/);
  const offline = await fetchRoom({platform: 'huya', roomId: '200'}, {fetchImpl: reply({...huya, data: {...huya.data, liveData: {...huya.data.liveData, liveStatus: 'OFF'}}})});
  assert.equal(offline.live, false);
});

test('斗鱼状态、别名以及安全规范URL', async () => {
  const result = await fetchRoom({platform: 'douyu', roomId: 'alias', url: 'javascript:alert(1)'}, {fetchImpl: reply(douyu)});
  assert.equal(result.roomId, '300'); assert.equal(result.live, true); assert.equal(result.url, 'https://www.douyu.com/300');
  const offline = await fetchRoom({platform: 'douyu', roomId: '300'}, {fetchImpl: reply({...douyu, data: {...douyu.data, room_status: '2'}})});
  assert.equal(offline.live, false); assert.equal(offline.startedAt, null);
});

test('斗鱼字段 owner_name 与 room_thumb 的兼容解析', async () => {
  const captured = {error: 0, data: {room_id: '300', room_thumb: 'https://images.example.test/cover.avif', cate_id: '3', cate_name: '测试分类', room_name: '示例标题', room_status: '1', start_time: '2024-01-01 12:00:00', owner_name: '示例主播', online: 100}};
  const result = await fetchRoom({platform: 'douyu', roomId: '300'}, {fetchImpl: reply(captured)});
  assert.equal(result.nick, '示例主播');
  assert.equal(result.cover, captured.data.room_thumb);
  assert.equal(result.startedAt, Date.parse('2024-01-01T04:00:00Z'));
  assert.equal(result.live, true);
});

test('B站短号映射规范房号且保持回包语义', async () => {
  const captured = {code: 0, data: {room_id: 100, short_id: 6, live_status: 1, online: 120, title: '示例标题', user_cover: 'https://images.example.test/cover.jpg', area_name: '测试分类', live_time: '2024-01-01 12:00:00'}};
  const result = await fetchRoom({platform: 'bilibili', roomId: '6'}, {fetchImpl: reply(captured)});
  assert.equal(result.roomId, '100'); assert.equal(result.live, true); assert.equal(result.viewers, 120);
  assert.equal(result.startedAt, Date.parse('2024-01-01T04:00:00Z'));
});

const capturedHuyaRoom = {type: 'MATCH', state: 'ON', isOn: true, isOff: false, isReplay: false, id: 123, startTime: 1700000000, totalCount: 120, screenshot: 'https://images.example.test/cover.jpg', gameFullName: '测试分类', profileRoom: 660000, introduction: '示例标题'};
const capturedHuyaProfile = {nick: '示例主播', profileRoom: 660000};
function huyaPageReply(html) {
  return async url => url.includes('cache.php')
    ? {ok: true, json: async () => {throw new SyntaxError('HTML page');}}
    : {ok: true, text: async () => html};
}
const huyaHtml = (room = capturedHuyaRoom, profile = capturedHuyaProfile) => `<html><script>\nvar TT_ROOM_DATA = ${JSON.stringify(room)};\nvar TT_PROFILE_INFO = ${JSON.stringify(profile)};\n</script></html>`;

test('虎牙页面 bootstrap JSON 回退，不执行页面脚本', async () => {
  const result = await fetchRoom({platform: 'huya', roomId: '660000'}, {fetchImpl: huyaPageReply(huyaHtml())});
  assert.equal(result.nick, '示例主播'); assert.equal(result.roomId, '660000'); assert.equal(result.live, true);
  assert.equal(result.viewers, 120); assert.equal(result.startedAt, 1700000000000);
  const offline = await fetchRoom({platform: 'huya', roomId: '660000'}, {fetchImpl: huyaPageReply(huyaHtml({...capturedHuyaRoom, state: 'OFF', isOn: false, isOff: true}))});
  assert.equal(offline.live, false); assert.equal(offline.startedAt, null);
});

test('虎牙页面验证页、重复声明、函数表达式和房间数据冲突都明确失败', async () => {
  const cases = [
    '<html><title>验证</title></html>',
    huyaHtml() + huyaHtml(),
    '<script>var TT_ROOM_DATA = (() => { throw new Error("must not execute"); })();</script>',
    huyaHtml({...capturedHuyaRoom, state: 'ON', isOn: false}),
    huyaHtml(capturedHuyaRoom, {...capturedHuyaProfile, profileRoom: 1}),
    '<script>var TT_ROOM_DATA = {"state":"ON"} || {};\nvar TT_PROFILE_INFO = {};</script>',
  ];
  for (const html of cases) await assert.rejects(fetchRoom({platform: 'huya', roomId: '660000'}, {fetchImpl: huyaPageReply(html)}));
});

test('接口错误和缺失状态不能伪装成离线', async () => {
  for (const [platform, data] of [['bilibili', {code: -101}], ['huya', {status: 404}], ['douyu', {error: 1}], ['bilibili', {code: 0, data: {room_id: 10}}], ['huya', {status: 200, data: {profileInfo: {}, liveData: {liveStatus: 1}}}], ['douyu', {error: 0, data: {room_id: 10, room_status: 100}}]]) {
    await assert.rejects(fetchRoom({platform, roomId: '10'}, {fetchImpl: reply(data)}));
  }
  await assert.rejects(fetchRoom({platform: 'toString', roomId: '10'}, {fetchImpl: reply(bili)}), /暂不支持/);
  await assert.rejects(fetchRoom({platform: 'bilibili', roomId: '../10'}, {fetchImpl: reply(bili)}), /编号无效/);
});

test('HTTP错误、非JSON、网络失败、取消均报出错误', async () => {
  const sub = {platform: 'bilibili', roomId: '10'};
  await assert.rejects(fetchRoom(sub, {fetchImpl: async () => ({ok: false, status: 403})}), /HTTP 403/);
  await assert.rejects(fetchRoom(sub, {fetchImpl: async () => ({ok: true, json: async () => {throw new Error();}})}), /JSON/);
  await assert.rejects(fetchRoom(sub, {fetchImpl: async () => {throw new TypeError('fetch failed');}}), /无法连接/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fetchRoom(sub, {signal: controller.signal, fetchImpl: async () => {throw new DOMException('aborted', 'AbortError');}}), /超时或已取消/);
});

test('图片只接受HTTPS且拒绝带凭据URL', () => {
  assert.equal(safeImage('//a.example/a.png'), 'https://a.example/a.png');
  for (const unsafe of ['javascript:alert(1)', 'data:image/png;base64,x', 'http://a.example/a.png', 'https://x:y@a.example/a.png', '/test.png', null]) assert.equal(safeImage(unsafe), '');
});

test('关注导入带登录态并根据总数完成分页，不信任 page_size 回包数量', async () => {
  const seen = [];
  const result = await fetchBilibiliFollowing({fetchImpl: async (url, options) => {
    seen.push({url, options}); const page = Number(new URL(url).searchParams.get('page'));
    return {ok: true, json: async () => ({code: 0, data: {count: 2, rooms: [{roomid: page, uname: `主播${page}`} ]}})};
  }});
  assert.equal(result.length, 2); assert.equal(seen.length, 2);
  assert.equal(seen[0].options.credentials, 'include'); assert.equal(result[0].url, 'https://live.bilibili.com/1');
});

test('无总数时读到空页才结束，避免服务端静默限制page_size', async () => {
  let calls = 0;
  const result = await fetchBilibiliFollowing({fetchImpl: async () => ({ok: true, json: async () => ({code: 0, data: {rooms: ++calls === 1 ? [{roomid: 1, uname: '测试'}] : []}})})});
  assert.equal(result.length, 1); assert.equal(calls, 2);
});

test('关注拒绝登录、schema错误、分页停滞、提前结束不返回不完整结果', async () => {
  await assert.rejects(fetchBilibiliFollowing({fetchImpl: reply({code: -101, message: '未登录'})}), /拒绝请求/);
  await assert.rejects(fetchBilibiliFollowing({fetchImpl: reply({code: 0, data: {list: []}})}), /rooms/);
  await assert.rejects(fetchBilibiliFollowing({fetchImpl: reply({code: 0, data: {count: 2, rooms: [{roomid: 1}]}})}), /没有新增房间/);
  await assert.rejects(fetchBilibiliFollowing({fetchImpl: reply({code: 0, data: {count: 2, rooms: []}})}), /分页提前结束/);
});

test('关注分页达到上限时明确拒绝截断结果', async () => {
  let calls = 0;
  await assert.rejects(fetchBilibiliFollowing({fetchImpl: async () => ({ok: true, json: async () => ({code: 0, data: {rooms: [{roomid: ++calls}]}})})}), /超过 20 页/);
  assert.equal(calls, 20);
});
