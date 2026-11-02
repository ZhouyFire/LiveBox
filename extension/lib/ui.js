export const $ = selector => document.querySelector(selector);
export async function rpc(action, data = {}) {
  const response = await chrome.runtime.sendMessage({ action, ...data });
  if (!response?.ok) throw new Error(response?.error || '后台未响应，请重新加载扩展');
  return response.data;
}
export function status(message, isError = false) {
  const element = $('#message');
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle('error', isError);
}
export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function safeImage(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
export async function busy(button, work) {
  button.disabled = true;
  try { return await work(); } catch (error) { status(error.message, true); }
  finally { button.disabled = false; }
}
