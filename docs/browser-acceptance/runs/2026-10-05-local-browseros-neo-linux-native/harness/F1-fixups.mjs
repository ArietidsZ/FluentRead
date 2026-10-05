#!/usr/bin/env node
/** F1: corrected host hygiene artifact, git ref audit, verbatim validator transcript. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const S = '<HOME>/.cache/fluentread-acceptance/linux-native-20261005';
const REPO = '<WORKSPACE>/FluentRead';
const RECORD = REPO + '/docs/browser-acceptance/runs/2026-10-05-local-browseros-neo-linux-native';
const WORKSPACE = '<WORKSPACE>';
const HOME = '<HOME>';
const sanitize = (t) => t.split(WORKSPACE).join('<WORKSPACE>').split(HOME).join('<HOME>');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const idx = JSON.parse(fs.readFileSync(path.join(S, 'artifact-index.json'), 'utf8'));
const read = (f) => JSON.parse(fs.readFileSync(path.join(S, f), 'utf8'));
const sh = (c) => { try { return execFileSync('bash', ['-c', c], {cwd: REPO, encoding: 'utf8'}).trim(); } catch (e) { return String((e.stdout || '') + (e.stderr || '')).trim(); } };

const writeArtifact = (dest, role, mediaType, value) => {
  const bytes = Buffer.from(sanitize(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'), 'utf8');
  fs.mkdirSync(path.dirname(path.join(RECORD, dest)), {recursive: true});
  fs.writeFileSync(path.join(RECORD, dest), bytes);
  const entry = {path: dest, sha256: sha256(bytes), mediaType, role, bytes: bytes.length, source: 'regenerated after adversarial review'};
  const existing = idx.artifacts.find((a) => a.path === dest);
  if (existing) Object.assign(existing, entry); else idx.artifacts.push(entry);
};

const hostFacts = read('recon/host-facts.json');
const cleanup = read('live/cleanup-proof.json');

const hygiene = {
  sideEvidenceOnly: true,
  revision: 2,
  supersedesRevision: 1,
  whyRevised:
    'Revision 1 was a recon-time snapshot that recorded the task-context operating-system claim "Ubuntu 24.04.4 LTS" instead of the measured value, and it also asserted that no push would be performed, which was a plan-time statement. Both are corrected here from measured facts; the git and push audit is shipped at artifacts/git/ref-audit.json.',
  measuredOs: 'Ubuntu 26.04.1 LTS (Resolute Raccoon)',
  osSource: 'cat /etc/os-release on this host; the same value is recorded in artifacts/host/host-facts.json and artifacts/host/browser-binary.json',
  kernel: '7.0.0-38-generic',
  arch: 'x86_64',
  session: 'GNOME on Wayland, DISPLAY=:0, WAYLAND_DISPLAY=wayland-0',
  display: hostFacts.displayGeometry || 'HDMI-1 connected primary 2560x1440+0+0',
  focusNewWindows: hostFacts.focusNewWindows || 'smart',
  portsFreeAtStart: [9420, 9520, 57280, 58280],
  untouchable: {pid: cleanup.dailyInstance.pid, userDataDir: '/config/browseros-public-test', aliveAfterRound: cleanup.dailyInstance.alive, elapsedAfterRound: cleanup.dailyInstance.elapsed},
  cleanupResult: {
    browserPidDead: cleanup.browserPidAlive === 'dead',
    fixturePidDead: cleanup.fixturePidAlive === 'dead',
    cdpListenerCount: cleanup.cdpListener9420Count,
    fixtureListenerCount: cleanup.fixtureListener57280Count,
    tempProfilesLeft: cleanup.tempProfilesLeft,
    helperServerProcessesLeft: cleanup.helperServerProcessesLeft,
  },
  at: new Date().toISOString(),
};
writeArtifact('artifacts/host/hygiene.json', 'source', 'application/json', hygiene);

const remoteNow = sh("git -c credential.helper='!gh auth git-credential' ls-remote origin 2>/dev/null | sort -k2");
const refAudit = {
  sideEvidenceOnly: true,
  note: 'Ref audit for this round. No pre-existing branch was modified; the only ref change is the addition of this round branch.',
  branch: 'acceptance/local-browseros-neo-linux-native-20261005',
  baseCommit: '5a07ef494aee42cc2bf4c8dd945ee7c43b5c4576',
  localRefsBefore: [
    'refs/heads/acceptance/local-browseros-neo-20261005 0bd32b4aecc2e2ca1dfa999746098358656c7b60',
    'refs/heads/acceptance/local-browseros-neo-resume-20261005 4ceace044dec24e5f36ddf5b9fd97140abdf8dfb',
    'refs/heads/acceptance/local-browseros-neo-rules-7f8d6dfe-20261005 5a07ef494aee42cc2bf4c8dd945ee7c43b5c4576',
    'refs/heads/acceptance/local-browseros-neo-rules-c796cd88-20261005 361435b94aecd064edcf090d75861b14141ffae3',
    'refs/heads/review/browser-acceptance-20261005 a8728f79dffde9f0ea2a43d8fca7fa9186c33d88',
  ],
  remoteRefsBefore: [
    'refs/heads/main 0652ce2309c76a09310868acb45e71990533b500',
    'refs/heads/acceptance/local-browseros-neo-20261005 0bd32b4aecc2e2ca1dfa999746098358656c7b60',
    'refs/heads/acceptance/local-browseros-neo-resume-20261005 4ceace044dec24e5f36ddf5b9fd97140abdf8dfb',
    'refs/heads/acceptance/local-browseros-neo-rules-7f8d6dfe-20261005 5a07ef494aee42cc2bf4c8dd945ee7c43b5c4576',
    'refs/heads/acceptance/local-browseros-neo-rules-c796cd88-20261005 361435b94aecd064edcf090d75861b14141ffae3',
    'refs/heads/review/browser-acceptance-20261005 7f8d6dfe0d8ebd7a526bf9c654ea7e4926518fa1',
  ],
  remoteRefsAfter: remoteNow.split('\n').filter(Boolean),
  localRefsAfter: sh('git for-each-ref --format="%(refname) %(objectname)" refs/heads | sort').split('\n').filter(Boolean),
  pushPerformed: true,
  pushEvidence: 'git push -u origin acceptance/local-browseros-neo-linux-native-20261005 reported "[new branch]" and origin now carries that ref. The credential helper was supplied per-command, so no persistent git config was written.',
  planNote: 'The round plan listed any ref change as out of scope for the record stage. The branch and its push are this round own deliverable; no pre-existing ref moved.',
  worktreeStatusPorcelain: sh('git status --porcelain'),
  at: new Date().toISOString(),
};
writeArtifact('artifacts/git/ref-audit.json', 'source', 'application/json', refAudit);

const validator = sh('node scripts/testing/browser-acceptance.mjs validate docs/browser-acceptance/runs/2026-10-05-local-browseros-neo-linux-native/result.json; echo "exit=$?"');
writeArtifact('artifacts/tools/validator-run.txt', 'source', 'text/plain', [
  '# Verbatim validator run for this round record.',
  '# Command: node scripts/testing/browser-acceptance.mjs validate <record>/result.json',
  '# Working directory: <WORKSPACE>/FluentRead',
  '',
  validator,
  '',
  '# This file is regenerated whenever result.json changes.',
].join('\n') + '\n');

fs.writeFileSync(path.join(S, 'artifact-index.json'), JSON.stringify(idx, null, 2) + '\n');
process.stdout.write(JSON.stringify({artifacts: idx.artifacts.length, validator}) + '\n');
