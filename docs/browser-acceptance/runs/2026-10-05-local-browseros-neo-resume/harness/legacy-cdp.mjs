/**
 * Minimal CDP client for the FluentRead BrowserOS Neo acceptance run.
 *
 * Why this exists: the handoff's three browser specials require a "trusted
 * focus-safe helper" (focus-safe-browser.cjs) plus a Playwright runtime. Neither
 * exists on this machine and the handoff forbids fabricating the helper, so those
 * scripts are unusable. This module drives the browser under test directly over
 * the Chrome DevTools Protocol, which needs no Playwright and no focus helper.
 *
 * It does NOT launch browsers, does not call Page.bringToFront(), and never
 * activates a window. Attach to an instance that was already started in the
 * background.
 */
import {createHash} from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function listTargets(cdpPort) {
  const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
  if (!response.ok) throw new Error(`CDP /json/list returned ${response.status}`);
  return response.json();
}

export async function browserVersion(cdpPort) {
  const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
  if (!response.ok) throw new Error(`CDP /json/version returned ${response.status}`);
  return response.json();
}

/** Open a flat CDP session against the browser-level websocket. */
export async function connect(cdpPort) {
  const {webSocketDebuggerUrl} = await browserVersion(cdpPort);
  const socket = new WebSocket(webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const events = [];
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, {once: true});
    socket.addEventListener('error', () => reject(new Error('CDP websocket error')), {once: true});
  });
  socket.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.id && pending.has(message.id)) {
      const {resolve, reject} = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message} (${JSON.stringify(message.error.data ?? '')})`));
      else resolve(message.result);
      return;
    }
    if (message.method) events.push(message);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, {resolve, reject});
    socket.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }
    }, 30000);
  });
  return {send, events, close: () => socket.close(), socket};
}

/** Attach to every target and return a sessionId -> targetInfo map. */
export async function attachAll(client) {
  await client.send('Target.setDiscoverTargets', {discover: true});
  const {targetInfos} = await client.send('Target.getTargets');
  const sessions = new Map();
  for (const info of targetInfos) {
    try {
      const {sessionId} = await client.send('Target.attachToTarget', {targetId: info.targetId, flatten: true});
      sessions.set(sessionId, info);
    } catch { /* some targets refuse attachment; they are not needed */ }
  }
  return sessions;
}

/** Evaluate an expression in a session and return its JSON value. */
export async function evaluate(client, sessionId, expression, awaitPromise = true) {
  const {result, exceptionDetails} = await client.send('Runtime.evaluate', {
    expression, awaitPromise, returnByValue: true,
  }, sessionId);
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
}

export async function screenshot(client, sessionId, filePath) {
  const {data} = await client.send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: false}, sessionId);
  const {writeFile} = await import('node:fs/promises');
  await writeFile(filePath, Buffer.from(data, 'base64'));
  return Buffer.from(data, 'base64');
}
