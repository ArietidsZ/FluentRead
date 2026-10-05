#!/usr/bin/env node
/**
 * sanitization-check.mjs — dependency-free sanitization gate for this record.
 *
 * Derives the forbidden path prefixes at RUNTIME (os.homedir() plus an optional
 * FLUENTREAD_WORKSPACE override) instead of hardcoding them, so that this file survives the
 * record's own path sanitizer unchanged and can be re-run in place.
 *
 * Usage: node sanitization-check.mjs <directory>
 * Exit:  0 clean, 1 at least one violation or read error, 2 usage error.
 *
 * Rules: literal workspace path, literal home path, foreign macOS /Users/ path,
 * OpenAI-style key prefix at a token start, GitHub OAuth token, GitHub PAT prefix,
 * Bearer token, and any absolute path containing the machine user name.
 * Binary files (a NUL byte in the first 8 KiB) are skipped; symlinks are not followed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME_PATH = os.homedir();
const WORKSPACE_PATH = process.env.FLUENTREAD_WORKSPACE || path.join(HOME_PATH, 'Dropbox', 'Workspace', 'Temp');
const MAX_MATCH_CHARS = 40;
const BINARY_SNIFF_BYTES = 8 * 1024;
const SELF_NAME = 'sanitization-check.mjs';

const userName = (() => {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER ?? process.env.LOGNAME ?? '';
  }
})();

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const RULES = [
  {id: 'workspace-path', regex: new RegExp(escapeRegExp(WORKSPACE_PATH), 'gu')},
  {id: 'home-path', regex: new RegExp(escapeRegExp(HOME_PATH), 'gu')},
  {id: 'macos-users-path', regex: /\/Users\//gu},
  {id: 'openai-key-prefix', regex: /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9]{20,}/gu},
  {id: 'github-oauth-token', regex: /gho_[A-Za-z0-9]{20,}/gu},
  {id: 'github-pat-prefix', regex: /github_pat_[A-Za-z0-9_]{20,}/gu},
  {id: 'bearer-token', regex: /Bearer [A-Za-z0-9._-]{20,}/gu},
];
if (userName) RULES.push({id: 'absolute-path-with-username', regex: new RegExp(escapeRegExp(path.sep + 'Users' + path.sep), 'gu')});

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

const target = process.argv[2];
if (!target) {
  process.stderr.write('Usage: node sanitization-check.mjs <directory>\n');
  process.exit(2);
}
if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
  process.stderr.write(`Not a directory: ${target}\n`);
  process.exit(2);
}

let scanned = 0;
let skippedBinary = 0;
let skippedSelf = 0;
let readErrors = 0;
const violations = [];

for (const file of walk(target)) {
  if (path.basename(file) === SELF_NAME) {
    skippedSelf += 1;
    continue;
  }
  let buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch (error) {
    readErrors += 1;
    process.stderr.write(`scan-error: ${path.relative(target, file)}: ${error.message}\n`);
    continue;
  }
  if (buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
    skippedBinary += 1;
    continue;
  }
  scanned += 1;
  const relative = path.relative(target, file) || path.basename(file);
  buffer.toString('utf8').split(/\r?\n/u).forEach((line, index) => {
    for (const rule of RULES) {
      const matches = [...line.matchAll(rule.regex)];
      if (!matches.length) continue;
      const text = matches[0][0];
      const shown = text.length > MAX_MATCH_CHARS ? `${text.slice(0, MAX_MATCH_CHARS)}...` : text;
      violations.push({path: relative, line: index + 1, rule: rule.id, shown});
    }
  });
}

for (const v of violations) process.stdout.write(`${v.path}:${v.line}: ${v.shown} [${v.rule}]\n`);
process.stdout.write(
  `sanitization-check: ${violations.length} violation(s); scanned ${scanned} text file(s), ` +
    `skipped ${skippedBinary} binary file(s), skipped ${skippedSelf} self file(s), ${readErrors} read error(s); ` +
    `rules: ${RULES.map((r) => r.id).join(' -> ')} (machine user name: ${userName || 'unknown'})\n`,
);
process.exit(violations.length > 0 || readErrors > 0 ? 1 : 0);
