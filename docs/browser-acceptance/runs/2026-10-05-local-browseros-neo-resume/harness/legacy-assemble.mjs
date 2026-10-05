/**
 * Assemble result.json for the FluentRead BrowserOS Neo local acceptance run.
 *
 * Every artifact digest is computed from the real file on disk. The report is
 * written with all 22 cases blocked, because the frozen handoff contract cannot
 * certify any pass on this machine: several hard prerequisites are absent and no
 * real model was run. See defect-report.md.
 *
 * Local username paths are redacted before anything is written.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);
// Local absolute paths were redacted before publication. When re-running, point
// FR_ACCEPTANCE_BASE at the directory containing the product worktree
// (fluentread-acceptance-product), the handoff worktree (FluentRead) and acceptance/.
const BASE = process.env.FR_ACCEPTANCE_BASE ?? path.resolve(process.cwd(), '../../../../../../..');
const ACC = path.join(BASE, 'acceptance');
const PRODUCT = path.join(BASE, 'fluentread-acceptance-product');
const HOME = process.env.HOME ?? '';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Replace any absolute path that embeds the local username. */
const redact = value => typeof value === 'string'
  ? value.split(HOME).join('<HOME>').split(BASE).join('<WORKSPACE>')
  : value;

const template = JSON.parse(await fs.readFile(path.join(BASE, 'FluentRead/docs/browser-acceptance/result.template.json'), 'utf8'));
const recon = JSON.parse(await fs.readFile(path.join(ACC, 'artifacts/env01/env01-recon.json'), 'utf8'));
const workerContext = JSON.parse(await fs.readFile(path.join(ACC, 'artifacts/env01/worker-context.json'), 'utf8'));
const buildManifest = JSON.parse(await fs.readFile(path.join(ACC, 'artifacts/build/build-files.json'), 'utf8'));
const localesManifest = JSON.parse(await fs.readFile(path.join(ACC, 'artifacts/build/generated-locales.json'), 'utf8'));
const profilePath = (await fs.readFile(path.join(ACC, 'profile-path.txt'), 'utf8')).trim();

const {stdout: swVers} = await run('/usr/bin/sw_vers', []);
const osVersion = swVers.trim().split('\n').map(line => line.trim()).join('; ');
const browserExe = '/Applications/BrowserOS neo.app/Contents/MacOS/BrowserOS neo';
const {stdout: browserHashOut} = await run('/usr/bin/shasum', ['-a', '256', browserExe]);
const browserExecutableSha256 = browserHashOut.trim().split(/\s+/u)[0];
const lockfileSha256 = sha256(await fs.readFile(path.join(PRODUCT, 'pnpm-lock.yaml')));

const SOURCE_COMMIT = 'c68a53af300b33109375665197951331e45ae18a';
const SOURCE_TREE = '50e12ecc7f4c72448f03e714a585814eb9476622';
const startedAt = recon.startedAt;
const finishedAt = new Date().toISOString();

// ---- capabilities.json ------------------------------------------------------
const capabilities = {
  browserosVersion: '0.50.5.0',
  browserosBundleVersion: '0.50.5',
  chromiumVersion: '151.0.8162.137',
  chromiumRevision: recon.revision,
  tools: [
    'tabs', 'tab_groups', 'history', 'navigate', 'snapshot', 'diff', 'act', 'download', 'upload',
    'read', 'grep', 'screenshot', 'pdf', 'wait', 'windows', 'evaluate', 'run', 'name_session',
    'save_skill', 'mark_skill_run', 'request_human_help', 'await_human_help',
  ],
  operations: [
    'CDP Extensions.loadUnpacked (loaded the unpacked MV3 build into a dedicated temporary profile)',
    'CDP Target.createTarget / Target.attachToTarget (flat sessions) for background tabs',
    'CDP Runtime.evaluate in normal-page, extension-page and extension-worker contexts',
    'CDP Page.captureScreenshot for PNG evidence',
    'CDP Target.createBrowserContext / disposeBrowserContext (incognito reachability)',
    'MCP browseros-neo 0.0.66 tools/list on the installed control surface (read-only, 22 tools)',
  ],
  observations: [
    'The installed MCP control surface (browseros-neo 0.0.66, 22 tools) is bound to the single configured profile directory ~/Library/Application Support/BrowserClaw.',
    'Launching a second instance with --user-data-dir yields its own CDP port but no separate BrowserClawServer/MCP proxy: only 127.0.0.1:9111 (CDP) was listening, while the MCP proxy/server ports belonged to the pre-existing instance.',
    'Chromium 151 no longer honours --load-extension; the unpacked build had to be loaded through CDP Extensions.loadUnpacked.',
  ],
};
await fs.writeFile(path.join(ACC, 'artifacts/env01/capabilities.json'), JSON.stringify(capabilities, null, 2));

// ---- source.json ------------------------------------------------------------
const source = {
  publishedSourceCommit: SOURCE_COMMIT,
  checkoutCommit: SOURCE_COMMIT,
  observedSourceTree: SOURCE_TREE,
  expectedSourceTree: SOURCE_TREE,
  worktreeCleanBeforeLocaleGeneration: true,
  lockfileSha256,
  lockfilePath: 'pnpm-lock.yaml',
  testedLocalHead: '7212af1f9da08324963e38973c7f477aabfffb0b',
  notes: [
    'git rev-parse c68a53af^{tree} returned 50e12ecc... before the worktree was created; the tree gate passed.',
    'The product worktree was created detached at the published source commit and reported 0 modified paths immediately before locale generation.',
    'git ls-files userscript/languages contains 480 files across es-ES, fr-FR, ja-JP, ko-KR and ru-RU only; there is no zh-CN entry in the frozen commit.',
  ],
};
await fs.writeFile(path.join(ACC, 'artifacts/source.json'), JSON.stringify(source, null, 2));

// ---- build command log (structured, role browser-log) -----------------------
const logTails = {};
for (const name of ['generate-locales', 'compile', 'build']) {
  const text = await fs.readFile(path.join(ACC, `artifacts/logs/${name}.log`), 'utf8');
  logTails[name] = {bytes: Buffer.byteLength(text), sha256: sha256(Buffer.from(text)), tail: redact(text.trim().split('\n').slice(-4).join('\n')).slice(0, 700)};
}
const buildCommands = {
  events: [
    {event: 'environment', at: startedAt, context: 'local shell', node: 'v22.23.3', pnpm: '9.12.1', note: 'Node 22.23.3 installed keg-only via Homebrew; pnpm 9.12.1 installed under that Node. Node 26.10.0 remains the default on PATH.'},
    {event: 'tree-gate', at: startedAt, context: 'git rev-parse c68a53af^{tree}', expected: SOURCE_TREE, observed: SOURCE_TREE, passed: true},
    {event: 'worktree-create', at: startedAt, context: 'git worktree add --detach', commit: SOURCE_COMMIT, dirtyPathsBeforeLocaleGeneration: 0},
    {event: 'install', at: startedAt, context: 'pnpm install --frozen-lockfile', exitCode: 0, durationMs: 22000, nodeModulesBytes: 1503238553},
    {event: 'generate-userscript-languages', at: startedAt, context: 'pnpm generate:userscript-languages', exitCode: 0, ...logTails['generate-locales']},
    {event: 'compile', at: startedAt, context: 'pnpm compile (vue-tsc --noEmit)', exitCode: 0, ...logTails.compile},
    {event: 'build', at: startedAt, context: 'pnpm build (wxt build)', exitCode: 0, totalSize: '110.47 MB', ...logTails.build},
    {event: 'verify-emitted-model-workers', at: startedAt, context: 'node scripts/testing/verify-emitted-model-workers.mjs --extension-dir .output/chrome-mv3', exitCode: 0},
    {event: 'fingerprint', at: finishedAt, context: 'browser-acceptance.mjs fingerprint', buildFiles: buildManifest.files.length, localeFiles: localesManifest.files.length},
  ],
};
await fs.writeFile(path.join(ACC, 'artifacts/build/commands.json'), JSON.stringify(buildCommands, null, 2));

// ---- artifact registry ------------------------------------------------------
const ARTIFACTS = [
  ['artifacts/build/build-files.json', 'application/json', 'build-manifest'],
  ['artifacts/build/generated-locales.json', 'application/json', 'locale-manifest'],
  ['artifacts/build/commands.json', 'application/json', 'browser-log'],
  ['artifacts/source.json', 'application/json', 'source'],
  ['artifacts/env01/capabilities.json', 'application/json', 'capabilities'],
  ['artifacts/env01/gpu-log.json', 'application/json', 'gpu-log'],
  ['artifacts/env01/worker-context.json', 'application/json', 'gpu-log'],
  ['artifacts/env01/browser-log.json', 'application/json', 'browser-log'],
  ['artifacts/env01/fixture-home.png', 'image/png', 'screenshot'],
  ['artifacts/env01/extension-options-page.png', 'image/png', 'screenshot'],
  ['artifacts/env01/extension-offscreen.png', 'image/png', 'screenshot'],
  ['artifacts/env01/incognito-fixture.png', 'image/png', 'screenshot'],
];
const artifacts = [];
for (const [rel, mediaType, role] of ARTIFACTS) {
  const bytes = await fs.readFile(path.join(ACC, rel));
  artifacts.push({path: rel, sha256: sha256(bytes), mediaType, role});
}
const evidenceOf = role => artifacts.filter(a => a.role === role).map(a => a.path);

// ---- shared blocked reasons -------------------------------------------------
// DEFECT-01 was resolved upstream in a8728f79 ("fix: align browser acceptance with
// native locale and GPU contracts"). The validator now requires the five languages
// the userscript generator really emits (es-ES, fr-FR, ja-JP, ko-KR, ru-RU) and
// additionally checks inlineChineseSources (zh-CN.ts + i18n/index.ts) as the
// Chinese evidence. No case below is blocked for locale reasons any more.
const HELPER = 'The trusted focus-safe helper (focus-safe-browser.cjs) required by --focus-safe-helper does not exist anywhere on this machine and is not shipped in the repository; the handoff forbids fabricating it.';
const PLAYWRIGHT = 'Playwright is not a dependency of the frozen commit (absent from package.json and from pnpm-lock.yaml), so the --playwright-root runtime cannot be resolved from this checkout.';
const NO_MODELS = 'No real model assets were downloaded for this run (deferred by the operator), so no fixed revision, file size or SHA-256 could be verified against model-catalog.json.';
const NO_SEEDER = 'No harness script can pre-populate the fluent-read-local-models-v2 or fluent-read-manga-ocr-v1 caches; weights can only be fetched by the product itself through its own settings UI.';

const cases = template.cases.map(item => {
  const base = {...item, status: 'blocked', backend: 'unverified', models: [], observations: [], evidence: [], durationMs: null, runs: [], faults: []};
  const block = (reason, observations = [], evidence = []) => ({...base, reason, observations, evidence});
  const envEvidence = ['artifacts/env01/capabilities.json', 'artifacts/env01/browser-log.json', 'artifacts/env01/gpu-log.json', 'artifacts/env01/fixture-home.png'];
  switch (item.id) {
    case 'ENV-01':
      return block(
        `Partially executed, then blocked. ${HELPER} The window/focus-protection prerequisite for ENV-01 therefore cannot be met. Every other ENV-01 sub-requirement that could be observed without that helper was observed and is listed below.`,
        [
          `Dedicated temporary profile used: ${redact(profilePath)} (created with mkdtemp, mode 700, owned by this run).`,
          'BrowserOS neo 0.50.5.0, Chromium 151.0.8162.137 (revision ' + recon.revision + '); bundle CFBundleShortVersionString 0.50.5.',
          'Extension identity read from the extension page itself via chrome.runtime.getManifest(): FluentRead-流畅阅读 0.0.35, MV3, id ' + recon.extensionId + '.',
          'The MV3 build was loaded with CDP Extensions.loadUnpacked; Chromium 151 ignores --load-extension, which is what the repository specials still pass.',
          `OS GPU: ${recon.osGpuDescription}; WebGPU adapter info vendor=apple architecture=metal-3 isFallbackAdapter=false with 22 features including shader-f16.`,
          'WebGPU adapter obtained in four separate contexts: normal page, extension offscreen document, extension-origin Worker, and incognito page — all isFallbackAdapter=false with shader-f16.',
          `Incognito reachable: a browser context was created and a page loaded in it (${recon.incognitoReachable}); the context was disposed afterwards.`,
          'The installed MCP control surface (browseros-neo 0.0.66, 22 tools) is bound to the single configured profile directory and cannot be aimed at a dedicated temporary profile; a second instance with --user-data-dir exposes CDP only.',
          'Window/focus protection was not certified: the browser was started with `open -g` (no foreground activation) and Page.bringToFront() was never called, but no trusted focus-safe helper exists to validate against.',
          'Every tab was opened in the background; no window was minimized and no window was activated.',
        ],
        envEvidence);
    case 'UI-01':
      return block(`Not executed. Requires scripts/testing/run-popup-actions-service-ui-test.cjs. ${HELPER} ${PLAYWRIGHT} That script also carries a hardcoded default pointing at a helper path from a different machine (/Users/thinkstu/...), which is a top-level require and fails at load.`);
    case 'PRIVATE-01':
      return block(`Not executed. Requires scripts/run-privacy-boundary-test.cjs, which throws at startup unless --focus-safe-helper resolves to a module exporting launchFocusSafePersistentContext, newPageWithoutForeground and activateExtensionTabWithoutForeground. ${HELPER} ${PLAYWRIGHT}`);
    case 'PRIVATE-02':
      return block(`Not executed. Same runner and same missing prerequisites as PRIVATE-01. ${HELPER} ${PLAYWRIGHT} The incognito isolation assertions were therefore never observed.`);
    case 'YT-01':
      return block(`Not executed. Requires scripts/run-youtube-subtitle-sync-test.cjs, which hard-requires both --focus-safe-helper and --playwright-root and throws if either is absent. ${HELPER} ${PLAYWRIGHT}`);
    case 'OCR-UI-01':
      return block(`Not executed. Requires scripts/testing/run-image-recognition-settings-test.cjs, which requires both --playwright-root and --focus-safe-helper and hardcodes a macOS-only temp profile. ${HELPER} ${PLAYWRIGHT}`);
    case 'YT-02': case 'YT-03': case 'YT-04':
      return block(`Not executed. A real-site model case: it needs a public YouTube video and the fixed qwen3-asr-0.6b revisions executing on a physical GPU. ${NO_MODELS} ${NO_SEEDER}`);
    case 'YT-05':
      return block(`Not executed. The independent negative fixture needs a working local capture path first. ${NO_MODELS} ${NO_SEEDER}`);
    case 'OCR-01': case 'OCR-02':
      return block(`Not executed. Requires the fixed snowfluke/ppu-paddle-ocr-models and ogkalu/lama-manga-onnx-dynamic revisions executing on a physical GPU. ${NO_MODELS} ${NO_SEEDER}`);
    case 'OCR-03':
      return block(`Not executed. Fault injection requires an established working GPU session to inject into. ${NO_MODELS}`);
    case 'TTS-01': case 'TTS-02': case 'TTS-03':
      return block(`Not executed. Requires the fixed kokoro-v1.1-zh revision executing on a physical GPU. ${NO_MODELS} ${NO_SEEDER}`);
    case 'TTS-04':
      return block(`Not executed. Offline cache verification requires a previously fully verified Kokoro cache. ${NO_MODELS}`);
    case 'TTS-05':
      return block(`Not executed. Fault injection requires an established working GPU TTS session. ${NO_MODELS}`);
    case 'MT-01':
      return block(`Not executed. Requires all five strict-GPU translation profiles (OPUS zh→en and en→zh FP16, OPUS ja→en FP32, Index zh→en and en→zh) with every direction run. ${NO_MODELS} ${NO_SEEDER}`);
    case 'MT-02':
      return block(`Not executed. Fault injection per GPU profile requires the profiles to be present and runnable first. ${NO_MODELS}`);
    case 'MT-03':
      return block(`Not executed. Requires at least two real models to switch between. ${NO_MODELS}`);
    case 'MT-04':
      return block(`Not executed. Offline verification requires a fully SHA-verified fixed-revision cache first. ${NO_MODELS}`);
    default:
      return block('Not executed. No prerequisite failure was recorded for this case; it simply was not reached in this run.');
  }
});

// ---- hardware ---------------------------------------------------------------
const gpuEvidence = ['artifacts/env01/gpu-log.json', 'artifacts/env01/worker-context.json'];
const hardware = {
  status: 'physical',
  osGpuDescription: recon.osGpuDescription,
  adapterDescription: `apple metal-3 via GPUAdapterInfo (vendor=apple, architecture=metal-3; Chromium 151 reports GPUAdapterInfo.device and .description as empty strings)`,
  isFallbackAdapter: false,
  features: recon.pageGpu.features,
  limits: recon.pageGpu.limits,
  evidence: gpuEvidence,
};

// ---- environment ------------------------------------------------------------
const environment = {
  os: `macOS 27.2 (build 26B5091g), arm64, Apple M2 Max`,
  browser: 'BrowserOS neo (Chromium)',
  browserVersion: '151.0.8162.137',
  browserosVersion: '0.50.5.0',
  launchMode: 'macos-background-open (-g -n; no foreground activation)',
  profileMarker: redact(profilePath),
  focusPolicy: 'never activated, never minimized, Page.bringToFront() never called; no trusted focus-safe helper available to validate against',
  windowPlacement: 'primary display only (single display present), 1440x960, background window',
  extensionId: recon.extensionId,
  extensionName: recon.extensionName,
  extensionVersion: recon.extensionVersion,
  browserExecutableSha256,
  profileKind: 'dedicated-temporary',
  launchArguments: [
    '--user-data-dir=' + redact(profilePath),
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-unsafe-extension-debugging',
    '--window-size=1440,960',
    '--window-position=40,40',
    'note: --load-extension was passed on a first attempt and ignored by Chromium 151; the extension was loaded via CDP Extensions.loadUnpacked instead',
  ],
  capabilityEvidence: ['artifacts/env01/capabilities.json'],
  nodeVersion: 'v22.23.3',
  pnpmVersion: '9.12.1',
};

const provenance = {
  publishedSourceCommit: SOURCE_COMMIT,
  checkoutCommit: SOURCE_COMMIT,
  observedSourceTree: SOURCE_TREE,
  worktreeCleanBeforeLocaleGeneration: true,
  lockfileSha256,
  buildManifest: 'artifacts/build/build-files.json',
  generatedLocalesManifest: 'artifacts/build/generated-locales.json',
  commands: [
    'git rev-parse c68a53af300b33109375665197951331e45ae18a^{tree}',
    'git worktree add --detach <WORKSPACE>/fluentread-acceptance-product c68a53af300b33109375665197951331e45ae18a',
    'pnpm install --frozen-lockfile',
    'pnpm generate:userscript-languages',
    'pnpm compile',
    'pnpm build',
    'node scripts/testing/verify-emitted-model-workers.mjs --extension-dir .output/chrome-mv3',
    'node scripts/testing/browser-acceptance.mjs fingerprint ../fluentread-acceptance-product/.output/chrome-mv3 extension-build',
    'node scripts/testing/browser-acceptance.mjs fingerprint ../fluentread-acceptance-product/userscript/languages generated-locales',
    'node scripts/testing/browser-acceptance.mjs serve',
    'node scripts/testing/browser-acceptance.mjs self-check',
  ],
};

const report = {
  schemaVersion: 2,
  testedLocalHead: template.testedLocalHead,
  expectedSourceTree: SOURCE_TREE,
  runId: 'fluentread-browseros-neo-local-' + startedAt.slice(0, 10) + '-01',
  startedAt,
  finishedAt,
  overall: 'blocked',
  environment,
  provenance,
  hardware,
  models: [],
  cases,
  artifacts,
  limitations: [
    'DEFECT-01 RESOLVED upstream in a8728f79: the previous revision required a zh-CN member in the generated-locales manifest, which the frozen source commit can never produce (RegisteredUiLanguage excludes zh-CN), so any pass was rejected with "Generated locale missing: zh-CN". The updated validator requires the five languages the userscript generator really emits and validates inlineChineseSources (src/core/i18n/messages/zh-CN.ts, src/core/i18n/index.ts) as the Chinese evidence instead. The locale manifest recorded here was regenerated with the updated tooling at a8728f79 and is accepted by the updated validator. No case is blocked for locale reasons any more.',
    'DEFECT-02 (blocking for 5 cases): the trusted focus-safe helper focus-safe-browser.cjs required by --focus-safe-helper exists neither in the repository nor anywhere under $HOME, and the handoff forbids fabricating it. UI-01, PRIVATE-01, PRIVATE-02, YT-01 and OCR-UI-01 depend on it.',
    'DEFECT-03 (blocking for 5 cases): Playwright is absent from package.json and pnpm-lock.yaml, so --playwright-root cannot be satisfied from this checkout.',
    'DEFECT-04: Chromium 151 ignores --load-extension, which the repository browser specials still pass; the unpacked build had to be loaded through CDP Extensions.loadUnpacked.',
    'DEFECT-05: the BrowserOS neo MCP control surface is bound to the single configured profile directory; a second instance launched with --user-data-dir exposes CDP only. The handoff requires a dedicated temporary profile, so browser cases cannot be driven through the MCP tools.',
    'GPU note: the legacy GPUAdapter.isFallbackAdapter property is ABSENT in Chromium 151; fallback state is reported on GPUAdapterInfo.isFallbackAdapter (=false). The same physical adapter with shader-f16 was observed in the extension offscreen document and in an extension-origin Worker, not only in a normal page.',
    'GPU scope note: this is adapter discovery only. No model was executed, so there is no WebGPU dispatch or graph-partition evidence, and hardware.status must not be read as inference validation.',
    'No real model was downloaded or executed: the model-catalog profiles (about 5.03 GiB) are unverified, and models[] is empty by design rather than filled with unverified metadata.',
    'No harness script can pre-populate the fluent-read-local-models-v2 or fluent-read-manga-ocr-v1 caches, so every real-model case would additionally need product-UI-driven downloads.',
    'The tested product HEAD (7212af1f9da08324963e38973c7f477aabfffb0b) is not present in this clone; the published source commit c68a53af was used, and its tree was verified to equal 50e12ecc... as the handoff requires.',
    'self-check passes and its positive samples are synthetic validator fixtures, explicitly not browser or model acceptance results.',
    'Acceptance material revision: the handoff worktree was updated to a8728f79dffde9f0ea2a43d8fca7fa9186c33d88 ("fix: align browser acceptance with native locale and GPU contracts"). Only docs/browser-acceptance/README.md and three scripts/testing acceptance scripts changed; the product source commit c68a53af and its tree 50e12ecc... are unchanged, so the extension build was not rebuilt and its fingerprint still applies.',
    'The updated self-check runs a native locale regression with the real generator: it observed exactly five generated files (es-ES, fr-FR, ja-JP, ko-KR, ru-RU), rejected each one when removed, and rejected both an empty and a corrupted inlineChineseSources set, for 34 negative regressions in total.',
    'Generated locales were already committed in the frozen source commit (git status stayed clean across locale generation); the fingerprint above describes the committed 480-file set. Its manifestSha256 (abc11522ec049930f8721119422d1808c13549061438fb08b6841fef26f48866) is unchanged by the update because the file set did not change; only the inlineChineseSources block was added to the manifest.',
  ],
};

await fs.writeFile(path.join(ACC, 'result.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  ok: true,
  cases: cases.length,
  artifacts: artifacts.length,
  overall: report.overall,
  statuses: cases.reduce((acc, c) => ({...acc, [c.status]: (acc[c.status] ?? 0) + 1}), {}),
  buildFiles: buildManifest.files.length,
  localeFiles: localesManifest.files.length,
  workerContextF16: workerContext.probe.hasShaderF16,
}));
