#!/usr/bin/env node
/**
 * @file ext-session.mjs
 * Open the extension options/popup pages and the loopback fixture page as DEFAULT-context
 * targets of the owned browser, then read the extension's own identity from its own contexts.
 *
 * Usage: node ext-session.mjs PORT EXT_ID FIXTURE_URL OUTJSON
 *
 * Read-only with respect to the browser: it creates background targets in the default browser
 * context only (never an incognito or other context), never calls Page.bringToFront, and never
 * moves, resizes, minimizes, fullscreens or raises a window.
 */
import fs from 'node:fs/promises';
import {connect, sanitizeText} from './cdp.mjs';

const [portArg, extId, fixtureUrl, outArg] = process.argv.slice(2);
if (!portArg || !extId || !fixtureUrl || !outArg) {
  process.stderr.write('Usage: node ext-session.mjs PORT EXT_ID FIXTURE_URL OUTJSON\n');
  process.exit(2);
}

const cdp = await connect(Number(portArg));
const record = {
  sideEvidenceOnly: true,
  label:
    'Side evidence only. No continuous focus guard interval exists on this host because browser-focus-guard.mjs asserts process.platform===darwin, so nothing in this file supports a pass.',
  at: new Date().toISOString(),
  cdpPort: Number(portArg),
  extensionId: extId,
  createdTargets: [],
  identity: {source: null, manifest: null, runtimeId: null, contexts: null, errors: []},
  targetInventory: [],
};

const evalIn = async (targetId, expression, timeoutMs = 8000) => {
  const {sessionId} = await cdp.send('Target.attachToTarget', {targetId, flatten: true});
  try {
    const result = await cdp.send(
      'Runtime.evaluate',
      {expression, returnByValue: true, awaitPromise: true},
      sessionId,
      timeoutMs,
    );
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'evaluation threw');
    }
    return result.result?.value ?? null;
  } finally {
    try { await cdp.send('Target.detachFromTarget', {sessionId}); } catch { /* ignore */ }
  }
};

try {
  // 1. Create the pages we need, in the default context only.
  const wanted = [
    ['fixture-page', fixtureUrl],
    ['options-page', `chrome-extension://${extId}/options.html`],
    ['popup-page', `chrome-extension://${extId}/popup.html`],
  ];
  for (const [label, url] of wanted) {
    try {
      const created = await cdp.send('Target.createTarget', {url, background: true}, undefined, 15000);
      record.createdTargets.push({label, url, targetId: created.targetId});
    } catch (error) {
      record.createdTargets.push({label, url, targetId: null, error: sanitizeText(String(error?.message ?? error))});
    }
  }
  await new Promise((r) => setTimeout(r, 1500));

  // 2. Read the extension's own identity from its own contexts.
  const {targetInfos} = await cdp.send('Target.getTargets');
  record.targetInventory = targetInfos.map((t) => ({
    type: t.type,
    url: sanitizeText(String(t.url ?? '')),
    targetId: t.targetId,
    attached: Boolean(t.attached),
  }));

  const worker = targetInfos.find(
    (t) => (t.type === 'service_worker' || t.type === 'worker') && String(t.url).startsWith(`chrome-extension://${extId}/`),
  );
  const optionsTarget = targetInfos.find((t) => String(t.url).startsWith(`chrome-extension://${extId}/options`));
  const context = worker ?? optionsTarget;
  if (context) {
    record.identity.source = worker ? `extension service_worker target (${context.type})` : 'extension options page target';
    try {
      const manifest = await evalIn(context.targetId, 'JSON.stringify(chrome.runtime.getManifest())');
      record.identity.manifest = manifest ? JSON.parse(manifest) : null;
      record.identity.runtimeId = await evalIn(context.targetId, 'chrome.runtime.id');
      record.identity.contexts = await evalIn(
        context.targetId,
        '(typeof chrome.runtime.getContexts === "function") ? JSON.stringify(chrome.runtime.getContexts({}).then(cs => cs.map(c => ({contextType: c.contextType, documentUrl: c.documentUrl, incognito: c.incognito})))) : "getContexts unavailable"',
      );
    } catch (error) {
      record.identity.errors.push({source: record.identity.source, error: sanitizeText(String(error?.message ?? error))});
    }
  } else {
    record.identity.errors.push({source: null, error: 'no extension context target found'});
  }
} finally {
  cdp.close();
}

await fs.writeFile(outArg, sanitizeText(JSON.stringify(record, null, 2)) + '\n');
process.stdout.write(
  JSON.stringify({
    ok: true,
    created: record.createdTargets.map((t) => ({label: t.label, targetId: t.targetId, error: t.error ?? null})),
    identitySource: record.identity.source,
    manifestName: record.identity.manifest?.name ?? null,
    manifestVersion: record.identity.manifest?.version ?? null,
    runtimeId: record.identity.runtimeId,
  }) + '\n',
);
