import { createController, ALARM_NAME } from './lib/controller.js';
const controller = createController(chrome);
const extensionPrefix = chrome.runtime.getURL('');
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Web-page content scripts may only open a supported room, not change settings/import subscriptions.
  const internal = sender.url?.startsWith(extensionPrefix);
  if (!internal && (sender.id !== chrome.runtime.id || message?.action !== 'openRoom')) {
    respond({ ok: false, error: '此页面无权执行该操作' }); return false;
  }
  controller.dispatch(message).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error.message || '操作失败' }));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) controller.refresh().catch(console.error);
});
chrome.runtime.onInstalled.addListener(() => controller.initialize().catch(console.error));
chrome.runtime.onStartup.addListener(() => controller.initialize().catch(console.error));
chrome.notifications.onClicked.addListener(async id => {
  if (!id.startsWith('livebox:')) return;
  const key = id.slice('livebox:'.length);
  const state = await controller.dispatch({ action: 'getState' });
  const room = state.subscriptions.find(room => `${room.platform}:${room.roomId}` === key);
  if (room) await controller.dispatch({ action: 'openRoom', room });
  await chrome.notifications.clear(id);
});
// Also recover a missing alarm on a service-worker cold start.
controller.initialize().catch(console.error);
