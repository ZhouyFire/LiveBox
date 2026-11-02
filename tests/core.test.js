import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSubscription, mergeSubscriptions, validateSettings, reconcile, mapLimit, roomKey } from '../extension/lib/core.js';
const sub = normalizeSubscription({ url: 'https://live.bilibili.com/6?tracking=yes' });
test('canonical room URLs strip tracking, upgrade HTTP and reject arbitrary hosts and executable schemes', () => {
  assert.equal(sub.url, 'https://live.bilibili.com/6');
  assert.equal(normalizeSubscription({url:'http://huya.com/test123'}).url, 'https://www.huya.com/test123');
  for (const url of ['javascript:alert(1)', 'https://www.huya.com.evil.test/1', 'https://a@www.huya.com/1', 'https://www.huya.com:8888/1', 'https://www.douyu.com/directory/all', 'https://live.bilibili.com/title', 'https://live.bilibili.com/0','https://live.bilibili.com/12345678912345678']) assert.throws(() => normalizeSubscription({url}));
});
test('imports are atomic, deduplicate and enforce total room limit', () => {
  assert.equal(mergeSubscriptions([sub], [sub]).length, 1);
  const original = [sub];
  assert.throws(() => mergeSubscriptions(original, [sub, {url:'file:///secret'}]));
  assert.deepEqual(original, [sub]);
  assert.throws(() => mergeSubscriptions([], Array.from({length:101}, (_,i)=>({...sub,roomId:String(i+1),url:undefined}))));
});
test('settings reject invalid intervals, size, and boolean types', () => {
  assert.equal(validateSettings().interval, 3);
  for (const settings of [{interval:NaN},{interval:0},{interval:1.5},{width:100},{notifications:'false'}]) assert.throws(()=>validateSettings(settings));
});
test('duplicate import preserves a user note, including an import with no nickname', () => {
  const saved = {...sub,nick:'周末想看'};
  assert.equal(mergeSubscriptions([saved],[sub])[0].nick,'周末想看');
  assert.equal(mergeSubscriptions([saved],[{...sub,nick:'平台昵称'}])[0].nick,'周末想看');
});
test('resolved short URLs merge into canonical room without duplicate starts', () => {
  const canonical=normalizeSubscription({url:'https://live.bilibili.com/100'});
  const result=reconcile([{...sub,lastGoodLive:false},{...canonical,lastGoodLive:false}], [{...sub,nick:'自定义备注'},canonical], [
    {ok:true,room:{...canonical,live:true,nick:'平台昵称'}},{ok:true,room:{...canonical,live:true,nick:'平台昵称'}}
  ]);
  assert.equal(result.rooms.length,1);assert.equal(result.subscriptions.length,1);assert.equal(result.notifications.length,1);
  assert.equal(result.rooms[0].roomId,'100');assert.equal(result.subscriptions[0].nick,'自定义备注');
  assert.equal(reconcile(result.rooms,result.subscriptions,[{ok:true,room:{...canonical,live:true}}]).notifications.length,0);
});
test('first live fetch is baseline; offline -> live -> offline -> live notifies each time', () => {
  let previous = [];
  for (const [live, expected] of [[true,0],[false,0],[true,1],[true,0],[false,0],[true,1]]) {
    const result = reconcile(previous, [sub], [{ok:true,room:{...sub, live}}], 100);
    assert.equal(result.notifications.length, expected);
    previous = result.rooms;
  }
});
test('empty baseline, error preservation and subscription removal do not suppress future starts', () => {
  let previous = reconcile([], [sub], [{ok:true,room:{...sub,live:false}}]).rooms;
  previous = reconcile(previous, [sub], [{ok:false,error:'network'}]).rooms;
  assert.equal(previous[0].error, 'network');
  assert.equal(previous[0].lastGoodLive, false);
  assert.equal(reconcile(previous,[sub],[{ok:true,room:{...sub,live:true}}]).notifications.length,1);
  assert.deepEqual(reconcile(previous,[],[]).rooms,[]);
  assert.equal(reconcile([], [sub], [{ok:false,error:'blocked'}]).rooms[0].live, undefined);
});
test('limited concurrency preserves subscription order', async () => {
  let active = 0, maximum = 0;
  const output = await mapLimit([3,2,1,4], 2, async value => {
    active++; maximum = Math.max(active,maximum); await new Promise(resolve=>setTimeout(resolve,value)); active--; return value * 2;
  });
  assert.deepEqual(output,[6,4,2,8]); assert.equal(maximum,2); assert.equal(roomKey(sub),'bilibili:6');
});
