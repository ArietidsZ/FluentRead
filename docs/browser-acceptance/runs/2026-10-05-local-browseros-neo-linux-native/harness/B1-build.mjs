#!/usr/bin/env node
/** B1: build result.json for the all-blocked Linux round from this round's measured facts. */
import fs from 'node:fs';
import path from 'node:path';

const S = '<HOME>/.cache/fluentread-acceptance/linux-native-20261005';
const RECORD = '<WORKSPACE>/FluentRead/docs/browser-acceptance/runs/2026-10-05-local-browseros-neo-linux-native';
const idx = JSON.parse(fs.readFileSync(path.join(S, 'artifact-index.json'), 'utf8'));
const have = new Set(idx.artifacts.map((a) => a.path));
const sha = (p) => idx.artifacts.find((a) => a.path === p).sha256;
const read = (f) => JSON.parse(fs.readFileSync(path.join(S, f), 'utf8'));

const build = read('recon/build-files.json');
const prov = read('recon/provenance.json');
const host = read('recon/host-facts.json');
const bin = read('recon/browser-binary.json');
const ext = read('live/ext-session.json');
const wb = read('live/window-bounds.json');
const prof = read('live/profile-record.json');
const gpu = read('live/webgpu-fixture-page.json');
const casesSpec = read('recon/cases.json');
const selfcheck = read('recon/selfchecks.json');
const cleanup = read('live/cleanup-proof.json');

const ROUND = "Round-level blocker: no continuous focus guard interval can exist on this host, because scripts/testing/browser-focus-guard.mjs line 93 asserts process.platform==='darwin' as the first statement of runGuard(), so the guard exits 1 and writes no report file. The acceptance contract requires a completed continuous guard bound to this browser and profile before any case may pass, so every case is blocked. Raw refusal: artifacts/focus/guard-attempt-once.txt and artifacts/focus/guard-attempt-continuous.txt.";

const REASONS = {
  'ENV-01': ROUND + ' Measured this round on this host: browser identity, the extension identity read from its own service worker, a dedicated temporary profile, the WebGPU adapter in three contexts, build and locale fingerprints, and a cleanup proof. Next step: run the round on a guard-capable host, or add a supported Linux foreground/window probe upstream.',
  'UI-01': ROUND + ' Side evidence captured: the real options-page DOM (route sections, navigation, labels, buttons, copy), the provider option list, the per-feature assignment surface, and dark plus 390 px states. Not executed: creating a custom OpenAI-compatible service, the 检查连接 round trip against the loopback fixture, the empty-search assertion, and reopen persistence. The Popup runner additionally needs Playwright and the absent focus-safe helper.',
  'PRIVATE-01': ROUND + ' Not executed. It needs a normal window plus an incognito window, and the documented defect says creating a target inside a new browser context can take the foreground and crash this browser, so that step was not attempted. The runner also needs Playwright and the absent focus-safe helper.',
  'PRIVATE-02': ROUND + ' Not executed. Same two prerequisites as PRIVATE-01, plus cross-context cache and usage isolation observations that were never collected.',
  'YT-01': ROUND + ' Not executed. run-youtube-subtitle-sync-test.cjs hard-requires --playwright-root and --focus-safe-helper; neither exists in this checkout, and fabricating the helper is forbidden.',
  'OCR-UI-01': ROUND + ' Side evidence captured: route #settings-image-translation, the engine option list containing 通用文字 · Tesseract and 漫画文字 · PaddleOCR, the 漫画连续翻译 switch, and dark plus 390 px states. Not executed: explicitly selecting PaddleOCR, proving that selection alone triggers no model download, and reopen persistence.',
  'YT-02': ROUND + ' Not executed. Needs the fixed ASR model assets plus a public non-protected YouTube video; no model weights were downloaded this round.',
  'YT-03': ROUND + ' Not executed. It depends on a completed YT-02 run to measure the 1800 ms display deadline.',
  'YT-04': ROUND + ' Not executed. It depends on a completed YT-02 run for the pause, seek, SPA-switch and teardown lifecycle observations.',
  'YT-05': ROUND + ' Not executed. The negative fault injection needs a working capture path first.',
  'OCR-01': ROUND + ' Not executed. Needs the fixed Paddle detection and recognition assets plus one real single-image inference.',
  'OCR-02': ROUND + ' Not executed. Needs Paddle plus LaMa assets and a reproducible manga image with a fixed SHA-256.',
  'OCR-03': ROUND + ' Not executed. The negative fault injection needs an established physical-GPU OCR session.',
  'TTS-01': ROUND + ' Not executed. Needs the fixed Kokoro assets and one real synthesis run.',
  'TTS-02': ROUND + ' Not executed. Needs a real Kokoro run over the long synthetic text with ending markers.',
  'TTS-03': ROUND + ' Not executed. Needs a real Kokoro session to cancel and restart.',
  'TTS-04': ROUND + ' Not executed. Needs a fully SHA-verified Kokoro cache before offline behaviour can be tested.',
  'TTS-05': ROUND + ' Not executed. The negative fault injection needs an established physical-GPU TTS session.',
  'MT-01': ROUND + " Additionally blocked by a measured capability: this host's WebGPU adapter reports no shader-f16 in all three probed contexts, and the contract requires a real shader-f16 for the FP16 and Index profiles. Needs the five fixed translation profiles and shader-f16.",
  'MT-02': ROUND + ' Not executed. Fault injection per translation profile needs those profiles to run first.',
  'MT-03': ROUND + ' Not executed. It needs at least two real translation models running.',
  'MT-04': ROUND + ' Not executed. Needs a fully SHA-verified fixed-revision model cache before offline behaviour can be tested.',
};

const OBS = {
  'ENV-01': [
    'Browser identity read from the running instance: Chrome/151.0.8160.137 on CDP port 9420, binary sha256 ' + bin.browserSha256 + '.',
    'Extension identity read from the extension own service worker: ' + ext.identity.manifest.name + ' ' + ext.identity.manifest.version + ', id ' + ext.identity.runtimeId + ', loaded with CDP Extensions.loadUnpacked using the approved launch arguments only.',
    'Dedicated temporary profile ' + prof.profilePath + ' with mode ' + prof.mode + ' and owner uid ' + prof.uid + '; the guard was attempted against it and refused on the platform gate only.',
    'WebGPU adapter in three contexts (fixture page, options page, same-origin Blob Worker): vendor ' + gpu.adapter.vendor + ', architecture ' + gpu.adapter.architecture + ', isFallbackAdapter ' + gpu.isFallbackAdapter + ', ' + gpu.features.length + ' features, shader-f16 absent.',
    'Cleanup verified: browser and fixture PIDs dead, no listener on 9420 or 57280, temp profile removed, no leftover helper server, daily instance PID 98229 still alive.',
  ],
  'UI-01': [
    'Real options-page DOM captured at chrome-extension://<extension id>/options.html#settings-general: 16 data-section routes from settings-general to settings-about, navigation groups 通用设置 / 翻译服务 / 翻译设置 / 界面风格 / 划词翻译 / 图片/漫画翻译 / 视频字幕翻译 / 写作助手 / 翻译中心 / 学习中心 / 术语库 / 网站规则 / 翻译统计 / 高级选项 / 备份与恢复 / 关于流畅阅读.',
    'Provider option list read from the real Element Plus dropdown: 免费翻译服务, MyMemory, 微软翻译, 谷歌翻译, DeepL, DeepLX（免费非官方）, 小牛翻译, 有道翻译, Chrome内置AI翻译, 本地模型翻译, 云服务厂商, 腾讯云翻译, 谷歌云翻译, Azure 翻译 and further vendor entries including OpenAI, Gemini, Claude, Ollama（本地）.',
    'Per-feature assignment surface observed: nine 配置连接 buttons under #feature-services, each paired with an el-select whose display text reads 跟随默认 · 免费翻译服务, plus a global 配置服务 button under #settings-general.',
    'Search control observed: input placeholder 搜索所有设置 in the navigation aside.',
    'Theme controls observed: 跟随操作系统 / 亮色主题 / 暗色主题 buttons; dark state captured as a screenshot. Narrow state captured under a 390 px emulated viewport.',
  ],
  'OCR-UI-01': [
    'Real route captured: chrome-extension://<extension id>/options.html#settings-image-translation, reached by clicking the real 图片/漫画翻译 navigation button.',
    'Engine option list read from the real dropdown contains exactly 通用文字 · Tesseract and 漫画文字 · PaddleOCR; the current display text is 通用文字 · Tesseract.',
    'Page copy observed: 漫画连续翻译, 提前翻译后续页面 3 张图片, 使用 PaddleOCR，当前页优先，只提前处理已加载的图片。, 识别资源与下载, and 圈选翻译设置 with the Shift+Z hint.',
    'The 漫画连续翻译 switch is present and was measured as on; dark and 390 px states captured as screenshots.',
  ],
};

const evidenceFor = {
  'ENV-01': ['artifacts/env01/cdp-version.json', 'artifacts/env01/extension-identity.json', 'artifacts/focus/profile-record.json', 'artifacts/env01/gpu-log.json', 'artifacts/hygiene/cleanup-proof.json', 'artifacts/focus/guard-attempt-once.txt'],
  'UI-01': ['artifacts/env01/dom-options.json', 'artifacts/env01/dom-dropdown-recon.json', 'artifacts/env01/dom-ui-states.json', 'artifacts/env01/options-light.png', 'artifacts/env01/options-dark.png', 'artifacts/env01/options-narrow-390.png'],
  'OCR-UI-01': ['artifacts/env01/dom-ocr-engine-options.json', 'artifacts/env01/dom-ui-states.json', 'artifacts/env01/options-manga-route.png'],
};

const template = JSON.parse(fs.readFileSync('<WORKSPACE>/FluentRead/docs/browser-acceptance/result.template.json', 'utf8'));
const cases = template.cases.map((t) => {
  const spec = casesSpec.find((c) => c.id === t.id);
  return {
    id: t.id,
    status: 'blocked',
    kind: spec.kind,
    backend: t.id === 'ENV-01' || t.id === 'MT-01' ? 'hardware-webgpu' : 'unverified',
    models: [],
    reason: REASONS[t.id],
    observations: OBS[t.id] ?? [],
    evidence: (evidenceFor[t.id] ?? []).filter((p) => have.has(p)),
    durationMs: null,
    runs: [],
    faults: [],
  };
});

const result = {
  schemaVersion: 2,
  testedLocalHead: '7212af1f9da08324963e38973c7f477aabfffb0b',
  expectedSourceTree: '50e12ecc7f4c72448f03e714a585814eb9476622',
  runId: 'fluentread-browseros-neo-local-2026-10-05-05-linux-native',
  startedAt: '2026-10-05T11:12:56.000Z',
  finishedAt: new Date().toISOString(),
  overall: 'blocked',
  environment: {
    os: 'Ubuntu 26.04.1 LTS (Resolute Raccoon), kernel 7.0.0-38-generic, x86_64, GNOME on Wayland',
    browser: 'BrowserOS (Chromium), Linux build',
    browserVersion: '151.0.8160.137',
    browserosVersion: '151.0.8160.137 (dpkg browseros 151.0.8160.137; this Linux build exposes no separate BrowserOS product version; the bundled control plane is browseros_server 0.0.157)',
    launchMode: 'linux-background-setsid (setsid nohup; the process was never activated and no window was raised)',
    profileMarker: prof.profilePath,
    focusPolicy: 'Never activated, never moved, resized, minimized or fullscreened after launch, Page.bringToFront() never called, no focus-stealing API used. A continuous focus guard was attempted against this exact browser and profile and refused because it requires macOS, so no guard interval exists and no case may pass. The unrelated daily BrowserOS instance was never touched.',
    windowPlacement: 'Requested left=2400 top=120 1200x900 (the approved partial-visibility arithmetic for a 2560x1440 display), but the compositor placed the window at left=0 top=0 1200x900 with windowState normal, so the request was NOT honoured. Chromium on Wayland cannot set absolute window positions. Under the approved policy that actual geometry would classify as fully-visible, so the placement requirement is unmet in addition to the missing guard.',
    extensionId: ext.identity.runtimeId,
    extensionName: ext.identity.manifest.name,
    extensionVersion: ext.identity.manifest.version,
    browserExecutableSha256: bin.browserSha256,
    profileKind: 'dedicated-temporary',
    launchArguments: [
      '--user-data-dir=' + prof.profilePath,
      '--remote-debugging-port=9420',
      '--remote-allow-origins=http://127.0.0.1:9420',
      '--window-position=2400,120',
      '--window-size=1200,900',
      '--no-first-run',
      '--no-default-browser-check',
      'note: exactly the approved launch arguments; no --load-extension was passed and no extra flag was needed, because CDP Extensions.loadUnpacked succeeded with the approved arguments alone',
    ],
    capabilityEvidence: ['artifacts/env01/cdp-version.json', 'artifacts/env01/extension-identity.json'],
    nodeVersion: bin.nodeVersion,
    pnpmVersion: 'absent (pnpm is not installed on this host; the extension was not rebuilt and must not be)',
    browserPid: cleanup.browserPid,
    profilePathSha256: prof.profilePathSha256,
    visibilityPolicy: 'temporary-partial-visibility-20261005',
  },
  provenance: {
    publishedSourceCommit: 'c68a53af300b33109375665197951331e45ae18a',
    checkoutCommit: prov.headCommit,
    observedSourceTree: prov.c68Tree,
    worktreeCleanBeforeLocaleGeneration: prov.worktreeClean,
    lockfileSha256: prov.lockfileSha256.product,
    buildManifest: 'artifacts/build/build-files.json',
    generatedLocalesManifest: 'artifacts/build/generated-locales.json',
    commands: [
      'node scripts/testing/browser-acceptance.mjs fingerprint <extension build> extension-build',
      'node scripts/testing/browser-acceptance.mjs fingerprint <repo>/userscript/languages generated-locales',
      'node scripts/testing/browser-acceptance.mjs self-check',
      'node scripts/testing/browser-focus-guard.mjs --self-check',
      'node scripts/testing/browser-focus-visibility-selfcheck.mjs',
      'node scripts/testing/browser-focus-guard-entry-selfcheck.mjs',
      'node scripts/testing/browser-acceptance.mjs validate <record>/result.json',
    ],
  },
  hardware: {
    status: 'physical',
    osGpuDescription: 'NVIDIA GeForce RTX 5090 (GB202) at 01:00.0, driver 595.91.07, CUDA 13.2, /dev/dri/renderD128 present',
    adapterDescription: '',
    isFallbackAdapter: gpu.isFallbackAdapter,
    features: gpu.features,
    limits: gpu.limits,
    evidence: ['artifacts/env01/gpu-log.json', 'artifacts/env01/webgpu-fixture-page.json', 'artifacts/env01/webgpu-options-page.json', 'artifacts/env01/webgpu-extension-worker.json'],
    adapterInfo: {vendor: gpu.adapter.vendor, architecture: gpu.adapter.architecture, device: gpu.adapter.device, description: gpu.adapter.description},
    adapterLabel: 'NVIDIA RTX 5090 via WebGPU GPUAdapterInfo (vendor=nvidia, architecture=blackwell); Chromium 151 reports device and description as empty strings, and shader-f16 is absent from the feature set in all three probed contexts',
    rawAdapterObservation: {
      artifact: 'artifacts/env01/webgpu-fixture-page.json',
      sha256: sha('artifacts/env01/webgpu-fixture-page.json'),
      eventIndex: 0,
      context: 'page: loopback fixture page',
      at: gpu.at,
    },
  },
  models: [],
  cases,
  artifacts: idx.artifacts.map((a) => ({path: a.path, sha256: a.sha256, mediaType: a.mediaType, role: a.role})),
  limitations: [
    'This round produced ZERO passes. No case may pass without a completed continuous focus guard interval, and the upstream guard refuses to run on this Linux host at scripts/testing/browser-focus-guard.mjs line 93, which asserts process.platform===\'darwin\' before it reads any argument. The refusal is recorded verbatim in artifacts/focus/guard-attempt-once.txt and artifacts/focus/guard-attempt-continuous.txt, and no guard report file was created.',
    'DEFECT-10 (new, this round): browser-focus-guard.mjs is a macOS-only observer. It hardcodes /usr/bin/osascript for the foreground/display probe and /usr/sbin/lsof for listener ownership, so on this host neither the process identity nor the foreground probe can run at all. Every other guard precondition was satisfiable here and is recorded in artifacts/focus/guard-preconditions.txt: a private temporary profile under /tmp with mode 700 owned by the current uid, an unquoted absolute --user-data-dir in the process command line, and a loopback-only CDP listener owned by the browser PID.',
    'DEFECT-11 (new, this round): the approved partial-visibility placement is not achievable on this host. The launch asked for left=2400 top=120 on a 2560x1440 display, but the compositor placed the window at left=0 top=0, which under the approved policy would be fully-visible. Chromium on Wayland cannot set absolute window positions, so a future Linux round needs a compositor-aware placement step before any visibility assertion can hold.',
    'DEFECT-12 (new, this round): the named task-scoped control plane binary browseros-claw-server does not exist anywhere on this host. The packaged equivalent is browseros_server (0.0.157 at /usr/lib/browseros/BrowserOSServer/default/resources/bin/browseros_server, plus a user-level 0.0.162 copy). Its --help advertises only --version, --config and --help, but the literal token --stdio is present in both binaries, so a stdio transport probably exists without being documented. It was NOT spawned this round, so the task-scoped stdio capability check remains unexecuted rather than failed. The browser also auto-started that helper with --config pointing inside this round temporary profile; it exited with the browser and no such process remains.',
    'DEFECT-13 (new, this round): the checked-in schema fixes testedLocalHead to 7212af1f9da08324963e38973c7f477aabfffb0b, but that commit is absent from this clone and from origin (origin carries only main, four acceptance branches and the review branch). The value is carried in result.json only because the schema fixes it as a constant; it could not be corroborated on this host.',
    'Provenance limitation: the product worktree on this host is incomplete relative to commit c68a53af. 41 of 3172 in-scope paths are absent, including tsconfig.json, wxt.config.ts, vitest.config.ts and all of userscript/, so the prebuilt extension can be fingerprinted but its source tree cannot be fully corroborated here. The extension was NOT rebuilt (rebuilding is out of scope for this round).',
    'Capability limitation: the WebGPU adapter on this host reports no shader-f16 in the page, the options page and a same-origin Blob Worker, so the FP16 and Index translation profiles of MT-01 could not satisfy their admission requirement even with a guard. This is a measured capability refusal, not a rewritten one.',
    'All browser observations in this record are SIDE EVIDENCE ONLY. They were collected without any guard interval, so they document what the real UI and the real adapter did on this host but support no pass, and the extension DOM recon was not used to claim any UI-01 or OCR-UI-01 assertion.',
    'The extension id djnlaiohfaaifbibleebjggkghlmcpcj matches the previous round because the build manifest carries a key field that pins the id; it was read this round from the extension own service worker, not copied from any earlier record.',
    'Local tooling limitation: the round agent harness refused several tool calls with an auto-mode classifier failure. The affected steps were retried and completed except the task-scoped stdio control-plane spawn, which was therefore not executed. Nothing in this record depends on a refused call.',
    'The fixture chat endpoint evidence is fixture-server contract evidence only. The POST was issued by the harness directly against the loopback fixture, not by the extension, and it proves the fixture works rather than any product behaviour.',
  ],
};

fs.writeFileSync(path.join(RECORD, 'result.json'), JSON.stringify(result, null, 2) + '\n');
const bad = result.cases.filter((c) => !c.reason || c.reason.length < 80).map((c) => c.id);
const unregistered = result.cases.flatMap((c) => c.evidence.filter((e) => !have.has(e))).concat(result.hardware.evidence.filter((e) => !have.has(e))).concat(result.environment.capabilityEvidence.filter((e) => !have.has(e)));
process.stdout.write(JSON.stringify({cases: result.cases.length, artifacts: result.artifacts.length, weakReasons: bad, unregistered, selfcheckExit: selfcheck.acceptanceSelfcheckExitCode}) + '\n');
