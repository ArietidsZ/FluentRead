#!/usr/bin/env node
/** D: copy the round harness into the record and write the defects directory. */
import fs from 'node:fs';
import path from 'node:path';

const S = '<HOME>/.cache/fluentread-acceptance/linux-native-20261005';
const RECORD = '<WORKSPACE>/FluentRead/docs/browser-acceptance/runs/2026-10-05-local-browseros-neo-linux-native';
const WORKSPACE = '<WORKSPACE>';
const HOME = '<HOME>';
const sanitize = (t) => t.split(WORKSPACE).join('<WORKSPACE>').split(HOME).join('<HOME>');

const keep = [
  'fixture-server.mjs', 'cdp.mjs', 'load-extension.mjs', 'capture-dom.mjs', 'window-bounds.mjs',
  'ext-session.mjs', 'ui-states.mjs', 'dropdown-recon.mjs', 'select-by-text.mjs', 'webgpu-probe.mjs',
  'worker-probe.mjs', 'guard-attempt.sh', 'teardown.sh', 'probe-control-plane.sh',
  'A1-collect.mjs', 'A2-derived.mjs', 'B1-build.mjs', 'C-counterfactual.mjs', 'facts.mjs',
  'D-finalize.mjs', 'F-fixups.mjs', 'sanitization-report.mjs',
];
// NOTE: sanitization-check.mjs is deliberately NOT in this list. The record copy is the
// authoritative one: it derives its path constants at runtime, so it survives sanitization and
// can be re-run in place. Copying the working copy through the sanitizer would replace those
// constants with placeholders and make the checker flag this record's own placeholders.
fs.mkdirSync(path.join(RECORD, 'harness'), {recursive: true});
const copied = [];
for (const name of keep) {
  const from = path.join(S, 'harness', name);
  if (!fs.existsSync(from)) continue;
  fs.writeFileSync(path.join(RECORD, 'harness', name), sanitize(fs.readFileSync(from, 'utf8')));
  copied.push(name);
}

const read = (f) => JSON.parse(fs.readFileSync(path.join(S, f), 'utf8'));
const wb = read('live/window-bounds.json');
const prof = read('live/profile-record.json');
const cp = fs.readFileSync(path.join(S, 'live/control-plane-probe.txt'), 'utf8');
const cleanup = read('live/cleanup-proof.json');

fs.mkdirSync(path.join(RECORD, 'defects'), {recursive: true});
const defects = {
  'DEFECT-10-focus-guard-is-macos-only.json': {
    id: 'DEFECT-10',
    title: 'browser-focus-guard.mjs is a macOS-only observer, so no guard report and no pass is possible on Linux',
    severity: 'blocking',
    file: 'scripts/testing/browser-focus-guard.mjs',
    line: 93,
    assertion: "assert.equal(process.platform,'darwin','This observer requires macOS; it has not been browser-certified here');",
    position: 'first statement of runGuard(), before any argument is read',
    otherPlatformGates: ['osascript probe string (line 75)', 'osascript reads (lines 137, 145) hardcoding /usr/bin/osascript', '/bin/ps reads (lines 104-105)', '/usr/sbin/lsof listener check'],
    observed: {
      once: {exitCode: 1, stderr: "This observer requires macOS; it has not been browser-certified here\n\n'linux' !== 'darwin'"},
      continuous: {exitCode: 1, stderr: "This observer requires macOS; it has not been browser-certified here\n\n'linux' !== 'darwin'"},
      guardReportCreated: false,
      reportStatus: 'present_after_once: no; present_after_continuous: no; created_during_attempt: no',
    },
    preconditionsThatWereSatisfiable: {
      profile: prof.profilePath,
      profileMode: prof.mode,
      profileUid: prof.uid,
      profileUnderTmp: prof.underTmp,
      profileBasenamePrefix: prof.basenamePrefix,
      commandLineHasUnquotedAbsoluteUserDataDir: true,
      listenerOwnedByBrowserPidAndLoopbackOnly: true,
    },
    evidence: ['artifacts/focus/guard-attempt-once.txt', 'artifacts/focus/guard-attempt-continuous.txt', 'artifacts/focus/guard-report-status.txt', 'artifacts/focus/guard-preconditions.txt', 'artifacts/focus/guard-block-transcripts.txt', 'artifacts/focus/guard-block.json'],
    suggestedFix:
      'Express the contract in terms of what can actually be observed on each platform: a normal-size window that never becomes frontmost with an unchanged frontmost PID, plus the existing ownership and listener checks. Add a supported foreground/window probe for Linux, or state explicitly that the guard is macOS-only and that no pass is possible elsewhere.',
  },
  'DEFECT-11-approved-placement-not-honoured.json': {
    id: 'DEFECT-11',
    title: 'The approved partial-visibility placement is unreachable on this host because the compositor ignores the requested window position',
    severity: 'blocking for any visibility assertion',
    requested: 'left=2400, top=120, 1200x900 (the approved arithmetic for a 2560x1440 display)',
    actual: wb.windows,
    honoured: false,
    cause: 'Chromium on Wayland cannot set absolute window positions, so the compositor decides placement.',
    consequence: 'Under temporary-partial-visibility-20261005 the actual geometry left=0 top=0 lies inside the 2560x1440 display and would classify as fully-visible, which the policy rejects.',
    evidence: ['artifacts/focus/window-bounds.json', 'artifacts/host/host-facts.json'],
    suggestedFix: 'A Linux round needs a compositor-aware placement step that can prove the resulting geometry, and the policy check must run against the geometry the compositor actually produced.',
  },
  'DEFECT-12-control-plane-name-and-stdio.json': {
    id: 'DEFECT-12',
    title: 'The named browseros-claw-server binary does not exist on this platform build; the packaged browseros_server hides a --stdio transport',
    severity: 'not executed (unverified capability), not a product failure',
    namedBinarySearched: 'browseros-claw-server / *claw*server* / BrowserClawServer (bounded filesystem search, zero hits)',
    packagedEquivalent: '/usr/lib/browseros/BrowserOSServer/default/resources/bin/browseros_server (0.0.157)',
    userLevelCopy: '<HOME>/.config/browser-os/.browseros/versions/0.0.162/resources/bin/browseros_server',
    helpOutput: 'Usage: browseros-server [options]; options are -V/--version, --config <path>, -h/--help',
    hiddenStdioTokenCounts: {packaged: 2, userLevel: 2},
    autoSpawnedHelper: 'The browser auto-started the bundled helper as browseros_server --config=<temp profile>/.browseros/config.json with no --stdio flag; it exited together with the browser.',
    executed: false,
    note: 'The task-scoped stdio control-plane capability check was NOT executed this round, so this is an unverified capability rather than a failed one. No server was launched and the unrelated instance was never touched.',
    evidence: ['artifacts/neo/control-plane-probe.txt', 'artifacts/hygiene/cleanup-proof.json'],
  },
  'DEFECT-13-tested-local-head-absent.json': {
    id: 'DEFECT-13',
    title: 'The schema constant testedLocalHead is absent from this clone and from origin',
    severity: 'provenance limitation',
    testedLocalHead: '7212af1f9da08324963e38973c7f477aabfffb0b',
    presentLocally: false,
    presentOnOrigin: false,
    originRefs: ['refs/heads/main 0652ce2309c76a09310868acb45e71990533b500', 'refs/heads/acceptance/local-browseros-neo-20261005 0bd32b4aecc2e2ca1dfa999746098358656c7b60', 'refs/heads/acceptance/local-browseros-neo-resume-20261005 4ceace044dec24e5f36ddf5b9fd97140abdf8dfb', 'refs/heads/acceptance/local-browseros-neo-rules-7f8d6dfe-20261005 5a07ef494aee42cc2bf4c8dd945ee7c43b5c4576', 'refs/heads/acceptance/local-browseros-neo-rules-c796cd88-20261005 361435b94aecd064edcf090d75861b14141ffae3', 'refs/heads/review/browser-acceptance-20261005 7f8d6dfe0d8ebd7a526bf9c654ea7e4926518fa1'],
    consequence: 'The value is carried in result.json only because the checked-in schema fixes it as a constant; it could not be corroborated on this host.',
    evidence: ['artifacts/source.json', 'artifacts/host/hygiene.json'],
  },
  'DEFECT-14-product-worktree-incomplete.json': {
    id: 'DEFECT-14',
    title: 'The product worktree on this host is incomplete relative to the published source commit',
    severity: 'provenance limitation, not a product defect',
    publishedSourceCommit: 'c68a53af300b33109375665197951331e45ae18a',
    inScopePaths: 3172,
    matched: 3131,
    modified: 0,
    missing: 41,
    examplesMissing: ['tsconfig.json', 'wxt.config.ts', 'vitest.config.ts', 'userscript/', 'userscript/main.ts', 'userscript/resources/fluentread-data.v1.js'],
    consequence: 'The prebuilt extension can be fingerprinted, but its source tree cannot be fully corroborated on this host. The extension was NOT rebuilt (rebuilding is out of scope).',
    evidence: ['artifacts/source.json', 'artifacts/build/build-files.json'],
  },
  'DEFECT-15-acceptance-selfcheck-cannot-complete.json': {
    id: 'DEFECT-15',
    title: 'The tool self-check browser-acceptance.mjs self-check cannot complete on this host',
    severity: 'tooling prerequisite',
    exitCode: 1,
    cause: "Its language-regression step runs scripts/generate-userscript-language-data.mjs, which fails with \"Cannot find module 'vite'\" because the locked dependencies are not installed here and pnpm is absent.",
    otherSelfChecks: {
      'browser-focus-guard.mjs --self-check': 'exit 0',
      'browser-focus-visibility-selfcheck.mjs': 'negativeChecks: 26, exit 0',
      'browser-focus-guard-entry-selfcheck.mjs': '10 checks, exit 0',
    },
    consequence: 'The validator run on this record is the tooling verification that did succeed; the self-check is reported as not completable rather than passed.',
    evidence: ['artifacts/tools/selfchecks-raw.txt', 'artifacts/tools/selfchecks.json'],
  },
};
for (const [name, body] of Object.entries(defects)) {
  fs.writeFileSync(path.join(RECORD, 'defects', name), sanitize(JSON.stringify(body, null, 2)) + '\n');
}
fs.writeFileSync(path.join(RECORD, 'defects', 'guard-attempt-once.txt'), sanitize(fs.readFileSync(path.join(S, 'live/guard-attempt-once.txt'), 'utf8')));
fs.writeFileSync(path.join(RECORD, 'defects', 'guard-attempt-continuous.txt'), sanitize(fs.readFileSync(path.join(S, 'live/guard-attempt-continuous.txt'), 'utf8')));
fs.writeFileSync(path.join(RECORD, 'defects', 'control-plane-probe.txt'), sanitize(cp));

process.stdout.write(JSON.stringify({harness: copied.length, defects: Object.keys(defects).length + 3, dailyAlive: cleanup.dailyInstance.alive}) + '\n');
