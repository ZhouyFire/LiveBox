// Usage: node scripts/browser-smoke.mjs <existing-playwright-core-directory> [edge-executable]
// Uses a new isolated profile, real MV3 extension APIs and deterministic platform response fixtures.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
if (!process.argv[2]) throw new Error('Supply an existing playwright-core directory; this script installs nothing.');
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2], 'index.mjs')).href);
const root = path.resolve('.');
const output = path.join(root, '.runtime', 'artifacts');
await fs.mkdir(output, {recursive:true});
const runtime = path.join(root, '.runtime', `smoke-${Date.now()}`);
await fs.mkdir(runtime, {recursive:true});
const extension = path.join(root,'extension');
const executablePath = process.argv[3] || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const context = await chromium.launchPersistentContext(runtime, {
  executablePath, headless:true, chromiumSandbox:true, viewport:null,
  ignoreDefaultArgs:['--disable-extensions'],
  args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--no-first-run','--disable-background-networking'],
});
const errors=[];
context.on('page', page=>page.on('pageerror',error=>errors.push(error.message)));
const checks=[];
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:15000});
  const id = new URL(worker.url()).hostname;
  checks.push('Actual MV3 service worker loaded in isolated Microsoft Edge profile');
  await worker.evaluate(() => {
    globalThis.__liveboxNativeFetch = globalThis.fetch;
    globalThis.fetch = async url => {
      const value = String(url);
      if (value.includes('api.live.bilibili.com/room/v1/Room/get_info')) return new Response(JSON.stringify({code:0,data:{room_id:6,title:'深夜音乐电台 · 把日子放慢一点',uname:'安静电台',live_status:1,online:12800,area_name:'音乐电台',live_time:'2024-01-01 12:00:00'}}),{status:200,headers:{'Content-Type':'application/json'}});
      if (value.includes('www.huya.com/cache.php')) return new Response(JSON.stringify({status:200,data:{profileInfo:{nick:'山野观察员'},liveData:{profileRoom:660000,liveStatus:'OFF',introduction:'下次见面，再聊山海',gameFullName:'户外',totalCount:0}}}),{status:200,headers:{'Content-Type':'application/json'}});
      if (value.includes('open.douyucdn.cn')) throw new Error('Deterministic network failure');
      throw new Error(`Unexpected test network request: ${value}`);
    };
  });
  const page=await context.newPage();
  await page.setViewportSize({width:1100,height:1000});
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.locator('#room-url').waitFor();
  for (const [url,nick] of [['https://live.bilibili.com/6','安静电台'],['https://www.huya.com/660000','山野观察员'],['https://www.douyu.com/9999','<img src=x onerror=alert(1)>']]) {
    await page.locator('#room-url').fill(url); await page.locator('#room-nick').fill(nick);
    await page.locator('#add-form button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('#room-url').value==='');
  }
  assert.equal(await page.locator('.subscription-row').count(),3);
  await page.locator('#room-url').fill('https://evil.invalid/1');
  await page.locator('#add-form button[type=submit]').click();
  await page.locator('#message.error').waitFor();
  assert.equal(await page.locator('.subscription-row').count(),3);
  checks.push('Add three subscriptions through real UI; unsupported host rejected without mutation');
  await page.locator('#notifications').uncheck();
  await page.locator('#interval').fill('5'); await page.locator('#width').fill('800');await page.locator('#height').fill('500');
  await page.locator('#settings-form button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#message').textContent==='设置已保存');
  const alarm=await worker.evaluate(()=>chrome.alarms.get('livebox-refresh'));
  assert.equal(alarm,undefined);
  checks.push('Saving preferences updates real storage; disabling notifications clears real alarm');
  await page.locator('#refresh').click();
  await page.waitForFunction(()=>document.querySelector('#message').textContent.startsWith('检查完成'));
  await page.screenshot({path:path.join(output,'options-smoke.png'),fullPage:true});
  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.waitForFunction(()=>document.querySelectorAll('.room-card').length===3 && !document.querySelector('#refresh').disabled);
  assert.equal(await page.locator('#live-count').textContent(),'1');
  assert.equal(await page.locator('.room-info img').count(),0);
  assert.match(await page.locator('.room-error').textContent(),/无法连接/);
  await page.locator('#live-only').check();assert.equal(await page.locator('.room-card').count(),1);
  await page.locator('#platform').selectOption('huya');assert.equal(await page.locator('.room-card').count(),0);
  await page.locator('#platform').selectOption('');await page.locator('#live-only').uncheck();
  await page.locator('#search').fill('安静');assert.equal(await page.locator('.room-card').count(),1);await page.locator('#search').clear();
  checks.push('Fixture live/offline/error states render separately; filters/search work; HTML nickname stays text');
  await page.evaluate(()=>{document.querySelector('.brand p').textContent='浏览器验收 · 固定回包样本，非实时直播';});
  await page.setViewportSize({width:600,height:620});
  await page.screenshot({path:path.join(output,'popup-smoke.png'),fullPage:true});
  await context.route('https://live.bilibili.com/6',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Isolated room fixture</title><p>Browser window smoke test fixture</p>'}));
  const newPage=context.waitForEvent('page');
  await page.locator('.room-card').first().getByRole('button',{name:'▣ 小窗观看'}).click();
  const small=await newPage;await small.waitForLoadState();
  assert.equal(small.url(),'https://live.bilibili.com/6');
  const windows=await worker.evaluate(()=>chrome.windows.getAll());
  const popup=windows.find(window=>window.type==='popup');assert.ok(popup);assert.equal(popup.width,800);assert.equal(popup.height,500);
  checks.push('Actual chrome.windows.create opens a popup at saved 800×500 size with validated room URL (navigation intercepted by local fixture)');
  await small.close();
  await context.route('https://www.huya.com/',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Room list fixture</title><a href="https://live.bilibili.com/6" style="display:block;width:250px;height:100px">Hover room card fixture</a>'}));
  const listing=await context.newPage();await listing.goto('https://www.huya.com/');
  await listing.locator('a').hover();await listing.locator('#livebox-mini-launcher').waitFor({state:'visible'});
  const fromContent=context.waitForEvent('page');
  await listing.locator('#livebox-mini-launcher').click();
  const contentWindow=await fromContent;await contentWindow.waitForLoadState();assert.equal(contentWindow.url(),'https://live.bilibili.com/6');
  await contentWindow.close();await listing.close();
  checks.push('Real content script on intercepted platform page opens the hovered room via its Shadow DOM button');
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.locator('.subscription-row').first().getByRole('button',{name:'移除'}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.subscription-row').length===2);
  checks.push('Remove subscription through settings UI persists without stale refresh resurrection');
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'browser-smoke.json'),JSON.stringify({at:new Date().toISOString(),browser:context.browser()?.version(),extensionId:id,passed:true,checks,pageErrors:errors,limits:['Deterministic fixture platform responses, not live platform account integration','Notifications disabled during smoke; notification transitions covered by unit/integration tests']},null,2));
  if (process.env.LIVEBOX_LIVE_PROBE === '1') {
    await worker.evaluate(async () => {
      globalThis.fetch=globalThis.__liveboxNativeFetch;
      const {livebox}=await chrome.storage.local.get('livebox');
      await chrome.storage.local.set({livebox:{...livebox,rooms:[],subscriptions:[
        {platform:'bilibili',roomId:'6',url:'https://live.bilibili.com/6'},
        {platform:'huya',roomId:'660000',url:'https://www.huya.com/660000'},
        {platform:'douyu',roomId:'9999',url:'https://www.douyu.com/9999'}
      ]}});
    });
    const live=await page.evaluate(async () => {
      const result=await chrome.runtime.sendMessage({action:'refresh'});
      if(!result.ok)throw new Error(result.error);
      return {at:new Date().toISOString(),probes:result.data.rooms.map(room=>({platform:room.platform,ok:!room.error,roomId:room.roomId,title:room.title,nick:room.nick,live:room.live,error:room.error}))};
    });
    await fs.writeFile(path.join(output,'browser-live-probe.json'),JSON.stringify({...live,scope:'Extension service worker, public room status, anonymous requests; no account import'},null,2));
    console.log(JSON.stringify({liveProbe:live},null,2));
  }
  console.log(JSON.stringify({passed:true,checks},null,2));
} finally {
  await context.close();
  const allowed = path.resolve(root,'.runtime') + path.sep;
  if (!path.resolve(runtime).startsWith(allowed)) throw new Error('Refusing profile cleanup outside task runtime directory');
  await fs.rm(runtime,{recursive:true,force:true,maxRetries:3,retryDelay:200}).catch(error=>console.warn(`Isolated profile retained: ${error.message}`));
}
