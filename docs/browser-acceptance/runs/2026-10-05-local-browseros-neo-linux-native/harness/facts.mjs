#!/usr/bin/env node
/** Small fact collectors for the FluentRead Linux acceptance round. */
import fs from 'node:fs';
import {execSync} from 'node:child_process';

const S = '<HOME>/.cache/fluentread-acceptance/linux-native-20261005';
const sh = (c) => {
  try { return execSync(c, {encoding: 'utf8'}).trim(); } catch (e) { return ((e.stdout || '') + '').trim() || 'exit=' + e.status; }
};
const read = (f) => fs.readFileSync(S + '/' + f, 'utf8').trim();
const browserPid = Number(read('live/browser.pid'));
const fixturePid = Number(read('live/fixture.pid'));
const profile = read('live/profile-path.txt');

const cleanup = {
  sideEvidenceOnly: true,
  at: new Date().toISOString(),
  label: 'Hygiene evidence for this round. No continuous focus guard interval exists on this host so nothing here supports a pass.',
  browserPid,
  fixturePid,
  profilePath: profile,
  browserPidAlive: sh(`kill -0 ${browserPid} 2>/dev/null && echo alive || echo dead`),
  fixturePidAlive: sh(`kill -0 ${fixturePid} 2>/dev/null && echo alive || echo dead`),
  cdpListener9420Count: sh('lsof -nP -iTCP:9420 -sTCP:LISTEN | tail -n +2 | wc -l'),
  fixtureListener57280Count: sh('lsof -nP -iTCP:57280 -sTCP:LISTEN | tail -n +2 | wc -l'),
  profileStillExists: fs.existsSync(profile),
  tempProfilesLeft: sh('ls -d /tmp/fluentread-* 2>/dev/null | wc -l'),
  helperServerProcessesLeft: sh("pgrep -f 'browseros_serve[r] --config' | wc -l"),
  guardProcessesLeft: sh("pgrep -f 'browser-focus-guar[d].mjs' | wc -l"),
  ownedBrowserProcessesLeft: sh("pgrep -f 'fluentread-linux-nativ[e]' | wc -l"),
  dailyInstance: {
    pid: 98229,
    alive: sh('kill -0 98229 2>/dev/null && echo alive || echo dead'),
    started: sh('ps -p 98229 -o lstart='),
    elapsed: sh('ps -p 98229 -o etime='),
    command: sh('ps -p 98229 -o args= | cut -c1-140'),
  },
  note:
    'The bundled browseros_server helper that the browser auto-started with --config pointing inside this round temp profile exited together with the browser; no such process remains.',
};
fs.writeFileSync(S + '/live/cleanup-proof.json', JSON.stringify(cleanup, null, 2) + '\n');

const commands = {
  sideEvidenceOnly: true,
  at: new Date().toISOString(),
  label: 'Structured record of the commands this round actually ran on this host. Not acceptance evidence.',
  commands: [
    'uname -a; sw_vers 2>/dev/null; node -v; for c in ps pgrep lsof osascript curl git; do command -v $c; done  (environment self-check)',
    'node <repo>/scripts/testing/browser-focus-guard.mjs --once --allow-partial-visibility --profile <tmp profile> --pid <browser pid> --port 9420 --output <run>/guard-report.json  (refused: requires macOS)',
    'node <repo>/scripts/testing/browser-focus-guard.mjs --allow-partial-visibility --profile <tmp profile> --pid <browser pid> --port 9420 --output <run>/guard-report.json  (continuous, refused the same way)',
    'node <repo>/scripts/testing/browser-focus-guard.mjs --self-check',
    'node <repo>/scripts/testing/browser-focus-visibility-selfcheck.mjs',
    'node <repo>/scripts/testing/browser-focus-guard-entry-selfcheck.mjs',
    'node <repo>/scripts/testing/browser-acceptance.mjs self-check',
    'node <repo>/scripts/testing/browser-acceptance.mjs fingerprint <extension build> extension-build',
    'node <repo>/scripts/testing/browser-acceptance.mjs fingerprint <repo>/userscript/languages generated-locales',
    'node <repo>/scripts/testing/browser-acceptance.mjs validate <record>/result.json',
    'setsid nohup <browser binary> --user-data-dir=<tmp profile> --remote-debugging-port=9420 --remote-allow-origins=http://127.0.0.1:9420 --window-position=2400,120 --window-size=1200,900 --no-first-run --no-default-browser-check',
    'setsid nohup node <run>/harness/fixture-server.mjs 57280 <run>/live/fixture-url.txt',
    'node <run>/harness/load-extension.mjs 9420 <extension build>   (Extensions.loadUnpacked, succeeded with the approved launch arguments only)',
    'node <run>/harness/window-bounds.mjs 9420 <out> left=2400,top=120,1200x900',
    'node <run>/harness/ext-session.mjs 9420 <extension id> http://127.0.0.1:57280/ <out>',
    'node <run>/harness/capture-dom.mjs 9420 <out>/dom options|popup|57280',
    'node <run>/harness/ui-states.mjs 9420 <out>/dom',
    'node <run>/harness/dropdown-recon.mjs 9420 <out>/dropdown-recon.json',
    'node <run>/harness/select-by-text.mjs 9420 <out>/ocr-engine-options.json Tesseract #settings-image-translation',
    'node <run>/harness/webgpu-probe.mjs 9420 127.0.0.1:57280 <out>/webgpu-fixture-page.json',
    'node <run>/harness/webgpu-probe.mjs 9420 options.html <out>/webgpu-options-page.json',
    'node <run>/harness/worker-probe.mjs 9420 options.html <out>/webgpu-extension-worker.json 12000',
    'bash <run>/harness/teardown.sh <browser pid> <fixture pid> <tmp profile> 9420',
    'nvidia-smi; lspci | grep -Ei vga; ls -la /dev/dri; xrandr --current',
  ],
};
fs.writeFileSync(S + '/live/commands.json', JSON.stringify(commands, null, 2) + '\n');

process.stdout.write(JSON.stringify({cleanup: cleanup.dailyInstance.alive, tempProfilesLeft: cleanup.tempProfilesLeft, helperLeft: cleanup.helperServerProcessesLeft, listeners: [cleanup.cdpListener9420Count, cleanup.fixtureListener57280Count]}) + '\n');
