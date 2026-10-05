/**
 * @file cdp.mjs
 * Minimal dependency-free Chrome DevTools Protocol client for the Linux-native BrowserOS Neo
 * acceptance harness. Talks only to the loopback discovery endpoint of the owned browser.
 *
 * Exports:
 *   connect(port, options?) -> {version, send(method, params?, sessionId?, timeoutMs?),
 *                               event(listener), close()}
 *   sanitizeText(value)     -> string with the workspace path then the home path replaced
 *                              by <WORKSPACE> / <HOME> (runtime redaction, no baked paths)
 *
 * Per-call timeouts: every send() call carries its own timer (default 15000 ms, pass the fourth
 * argument or options.timeoutMs to override). A timeout rejects that call; other pending calls
 * and the connection itself are unaffected. close() rejects everything still pending.
 */
import os from 'node:os';

export const DEFAULT_CALL_TIMEOUT_MS = 15000;
export const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

/**
 * Redact machine-specific path prefixes from text that will be written to evidence files.
 * Uses only runtime information (process.env.FLUENTREAD_WORKSPACE and os.homedir()); the
 * replacement order is workspace first, then home, so nested paths collapse correctly.
 */
export function sanitizeText(value) {
  if (typeof value !== 'string') return value;
  let output = value;
  const workspace = process.env.FLUENTREAD_WORKSPACE;
  if (workspace) output = output.split(workspace).join('<WORKSPACE>');
  const home = os.homedir();
  if (home) output = output.split(home).join('<HOME>');
  return output;
}

/**
 * Open a CDP websocket to ws://127.0.0.1:<port> after verifying through the loopback HTTP
 * discovery endpoint that the browser reports exactly that websocket destination.
 */
export async function connect(port, options = {}) {
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    throw new Error(`invalid CDP port: ${String(port)}`);
  }
  const connectTimeoutMs = Number(options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
  const defaultTimeoutMs = Number(options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`http://127.0.0.1:${numericPort}/json/version`, {
      signal: AbortSignal.timeout(connectTimeoutMs),
    });
  } catch (error) {
    throw new Error(`CDP discovery failed on 127.0.0.1:${numericPort}: ${error?.message ?? error}`);
  }
  if (!response.ok) {
    throw new Error(`CDP discovery returned HTTP ${response.status} on 127.0.0.1:${numericPort}`);
  }
  const version = await response.json();
  const wsUrl = new URL(String(version?.webSocketDebuggerUrl ?? ''));
  if (wsUrl.protocol !== 'ws:' || wsUrl.hostname !== '127.0.0.1' || Number(wsUrl.port) !== numericPort) {
    throw new Error(`refusing unverified CDP websocket destination: ${wsUrl.href}`);
  }

  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = new Set();
  let nextId = 0;
  let closed = false;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { socket.close(); } catch { /* ignore */ }
      reject(new Error(`CDP websocket connect timed out after ${connectTimeoutMs}ms`));
    }, connectTimeoutMs);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once: true});
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('CDP websocket connection failed'));
    }, {once: true});
  });

  const rejectAll = reason => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(reason);
    }
    pending.clear();
  };

  socket.addEventListener('message', event => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message && message.id !== undefined && message.id !== null) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) {
        entry.reject(new Error(
          `CDP error for ${entry.method}: ${message.error.message ?? JSON.stringify(message.error)}`,
        ));
      } else {
        entry.resolve(message.result);
      }
      return;
    }
    for (const listener of listeners) {
      try {
        listener(message);
      } catch {
        // A broken listener must not tear down the CDP client.
      }
    }
  });
  socket.addEventListener('close', () => {
    closed = true;
    rejectAll(new Error('CDP connection closed'));
  });

  const send = (method, params = {}, sessionId, timeoutMs = defaultTimeoutMs) => new Promise((resolve, reject) => {
    if (closed) {
      reject(new Error('CDP connection is closed'));
      return;
    }
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP call timed out after ${timeoutMs}ms: ${method}`));
    }, timeoutMs);
    pending.set(id, {resolve, reject, timer, method});
    try {
      socket.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });

  /** Register a listener for unsolicited CDP events; returns an unsubscribe function. */
  const event = listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const close = () => {
    if (closed) return;
    closed = true;
    rejectAll(new Error('CDP connection closed by caller'));
    try { socket.close(); } catch { /* ignore */ }
  };

  return {version, send, event, close};
}
