#!/usr/bin/env node
/**
 * @file window-bounds.mjs
 * Read-only window placement read-back for the owned temporary browser.
 * Usage: node window-bounds.mjs PORT OUTJSON REQUESTED_POSITION
 * Uses only Target.getTargets, Browser.getWindowForTarget and Browser.getWindowBounds.
 * Never moves, resizes, minimizes, fullscreens, raises or focuses anything.
 */
import fs from 'node:fs/promises';
import {connect, sanitizeText} from './cdp.mjs';

const [portArg, outArg, requested = 'unspecified'] = process.argv.slice(2);
if (!portArg || !outArg) {
  process.stderr.write('Usage: node window-bounds.mjs PORT OUTJSON [REQUESTED]\n');
  process.exit(2);
}

const cdp = await connect(Number(portArg));
const record = {
  sideEvidenceOnly: true,
  label:
    'Side evidence only. No continuous focus guard interval exists on this host because browser-focus-guard.mjs asserts process.platform===darwin, so nothing in this file supports a pass.',
  requestedPosition: requested,
  readAt: new Date().toISOString(),
  cdpPort: Number(portArg),
  windows: [],
  errors: [],
};

try {
  const {targetInfos} = await cdp.send('Target.getTargets');
  const pages = targetInfos.filter((t) => t.type === 'page');
  record.pageTargetCount = pages.length;
  const seen = new Set();
  for (const target of pages) {
    try {
      const {windowId} = await cdp.send('Browser.getWindowForTarget', {targetId: target.targetId});
      if (seen.has(windowId)) continue;
      seen.add(windowId);
      const {bounds} = await cdp.send('Browser.getWindowBounds', {windowId});
      record.windows.push({windowId, targetId: target.targetId, url: target.url, ...bounds});
    } catch (error) {
      record.errors.push({targetId: target.targetId, error: sanitizeText(String(error?.message ?? error))});
    }
  }
} finally {
  cdp.close();
}

await fs.writeFile(outArg, sanitizeText(JSON.stringify(record, null, 2)) + '\n');
process.stdout.write(JSON.stringify({ok: true, windows: record.windows, errors: record.errors}) + '\n');
