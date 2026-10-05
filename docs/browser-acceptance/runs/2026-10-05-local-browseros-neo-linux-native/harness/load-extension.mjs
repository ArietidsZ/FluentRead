#!/usr/bin/env node
/**
 * @file load-extension.mjs
 * Load an already-built unpacked MV3 extension into the owned, already-running browser over
 * CDP (Extensions.loadUnpacked). The path is passed through as an absolute path; this script
 * never rebuilds anything and never calls Page.bringToFront.
 *
 * Usage: node load-extension.mjs PORT ABS_EXT_DIR
 * Prints one JSON line: {"ok":boolean,"id":...,"name":...,"version":...,"error":...}
 * Exit code 0 only when the extension was loaded successfully.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {connect, sanitizeText} from './cdp.mjs';

const [portArg, extensionArg] = process.argv.slice(2);

const emit = payload => {
  process.stdout.write(`${sanitizeText(JSON.stringify(payload))}\n`);
};

const fail = (error, exitCode = 1) => {
  emit({ok: false, id: null, name: null, version: null, error: sanitizeText(String(error?.message ?? error))});
  process.exitCode = exitCode;
};

const main = async () => {
  if (!portArg || !extensionArg) {
    fail('Usage: node load-extension.mjs PORT ABS_EXT_DIR', 2);
    return;
  }
  if (!path.isAbsolute(extensionArg)) {
    fail(`extension directory must be an absolute path, got: ${extensionArg}`, 2);
    return;
  }
  let extensionDir;
  try {
    extensionDir = await fs.realpath(extensionArg);
    const stat = await fs.stat(extensionDir);
    if (!stat.isDirectory()) throw new Error('not a directory');
  } catch (error) {
    fail(`cannot read extension directory ${extensionArg}: ${error.message}`);
    return;
  }

  let cdp;
  try {
    cdp = await connect(Number(portArg));
    const loaded = await cdp.send('Extensions.loadUnpacked', {path: extensionDir}, undefined, 30000);
    emit({
      ok: true,
      id: loaded?.id ?? null,
      name: loaded?.name ?? null,
      version: loaded?.version ?? null,
      error: null,
    });
  } catch (error) {
    fail(error);
  } finally {
    cdp?.close();
  }
};

await main();
