import test from 'node:test';
import assert from 'node:assert/strict';
import { createController, ALARM_NAME } from '../extension/lib/controller.js';
function fakeApi() {
  const data = {}; const alarms = new Map(); const notifications = []; const windows = []; const tabs = [];
  return {data, alarmsMap:alarms, sent:notifications, openedWindows:windows, openedTabs:tabs,
    storage:{local:{get:async key=>({[key]:structuredClone(data[key])}),set:async values=>Object.assign(data,structuredClone(values))}},
    alarms:{get:async name=>alarms.get(name), create:async(name,info)=>alarms.set(name,info),clear:async name=>alarms.delete(name)},
    notifications:{create:async(id,options)=>notifications.push({id,...options})},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
    runtime:{getURL:path=>`chrome-extension://test/${path}`},
    windows:{create:async value=>{windows.push(value);return value;}},tabs:{create:async value=>{tabs.push(value);return value;}}
  };
}
const subscription = {url:'https://live.bilibili.com/6'};
test('cold worker restores alarm; settings disable/re-enable it and validate before writes', async () => {
  const api = fakeApi(); const controller = createController(api);
  await controller.initialize(); assert.equal(api.alarmsMap.get(ALARM_NAME).periodInMinutes,3);
  await controller.dispatch({action:'saveSettings',settings:{notifications:false}}); assert.equal(api.alarmsMap.size,0);
  await assert.rejects(()=>controller.dispatch({action:'saveSettings',settings:{interval:0}}));
  assert.equal(api.data.livebox.settings.notifications,false);
  await controller.dispatch({action:'saveSettings',settings:{notifications:true,interval:5}});
  assert.equal(api.alarmsMap.get(ALARM_NAME).periodInMinutes,5);
});
test('polling, restart persistence, errors and re-start transitions', async () => {
  const api = fakeApi(); let live = false; let failed = false;
  const dependencies = {fetchRoom:async sub=>{if(failed)throw new Error('blocked');return {...sub,title:'测试直播',live};}};
  let controller = createController(api,dependencies);
  await controller.dispatch({action:'addSubscriptions',subscriptions:[subscription]});
  await controller.refresh(); assert.equal(api.sent.length,0);
  // New controller represents a fresh service worker with no in-memory baseline.
  controller = createController(api,dependencies); live = true;
  await controller.refresh(); assert.equal(api.sent.length,1);
  await controller.refresh(); assert.equal(api.sent.length,1);
  failed = true; const state = await controller.refresh();
  assert.equal(state.rooms[0].lastGoodLive,true); assert.equal(state.rooms[0].error,'blocked');
  failed = false; live = false; await controller.refresh(); live = true; await controller.refresh();
  assert.equal(api.sent.length,2);
  await controller.dispatch({action:'removeSubscription',key:'bilibili:6'}); assert.equal(api.data.livebox.rooms.length,0);
});
test('overlapping refreshes coalesce and serialized remove cannot be undone by a late fetch', async () => {
  const api = fakeApi(); let release; let count = 0;
  const controller = createController(api,{fetchRoom:async sub=>{count++;await new Promise(resolve=>release=resolve);return {...sub,live:false};}});
  await controller.dispatch({action:'addSubscriptions',subscriptions:[subscription]});
  const a=controller.refresh(),b=controller.refresh();
  await new Promise(resolve=>setTimeout(resolve,0));
  const remove=controller.dispatch({action:'removeSubscription',key:'bilibili:6'});
  release(); await Promise.all([a,b,remove]);
  assert.equal(count,1); assert.equal(api.data.livebox.subscriptions.length,0); assert.equal(api.data.livebox.rooms.length,0);
});
test('import fails atomically and opening a small window uses validated platform URL/settings', async () => {
  const api = fakeApi(); const controller = createController(api,{fetchFollowing:async()=>[{url:'https://evil.invalid/1'}]});
  await assert.rejects(()=>controller.dispatch({action:'importFollowing'})); assert.equal(api.data.livebox,undefined);
  await controller.dispatch({action:'openRoom',room:subscription,small:true});
  assert.deepEqual(api.openedWindows[0],{url:'https://live.bilibili.com/6',type:'popup',width:960,height:640,focused:true});
  await assert.rejects(()=>controller.dispatch({action:'openRoom',room:{url:'javascript:alert(1)'},small:true}));
  await controller.dispatch({action:'openRoom',room:subscription}); assert.equal(api.openedTabs.length,1);
});
test('queued removal resolves a short key even after refresh persists a different canonical room id', async () => {
  const api=fakeApi();let release;
  const controller=createController(api,{fetchRoom:async sub=>{await new Promise(resolve=>release=resolve);return {...sub,roomId:'100',url:'https://live.bilibili.com/100',live:false};}});
  await controller.dispatch({action:'addSubscriptions',subscriptions:[subscription]});
  const refresh=controller.refresh();await new Promise(resolve=>setTimeout(resolve,0));
  const remove=controller.dispatch({action:'removeSubscription',key:'bilibili:6'});
  release();await Promise.all([refresh,remove]);
  assert.deepEqual(api.data.livebox.subscriptions,[]);assert.deepEqual(api.data.livebox.rooms,[]);assert.deepEqual(api.data.livebox.aliases,{});
});
test('notification failures are visible and do not roll back an observed transition', async () => {
  const api=fakeApi(); let live=false;
  api.notifications.create=async()=>{throw new Error('OS notifications disabled');};
  const controller=createController(api,{fetchRoom:async sub=>({...sub,live})});
  await controller.dispatch({action:'addSubscriptions',subscriptions:[subscription]});
  await controller.refresh();live=true;
  const state=await controller.refresh();assert.match(state.notificationError,/disabled/);assert.equal(state.rooms[0].lastGoodLive,true);
});
