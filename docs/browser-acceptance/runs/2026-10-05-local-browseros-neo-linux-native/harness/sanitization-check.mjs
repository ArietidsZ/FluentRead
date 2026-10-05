#!/usr/bin/env node
/**
 * sanitization-check.mjs
 *
 * Dependency-free sanitization gate for FluentRead browser-acceptance record
 * directories. It walks every text file under the given directory and reports
 * every occurrence of the forbidden content classes that the handoff requires
 * to be removed (or replaced with the canonical placeholders) before a record
 * is handed in:
 *
 *   1. literal workspace path  <HOME>/Dropbox/Workspace/Temp  -> <WORKSPACE>
 *   2. literal home path       <HOME>                         -> <HOME>
 *   3. foreign macOS path      /Users/
 *   4. OpenAI-style key prefix sk-        (at a token start, see rules doc)
 *   5. GitHub OAuth token      /gho_[A-Za-z0-9]{20,}/
 *   6. GitHub PAT prefix       /github_pat_/
 *   7. Bearer token            /Bearer [A-Za-z0-9._-]{20,}/
 *   8. any absolute path containing the machine user name (arietids here)
 *
 * Rules are applied in the order above and already-claimed spans are not
 * re-reported, so the workspace path (the most specific prefix) is attributed
 * to rule 1 and only residual home-path occurrences to rule 2. This mirrors
 * the replacement order mandated for hand-in: workspace path first, then home
 * path.
 *
 * Usage:
 *   node sanitization-check.mjs <directory>
 *
 * Output (stdout), one line per occurrence:
 *   <relative-path>:<line>: <match truncated to 40 chars> [<rule-id>]
 *
 * Exit codes:
 *   0  clean (no violation, no read error)
 *   1  at least one violation or an unreadable file
 *   2  usage error (missing argument, not a directory)
 *
 * Binary files (a NUL byte inside the first 8 KiB) are skipped; symlinks are
 * not followed. The full rule text is recorded in
 * <HOME>/.cache/fluentread-acceptance/linux-native-20261005/recon/sanitization-rules.md
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WORKSPACE_PATH = '<HOME>/Dropbox/Workspace/Temp';
const HOME_PATH = '<HOME>';
const MAX_MATCH_CHARS = 40;
const BINARY_SNIFF_BYTES = 8 * 1024;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const userName = (() => {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER ?? process.env.LOGNAME ?? '';
  }
})();

/** Collect every match of `re` in `line` as {start, end, text} spans. */
const collectRegex = (line, re) => {
  re.lastIndex = 0;
  const spans = [];
  let match;
  while ((match = re.exec(line)) !== null) {
    spans.push({start: match.index, end: match.index + match[0].length, text: match[0]});
    if (match[0].length === 0) re.lastIndex += 1;
  }
  return spans;
};

const rules = [
  {
    id: 'workspace-path',
    find: (line) => collectRegex(line, new RegExp(escapeRegExp(WORKSPACE_PATH), 'gu')),
  },
  {
    id: 'home-path',
    find: (line) => collectRegex(line, new RegExp(escapeRegExp(HOME_PATH), 'gu')),
  },
  {
    id: 'macos-users-path',
    find: (line) => collectRegex(line, /\/Users\//gu),
  },
  {
    id: 'openai-key-prefix',
    find: (line) => collectRegex(line, /(?<![A-Za-z0-9_-])sk-/gu),
  },
  {
    id: 'github-oauth-token',
    find: (line) => collectRegex(line, /gho_[A-Za-z0-9]{20,}/gu),
  },
  {
    id: 'github-pat-prefix',
    find: (line) => collectRegex(line, /github_pat_/gu),
  },
  {
    id: 'bearer-token',
    find: (line) => collectRegex(line, /Bearer [A-Za-z0-9._-]{20,}/gu),
  },
];

if (userName) {
  rules.push({
    id: 'absolute-path-with-username',
    find: (line) => {
      const spans = collectRegex(line, /(?<=^|[\s"'(<={[,:;`])\/[^\s"'`<>()\[\]{},;|\\]*/gu);
      return spans.filter((span) => span.text.includes(userName));
    },
  });
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/** Apply all rules to one line, attributing each span to the first matching rule. */
const findViolations = (line) => {
  const claimed = [];
  const found = [];
  for (const rule of rules) {
    for (const span of rule.find(line)) {
      if (claimed.some((other) => overlaps(other, span))) {
        continue;
      }
      claimed.push({start: span.start, end: span.end});
      found.push({...span, rule: rule.id});
    }
  }
  found.sort((a, b) => a.start - b.start);
  return found;
};

const isBinary = (buffer) => buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);

function* walkFiles(root) {
  const entries = fs
    .readdirSync(root, {withFileTypes: true})
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

const main = () => {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: node sanitization-check.mjs <directory>');
    process.exit(2);
  }

  let stats;
  try {
    stats = fs.statSync(target);
  } catch (error) {
    console.error(`sanitization-check: cannot stat ${target}: ${error.message}`);
    process.exit(2);
  }
  if (!stats.isDirectory()) {
    console.error(`sanitization-check: not a directory: ${target}`);
    process.exit(2);
  }

  let scanned = 0;
  let skippedBinary = 0;
  let readErrors = 0;
  const violations = [];
  const machineNameRuleSuffix = userName ? ` (machine user name: ${userName})` : '';

  for (const file of walkFiles(target)) {
    let buffer;
    try {
      buffer = fs.readFileSync(file);
    } catch (error) {
      readErrors += 1;
      console.error(`scan-error: ${path.relative(target, file)}: ${error.message}`);
      continue;
    }
    if (isBinary(buffer)) {
      skippedBinary += 1;
      continue;
    }
    scanned += 1;
    const relative = path.relative(target, file) || path.basename(file);
    const lines = buffer.toString('utf8').split(/\r?\n/u);
    lines.forEach((line, index) => {
      for (const hit of findViolations(line)) {
        const shown = hit.text.length > MAX_MATCH_CHARS ? `${hit.text.slice(0, MAX_MATCH_CHARS)}…` : hit.text;
        violations.push({path: relative, line: index + 1, rule: hit.rule, shown});
      }
    });
  }

  for (const violation of violations) {
    console.log(`${violation.path}:${violation.line}: ${violation.shown} [${violation.rule}]`);
  }
  console.error(
    `sanitization-check: ${violations.length} violation(s); scanned ${scanned} text file(s), ` +
      `skipped ${skippedBinary} binary file(s), ${readErrors} read error(s); ` +
      `rules: workspace-path -> home-path -> macos-users-path -> openai-key-prefix -> ` +
      `github-oauth-token -> github-pat-prefix -> bearer-token -> absolute-path-with-username${machineNameRuleSuffix}`,
  );
  process.exit(violations.length > 0 || readErrors > 0 ? 1 : 0);
};

main();
