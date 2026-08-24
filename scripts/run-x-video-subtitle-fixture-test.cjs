#!/usr/bin/env node

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const SUPPORTED_DURATIONS = new Set([10, 15, 30]);
const SUPPORTED_SCENARIOS = new Set(['natural-pauses', 'long-pauses']);
const DEFAULT_FIRST_CAPTION_MS = { tiny: 7000, base: 9000 };
const DEFAULT_RESOURCE_LIMITS = {
  // Chromium 会为扩展 renderer 保留一部分启动基线，且不同 Edge 运行会
  // 在约 300–620 MB 之间波动。结束态以本次首个采样为基线，仍保留固定
  // 余量和峰值比例约束；这样不会把正常基线误报成泄漏，也不会放过 1 GB
  // 级别的模型 heap 残留。
  tiny: { settledBaselineHeadroomMb: 120, settledRssFallbackMb: 550, settledToPeakRatio: 0.35 },
  base: { settledBaselineHeadroomMb: 160, settledRssFallbackMb: 700, settledToPeakRatio: 0.40 },
};
const NATURAL_SENTENCES = [
  'At sunrise, the research team opened the lab and checked the new system.',
  'A few moments later, the first results appeared clearly on the screen.',
  'The speaker reviewed the numbers and explained why the change mattered.',
  'Outside, traffic moved slowly while the afternoon rain covered the windows.',
  'Back inside, the team compared both models and recorded every observation.',
  'They finished the test with a concise summary and a plan for tomorrow.',
];

function arg(name, fallback) {
  const exact = `--${name}`;
  const assigned = `${exact}=`;
  for (let index = process.argv.length - 1; index >= 2; index -= 1) {
    const value = process.argv[index];
    if (value.startsWith(assigned)) return value.slice(assigned.length);
    if (value === exact) {
      const next = process.argv[index + 1];
      return next && !next.startsWith('--') ? next : 'true';
    }
  }
  return fallback;
}

function hasArg(name) {
  const exact = `--${name}`;
  return process.argv.some((value) => value === exact || value.startsWith(`${exact}=`));
}

function booleanArg(name, fallback) {
  const raw = String(arg(name, fallback)).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(raw)) return true;
  if (['false', '0', 'no'].includes(raw)) return false;
  throw new Error(`--${name} 只接受 true/false，实际为：${raw}`);
}

function integerArg(name, fallback, { min = 0 } = {}) {
  const raw = arg(name, String(fallback));
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`--${name} 必须是不小于 ${min} 的整数，实际为：${raw}`);
  }
  return value;
}

function buildSpeechPlan(durationSeconds, scenario) {
  const sentenceCount = durationSeconds === 10
    ? 2
    : durationSeconds === 15
      ? 3
      : scenario === 'long-pauses' ? 5 : 6;
  const pausePattern = scenario === 'long-pauses'
    ? [1400, 1800, 1300, 1700, 1500]
    : [650, 850, 700, 900, 750];
  const sentences = NATURAL_SENTENCES.slice(0, sentenceCount);
  const segments = sentences.map((text, index) => ({
    text,
    pauseAfterMs: index === sentences.length - 1 ? 0 : pausePattern[index % pausePattern.length],
  }));
  const firstSentenceWordCount = (sentences[0]?.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
  const estimatedFirstSpeechEndMs = Math.round(firstSentenceWordCount * 60_000 / 185);
  return {
    durationSeconds,
    scenario,
    voice: 'Samantha',
    wordsPerMinute: 185,
    estimatedFirstSpeechEndMs,
    segments,
    speechText: segments
      .map(({ text, pauseAfterMs }) => `${text}${pauseAfterMs ? ` [[slnc ${pauseAfterMs}]]` : ''}`)
      .join(' '),
  };
}

function summarizeTimeline(timeline) {
  const events = Array.isArray(timeline?.events) ? timeline.events : [];
  const start = events.find((event) => event.kind === 'marker' && event.name === 'ai-request-start');
  const aiCaptionEvents = [];
  let previousOriginal = '';
  events.forEach((event) => {
    if (event.kind !== 'caption' || (start && event.sequence <= start.sequence)) return;
    const original = event.source === 'ai' && typeof event.original === 'string'
      ? event.original.trim()
      : '';
    if (original && original !== previousOriginal) aiCaptionEvents.push(event);
    previousOriginal = original;
  });
  const firstCaption = aiCaptionEvents[0] || null;
  const distinctOriginals = [...new Set(aiCaptionEvents.map((event) => event.original.trim()))];
  const finalOriginalByCueId = new Map();
  aiCaptionEvents.forEach((event) => {
    const cueId = typeof event.cueId === 'string' && event.cueId
      ? event.cueId
      : `legacy:${event.original.trim()}`;
    finalOriginalByCueId.set(cueId, event.original.trim());
  });
  return {
    aiRequestStartedAtMs: start?.wallTimeMs ?? null,
    firstCaptionAtMs: firstCaption?.wallTimeMs ?? null,
    firstCaptionLatencyMs: start && firstCaption
      ? Math.max(0, firstCaption.wallTimeMs - start.wallTimeMs)
      : null,
    firstCaptionPlaybackMs: firstCaption?.playbackMs ?? null,
    firstCaptionWhilePlaying: firstCaption
      ? firstCaption.paused === false && firstCaption.ended === false
      : false,
    nonEmptyCaptionEvents: aiCaptionEvents.length,
    distinctOriginals,
    stableOriginals: [...finalOriginalByCueId.values()],
    diagnosticEvents: Array.isArray(timeline?.diagnostics) ? timeline.diagnostics.length : 0,
  };
}

function transcriptTokens(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function approximateTokenEqual(left, right) {
  if (left === right) return true;
  if (left.length < 4 || right.length < 4) return false;
  return Math.abs(left.length - right.length) <= 3
    && (left.startsWith(right) || right.startsWith(left));
}

function longestBoundaryOverlap(left, right) {
  const first = transcriptTokens(left);
  const second = transcriptTokens(right);
  for (let size = Math.min(first.length, second.length); size >= 1; size -= 1) {
    if (first.slice(-size).every((token, index) => approximateTokenEqual(token, second[index]))) return size;
  }
  return 0;
}

function longestSharedTokenSuffix(left, right) {
  const first = transcriptTokens(left);
  const second = transcriptTokens(right);
  for (let size = Math.min(first.length, second.length); size >= 1; size -= 1) {
    if (first.slice(-size).every((token, index) =>
      approximateTokenEqual(token, second[second.length - size + index]))) return size;
  }
  return 0;
}

function hasRepeatedLeadingBoundarySentence(left, right) {
  const leadingSentence = String(right || '').trim().match(/^(.+?[.!?。！？][”’"']?)(?:\s+|$)/u)?.[1] || '';
  if (!leadingSentence) return false;
  const overlap = longestSharedTokenSuffix(left, leadingSentence);
  if (overlap >= 3) return true;
  if (overlap !== 2) return false;
  return transcriptTokens(leadingSentence).slice(-2).every((token) => token.length >= 5);
}

function containsRepeatedTokenRun(value, minimumRun = 4) {
  const tokens = transcriptTokens(value);
  for (let size = Math.floor(tokens.length / 2); size >= minimumRun; size -= 1) {
    for (let first = 0; first <= tokens.length - size * 2; first += 1) {
      for (let second = first + size; second <= tokens.length - size; second += 1) {
        if (tokens.slice(first, first + size)
          .every((token, index) => approximateTokenEqual(token, tokens[second + index]))) return true;
      }
    }
  }
  return false;
}

function estimateSpeechStarts(speechPlan) {
  let cursorMs = 0;
  return speechPlan.segments.map(({ text, pauseAfterMs }) => {
    const startMs = cursorMs;
    const wordCount = transcriptTokens(text).length;
    cursorMs += wordCount * 60_000 / speechPlan.wordsPerMinute + pauseAfterMs;
    return { text, startMs };
  });
}

function findCaptionPlaybackStart(timeline, expectedText) {
  const target = transcriptTokens(expectedText).slice(0, 4);
  const events = Array.isArray(timeline?.events) ? timeline.events : [];
  const matches = events.filter((event) => {
    if (event.kind !== 'caption' || event.source !== 'ai' || typeof event.original !== 'string') return false;
    const tokens = transcriptTokens(event.original);
    return target.length > 0 && target.every((token, index) => tokens[index] === token);
  });
  const playbackTimes = matches
    .map((event) => event.playbackMs)
    .filter((value) => typeof value === 'number' && Number.isFinite(value));
  return playbackTimes.length > 0 ? Math.min(...playbackTimes) : null;
}

function sampleBrowserProcessTree(profileDir) {
  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,%cpu=,rss=,command='], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) return null;
  const processes = result.stdout.split('\n').map((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/);
    return match ? {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      cpu: Number(match[3]),
      rssKb: Number(match[4]),
      command: match[5],
    } : null;
  }).filter(Boolean);
  const roots = processes.filter((process) =>
    process.command.includes(profileDir)
    && /Microsoft Edge|Chrom(?:e|ium)/i.test(process.command)
    && !/\bnode\b/i.test(process.command));
  if (roots.length === 0) return null;

  const selected = new Set(roots.map((process) => process.pid));
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (!selected.has(process.pid) && selected.has(process.ppid)) {
        selected.add(process.pid);
        changed = true;
      }
    }
  }
  const tree = processes.filter((process) => selected.has(process.pid));
  const extensionProcesses = tree.filter((process) => /--extension-process\b/.test(process.command));
  const largest = [...tree].sort((left, right) => right.rssKb - left.rssKb)[0] || null;
  return {
    atEpochMs: Date.now(),
    processCount: tree.length,
    totalCpuPercent: Number(tree.reduce((sum, process) => sum + process.cpu, 0).toFixed(1)),
    totalRssMb: Number((tree.reduce((sum, process) => sum + process.rssKb, 0) / 1024).toFixed(1)),
    extensionCpuPercent: Number(extensionProcesses.reduce((sum, process) => sum + process.cpu, 0).toFixed(1)),
    extensionRssMb: Number((extensionProcesses.reduce((sum, process) => sum + process.rssKb, 0) / 1024).toFixed(1)),
    largestProcess: largest ? {
      pid: largest.pid,
      type: largest.command.match(/--type=([^\s]+)/)?.[1] || 'browser',
      cpuPercent: largest.cpu,
      rssMb: Number((largest.rssKb / 1024).toFixed(1)),
      extensionProcess: /--extension-process\b/.test(largest.command),
    } : null,
  };
}

function summarizeResourceSamples(samples) {
  const available = samples.filter(Boolean);
  const initialExtensionRssMb = available[0]?.extensionRssMb || 0;
  const maximum = (key) => available.reduce((value, sample) => Math.max(value, sample[key] || 0), 0);
  const tail = available.slice(-3);
  const peakExtensionRssMb = maximum('extensionRssMb');
  const settledExtensionRssMb = tail.length > 0
    ? Math.max(...tail.map((sample) => sample.extensionRssMb || 0))
    : 0;
  return {
    sampleCount: available.length,
    initialExtensionRssMb,
    peakTotalCpuPercent: maximum('totalCpuPercent'),
    peakTotalRssMb: maximum('totalRssMb'),
    peakExtensionCpuPercent: maximum('extensionCpuPercent'),
    peakExtensionRssMb,
    peakLargestProcessRssMb: available.reduce(
      (value, sample) => Math.max(value, sample.largestProcess?.rssMb || 0),
      0,
    ),
    settledExtensionCpuPercent: tail.length > 0
      ? Math.max(...tail.map((sample) => sample.extensionCpuPercent || 0))
      : 0,
    settledExtensionRssMb,
    settledToPeakExtensionRssRatio: peakExtensionRssMb > 0
      ? Number((settledExtensionRssMb / peakExtensionRssMb).toFixed(3))
      : 0,
  };
}

const HELP = `FluentRead X 无原生字幕长时 fixture

用法：
  pnpm test:video:x-fixture -- --duration=30 --model=tiny

核心参数：
  --duration=10|15|30             fixture 播放时长，默认 30
  --media-source=data|blob|mse    fixture 媒体源类型，默认 data；blob/mse 用于模拟 X 的 Blob/MediaSource URL
  --scenario=natural-pauses       自然语句与短停顿，默认
  --scenario=long-pauses          自然语句与较长停顿
  --model=tiny|base               本地 Whisper 模型，默认 tiny
  --generation-mode=full           完整生成、翻译完成后再播放，默认 full
  --max-first-caption-ms=<毫秒>   首条非空 AI 字幕上限；默认 tiny=7000、base=9000
  --first-caption-wait-ms=<毫秒>  等待首条字幕的硬超时；默认上限再加 5000
  --full-generation-wait-ms=<毫秒> 完整扫描、识别、翻译等待上限；默认至少 90 秒
  --min-caption-events=<数量>     至少记录的非空 AI 字幕事件数，默认 10s=1、15s=2、30s=4
  --tail-settle-ms=<毫秒>         视频结束后的诊断收集时间，默认 2500
  --translation-delay-ms=<毫秒>   fixture 译文返回延迟，默认 0
  --resource-sample-ms=<毫秒>     Edge 进程树采样间隔，默认 1000；0 表示关闭
  --artifacts-dir=<目录>          events JSON 与截图目录
  --profile-dir=<目录>            专用隔离浏览器 profile
  --focus-safe-helper=<文件>      macOS 隐藏 CDP 启动器；后台真实浏览器测试时传入
  --print-plan                    只输出 fixture 计划，不启动浏览器
  --help                          显示帮助

原有的空格参数形式（例如 --model tiny）继续受支持。`;

function loadPlaywright(root) {
  try {
    return require('playwright');
  } catch {
    const runtimeRequire = createRequire(path.join(path.resolve(root), '__fluentread_x_fixture_test__.cjs'));
    return runtimeRequire('playwright');
  }
}

const X_URL = 'https://x.com/cerebras/status/2089870131291943228';
const X_FIXTURE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Cerebras on X fixture</title></head>
<body><main id="root"></main></body></html>`;

async function main() {
  if (hasArg('help')) {
    console.log(HELP);
    return;
  }

  const localModel = arg('model', 'tiny');
  if (!['tiny', 'base'].includes(localModel)) throw new Error(`不支持的本地字幕模型：${localModel}`);
  const durationSeconds = integerArg('duration', 30, { min: 1 });
  if (!SUPPORTED_DURATIONS.has(durationSeconds)) {
    throw new Error(`--duration 只支持 10、15、30 秒，实际为：${durationSeconds}`);
  }
  const scenario = arg('scenario', 'natural-pauses');
  if (!SUPPORTED_SCENARIOS.has(scenario)) {
    throw new Error(`不支持的 fixture 场景：${scenario}；可选 natural-pauses、long-pauses`);
  }
  const mediaSource = arg('media-source', 'data');
  if (!['data', 'blob', 'mse'].includes(mediaSource)) {
    throw new Error(`不支持的 fixture 媒体源：${mediaSource}；可选 data、blob、mse`);
  }
  const generationMode = arg('generation-mode', 'full');
  if (generationMode !== 'full') {
    throw new Error(`当前 fixture 只验证完整生成模式，实际为：${generationMode}`);
  }
  const maxFirstCaptionMs = integerArg('max-first-caption-ms', DEFAULT_FIRST_CAPTION_MS[localModel], { min: 500 });
  const firstCaptionWaitMs = integerArg('first-caption-wait-ms', maxFirstCaptionMs + 5000, { min: maxFirstCaptionMs });
  const fullGenerationWaitMs = integerArg(
    'full-generation-wait-ms',
    Math.max(90_000, durationSeconds * 8_000),
    { min: 10_000 },
  );
  const defaultMinCaptionEvents = durationSeconds >= 30 ? 4 : durationSeconds >= 15 ? 2 : 1;
  const minCaptionEvents = integerArg('min-caption-events', defaultMinCaptionEvents, { min: 1 });
  const tailSettleMs = integerArg('tail-settle-ms', localModel === 'base' ? 5_500 : 2_500, { min: 0 });
  const translationDelayMs = integerArg('translation-delay-ms', 0, { min: 0 });
  const resourceSampleMs = integerArg('resource-sample-ms', 1000, { min: 0 });
  const resourceLimits = DEFAULT_RESOURCE_LIMITS[localModel];
  const speechPlan = buildSpeechPlan(durationSeconds, scenario);
  const thresholds = {
    maxFirstCaptionMs,
    maxFirstCaptionPlaybackMs: localModel === 'tiny'
      ? speechPlan.estimatedFirstSpeechEndMs + 400
      : null,
    firstCaptionWaitMs,
    fullGenerationWaitMs,
    minCaptionEvents,
    tailSettleMs,
    translationDelayMs,
    resourceSampleMs,
    maxSettledExtensionRssFallbackMb: resourceLimits.settledRssFallbackMb,
    settledExtensionRssBaselineHeadroomMb: resourceLimits.settledBaselineHeadroomMb,
    maxSettledToPeakExtensionRssRatio: resourceLimits.settledToPeakRatio,
  };
  if (hasArg('print-plan')) {
    console.log(JSON.stringify({ model: localModel, speechPlan, thresholds }, null, 2));
    return;
  }

  const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
  const playwrightRoot = arg('playwright-root', process.env.PLAYWRIGHT_ROOT);
  const artifactsDir = path.resolve(arg('artifacts-dir', path.join(os.tmpdir(), 'fluentread-x-video-subtitle-fixture')));
  const browserPath = arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  const headless = booleanArg('headless', false);
  const disableGpu = booleanArg('disable-gpu', false);
  const focusSafeHelperPath = arg(
    'focus-safe-helper',
    process.env.FLUENTREAD_FOCUS_SAFE_BROWSER_HELPER || '',
  );
  const requestedProfileDir = arg('profile-dir', '');
  const profileDir = requestedProfileDir
    ? path.resolve(requestedProfileDir)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-edge-x-video-fixture-'));
  const cleanupProfile = !requestedProfileDir;
  if (requestedProfileDir) fs.mkdirSync(profileDir, { recursive: true });
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error(`找不到扩展构建：${extensionDir}`);
  fs.mkdirSync(artifactsDir, { recursive: true });

  const mediaPath = path.join(profileDir, 'fixture.webm');
  const speechPath = path.join(profileDir, 'fixture.aiff');
  const eventsArtifactPath = path.join(artifactsDir, 'x-video-subtitle-events.json');
  const screenshotPaths = {
    modelPrompt: path.join(artifactsDir, 'x-video-subtitle-model-prompt.png'),
    firstCaption: path.join(artifactsDir, 'x-video-subtitle-live.png'),
    aiFinal: path.join(artifactsDir, 'x-video-subtitle-ai-final.png'),
    final: path.join(artifactsDir, 'x-video-subtitle-fixture.png'),
    failure: path.join(artifactsDir, 'x-video-subtitle-failure.png'),
  };
  const speechResult = spawnSync('say', [
    '-v', speechPlan.voice,
    '-r', String(speechPlan.wordsPerMinute),
    '-o', speechPath,
    speechPlan.speechText,
  ]);
  const hasSpeechFixture = speechResult.status === 0
    && fs.existsSync(speechPath)
    && fs.statSync(speechPath).size > 2048;
  if (!hasSpeechFixture) {
    throw new Error(`无法生成可识别的语音 fixture；需要 macOS say：${speechResult.stderr?.toString() || speechResult.error || speechResult.status}`);
  }
  const mediaResult = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=30',
    '-i', speechPath,
    '-t', String(durationSeconds), '-af', 'apad',
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libvpx', '-c:a', 'libopus', '-b:a', '64k', mediaPath,
  ]);
  if (mediaResult.status !== 0) throw new Error(`无法生成 X fixture 音视频：${mediaResult.stderr?.toString() || mediaResult.status}`);
  const fixtureVideoDataUrl = `data:video/webm;base64,${fs.readFileSync(mediaPath).toString('base64')}`;
  let mseVideoDataUrl = fixtureVideoDataUrl;
  if (mediaSource === 'mse') {
    // Chrome/Edge 的 WebM MSE parser 会拒绝部分带 Opus pre-skip 的整段
    // append（会报 timecode before previous block）。X 的实际媒体更接近
    // fragmented MP4，因此 MSE fixture 使用可重复 append 的 fMP4 音视频。
    const mseMediaPath = path.join(profileDir, 'fixture-mse.mp4');
    const mseMediaResult = spawnSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=30',
      '-i', speechPath,
      '-t', String(durationSeconds), '-af', 'apad',
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k',
      '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
      mseMediaPath,
    ]);
    if (mseMediaResult.status !== 0) {
      throw new Error(`无法生成 X fixture fMP4 音视频：${mseMediaResult.stderr?.toString() || mseMediaResult.status}`);
    }
    mseVideoDataUrl = `data:video/mp4;base64,${fs.readFileSync(mseMediaPath).toString('base64')}`;
  }

  const requestLog = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requestLog.push({ method: request.method, url: request.url, bytes: Buffer.concat(chunks).length });
    response.statusCode = 200;
    response.setHeader('content-type', 'application/json');
    if (request.url?.endsWith('/chat/completions')) {
      if (translationDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, translationDelayMs));
      }
      response.end(JSON.stringify({ choices: [{ message: { content: 'X 视频 AI 字幕。' } }] }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const { chromium } = loadPlaywright(playwrightRoot);
  const pageErrors = [];
  const pageConsole = [];
  const workerConsole = [];
  let page = null;
  let prepareModelDurationMs = null;
  let fixtureTimeline = { schemaVersion: 1, events: [], diagnostics: [] };
  let fixtureMetrics = summarizeTimeline(fixtureTimeline);
  const resourceSamples = [];
  let resourceSampleTimer = null;
  let fixtureResult = null;
  let launchMode = '';
  let focusPolicy = '';
  const capturedScreenshots = new Set();
  const persistEventsArtifact = (status, error = null) => {
    const screenshots = Object.fromEntries(Object.entries(screenshotPaths)
      .filter(([name, screenshotPath]) => capturedScreenshots.has(name) && fs.existsSync(screenshotPath)));
    fs.writeFileSync(eventsArtifactPath, `${JSON.stringify({
      schemaVersion: 1,
      status,
      generatedAt: new Date().toISOString(),
      configuration: {
        model: localModel,
        durationSeconds,
        scenario,
        thresholds,
        headless,
        disableGpu,
        launchMode,
        focusPolicy,
        profileMode: cleanupProfile ? 'temporary' : 'explicit-isolated',
      },
      speechPlan,
      prepareModelDurationMs,
      metrics: fixtureMetrics,
      resources: {
        summary: summarizeResourceSamples(resourceSamples),
        samples: resourceSamples,
      },
      timeline: fixtureTimeline,
      result: fixtureResult,
      requestLog,
      errors: {
        run: error ? String(error.stack || error) : null,
        page: pageErrors,
        pageConsole: pageConsole.slice(-120),
        workerConsole: workerConsole.slice(-120),
      },
      artifacts: {
        events: eventsArtifactPath,
        screenshots,
      },
    }, null, 2)}\n`);
  };
  const browserArgs = [
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    '--disable-crash-reporter',
    '--disable-features=Crashpad',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--start-minimized',
    '--window-position=-10000,-10000',
    '--no-first-run',
    '--no-default-browser-check',
    ...(disableGpu ? ['--disable-gpu'] : []),
  ];
  const focusSafeHelper = focusSafeHelperPath
    ? require(path.resolve(focusSafeHelperPath))
    : null;
  const launchedBrowser = focusSafeHelper
    ? await focusSafeHelper.launchFocusSafePersistentContext({
        chromium,
        profileDir,
        browserPath,
        headless,
        background: true,
        browserArgs,
        viewport: { width: 1280, height: 900 },
      })
    : {
        context: await chromium.launchPersistentContext(profileDir, {
          executablePath: browserPath,
          headless,
          args: browserArgs,
          viewport: { width: 1280, height: 900 },
        }),
        launchMode: headless ? 'playwright-headless' : 'playwright-headed',
        focusPolicy: headless ? 'headless' : 'foreground-unauthorized-without-helper',
        close: null,
      };
  const context = launchedBrowser.context;
  launchMode = launchedBrowser.launchMode;
  focusPolicy = launchedBrowser.focusPolicy;
  const createPage = () => focusSafeHelper
    ? focusSafeHelper.newPageWithoutForeground(context)
    : context.newPage();
  if (resourceSampleMs > 0) {
    const collectResourceSample = () => {
      const sample = sampleBrowserProcessTree(profileDir);
      if (sample) resourceSamples.push(sample);
      if (resourceSamples.length > 240) resourceSamples.shift();
    };
    collectResourceSample();
    resourceSampleTimer = setInterval(collectResourceSample, resourceSampleMs);
  }

  context.on('page', (extensionPage) => {
    extensionPage.on('pageerror', (error) => pageErrors.push(`${extensionPage.url()}: ${error.stack || error.message}`));
    extensionPage.on('console', (message) => pageConsole.push(`${extensionPage.url()} ${message.type()}: ${message.text()}`));
    extensionPage.on('worker', (worker) => {
      worker.on('console', (message) => workerConsole.push(`${worker.url()} ${message.type()}: ${message.text()}`));
    });
  });
  try {
    const worker = context.serviceWorkers()[0]
      || await context.waitForEvent('serviceworker', { timeout: 30000 });
    const extensionId = worker.url().match(/^chrome-extension:\/\/([^/]+)/)?.[1];
    if (!extensionId) throw new Error(`无法取得扩展 ID：${worker.url()}`);

    const control = await createPage();
    await control.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await control.waitForTimeout(500);
    await control.evaluate(async ({ customUrl, localModel }) => {
      const stored = await chrome.storage.local.get('config');
      const previous = stored.config || {};
      await chrome.storage.local.set({ config: {
        ...previous,
        on: true,
        from: 'en',
        to: 'zh-Hans',
        videoTranslationEnabled: true,
        videoLocalModel: localModel,
        videoService: 'custom',
        videoServiceDefaultMigrated: true,
        videoSubtitleVisible: true,
        videoSubtitleDisplayMode: 'bilingual',
        useCache: false,
        custom: customUrl,
        model: { ...(previous.model || {}), custom: 'fixture-model' },
        customModel: { ...(previous.customModel || {}), custom: 'fixture-model' },
        token: { ...(previous.token || {}), custom: '' },
        requireApiKey: { ...(previous.requireApiKey || {}), 'custom:fixture-model': false },
      } });
    }, { customUrl: `http://127.0.0.1:${port}/v1/chat/completions`, localModel });

    // 先走真实的“下载模型”消息，不能只伪造 storage 状态；否则新 profile
    // 的 Cache API 里并没有模型，测试会把下载等待误判为播放器没有字幕。
    const prepareStartedAt = Date.now();
    const prepareModelResult = await control.evaluate((model) => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'fluentReadPrepareLocalVideoModel', model }, resolve);
    }), localModel);
    if (!prepareModelResult?.success) {
      throw new Error(`X fixture 本地 Whisper 模型预下载失败：${JSON.stringify(prepareModelResult)}`);
    }
    prepareModelDurationMs = Date.now() - prepareStartedAt;
    console.error(`X fixture 本地 Whisper 模型预下载完成：${prepareModelDurationMs}ms，响应：${JSON.stringify(prepareModelResult)}`);
    // prepare 消息会同时把模型标记为已下载。先清掉“就绪”标记来验证一次
    // 播放器缺模型引导；模型文件仍留在这个隔离 profile 的 Cache API 中，
    // 后面恢复标记即可进入真实离线推理，不会重复走网络下载。
    await control.evaluate(() => chrome.storage.local.set({
      fluentReadVideoLocalTranscriptionModels: [],
    }));

    page = await createPage();
    page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
    page.on('console', (message) => pageConsole.push(`${message.type()}: ${message.text()}`));
    await page.route(X_URL, (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: X_FIXTURE_HTML,
    }), { times: 1 });
    await page.goto(X_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);

    await page.evaluate(async ({ videoDataUrl, mseVideoDataUrl, durationSeconds, scenario, mediaSource }) => {
      const timeline = {
        schemaVersion: 1,
        observerInstalledAtEpochMs: Date.now(),
        observerInstalledAtPerformanceMs: performance.now(),
        events: [],
        diagnostics: [],
      };
      let sequence = 0;
      let captionSignature = '';
      let diagnosticSignature = '';
      let aiStateSignature = '';
      let captureScheduled = false;

      const readSnapshot = () => {
        const video = document.querySelector('video');
        const container = document.querySelector('#fluent-read-video-ai-caption-container');
        const diagnosticRaw = container?.getAttribute('data-fluent-read-video-ai-diagnostic') || '';
        let diagnostic = null;
        if (diagnosticRaw) {
          try {
            diagnostic = JSON.parse(diagnosticRaw);
          } catch {
            diagnostic = { parseError: true, raw: diagnosticRaw };
          }
        }
        return {
          wallTimeMs: Math.round(performance.now() - timeline.observerInstalledAtPerformanceMs),
          epochMs: Date.now(),
          playbackMs: video ? Math.round(video.currentTime * 1000) : null,
          durationMs: video && Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : null,
          paused: video?.paused ?? true,
          ended: video?.ended ?? false,
          source: container?.getAttribute('data-fluent-read-caption-source') || '',
          cueId: container?.getAttribute('data-fluent-read-cue-id') || '',
          original: document.querySelector('#fluent-read-video-subtitle-original')?.textContent?.trim() || '',
          translation: document.querySelector('#fluent-read-video-subtitle')?.textContent?.trim() || '',
          aiState: document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent?.trim() || '',
          aiChecked: document.querySelector('[data-action="toggle-ai-subtitle"]')?.getAttribute('aria-checked') || '',
          diagnostic,
          diagnosticRaw,
        };
      };

      const pushEvent = (kind, reason, snapshot, detail = {}) => {
        timeline.events.push({
          sequence: sequence += 1,
          kind,
          reason,
          ...detail,
          wallTimeMs: snapshot.wallTimeMs,
          epochMs: snapshot.epochMs,
          playbackMs: snapshot.playbackMs,
          durationMs: snapshot.durationMs,
          paused: snapshot.paused,
          ended: snapshot.ended,
          source: snapshot.source,
          cueId: snapshot.cueId,
          original: snapshot.original,
          translation: snapshot.translation,
          aiState: snapshot.aiState,
          aiChecked: snapshot.aiChecked,
        });
      };

      const capture = (reason, force = false) => {
        const snapshot = readSnapshot();
        const nextCaptionSignature = JSON.stringify([
          snapshot.source,
          snapshot.cueId,
          snapshot.original,
          snapshot.translation,
        ]);
        if (force || nextCaptionSignature !== captionSignature) {
          captionSignature = nextCaptionSignature;
          pushEvent('caption', reason, snapshot);
        }

        const nextAiStateSignature = JSON.stringify([snapshot.aiState, snapshot.aiChecked]);
        if (force || nextAiStateSignature !== aiStateSignature) {
          aiStateSignature = nextAiStateSignature;
          pushEvent('ai-state', reason, snapshot);
        }

        if (snapshot.diagnosticRaw && snapshot.diagnosticRaw !== diagnosticSignature) {
          diagnosticSignature = snapshot.diagnosticRaw;
          const diagnosticEvent = {
            sequence: sequence += 1,
            kind: 'diagnostic',
            reason,
            wallTimeMs: snapshot.wallTimeMs,
            epochMs: snapshot.epochMs,
            playbackMs: snapshot.playbackMs,
            value: snapshot.diagnostic,
            raw: snapshot.diagnosticRaw,
          };
          timeline.events.push(diagnosticEvent);
          timeline.diagnostics.push(diagnosticEvent);
        }
      };

      const scheduleCapture = (reason) => {
        if (captureScheduled) return;
        captureScheduled = true;
        queueMicrotask(() => {
          captureScheduled = false;
          capture(reason);
        });
      };

      const observer = new MutationObserver(() => scheduleCapture('mutation'));
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          'data-fluent-read-video-ai-diagnostic',
          'data-fluent-read-caption-source',
          'aria-checked',
          'hidden',
        ],
      });

      timeline.mark = (name, detail = {}) => {
        const snapshot = readSnapshot();
        pushEvent('marker', name, snapshot, { name, detail });
      };
      timeline.attachVideo = (video) => {
        ['play', 'playing', 'pause', 'ended', 'seeking', 'seeked'].forEach((type) => {
          video.addEventListener(type, () => {
            const snapshot = readSnapshot();
            pushEvent('video', type, snapshot, { name: type });
            scheduleCapture(`video:${type}`);
          });
        });
      };
      timeline.collect = () => {
        capture('collect');
        return JSON.parse(JSON.stringify({
          schemaVersion: timeline.schemaVersion,
          observerInstalledAtEpochMs: timeline.observerInstalledAtEpochMs,
          events: timeline.events,
          diagnostics: timeline.diagnostics,
        }));
      };
      window.__fluentReadVideoFixtureTimeline = timeline;
      timeline.mark('observer-installed', { durationSeconds, scenario });

      const player = document.createElement('div');
      player.dataset.testid = 'videoPlayer';
      player.style.cssText = 'display:block;position:fixed;left:24px;top:24px;width:960px;height:540px;z-index:2147483000;background:linear-gradient(135deg,#111827,#020617);overflow:hidden;';

      const label = document.createElement('div');
      label.textContent = `X 视频字幕 fixture（无原生字幕 · ${durationSeconds}s · ${scenario}）`;
      label.style.cssText = 'position:absolute;left:28px;top:24px;color:#94a3b8;font:600 18px/1.4 Arial,sans-serif;';

      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = false;
      video.autoplay = false;
      video.loop = false;
      video.playsInline = true;
      if (mediaSource === 'mse') {
        const mediaSourceObject = new MediaSource();
        const mediaBytes = await (await fetch(mseVideoDataUrl)).arrayBuffer();
        const mseDiagnostic = {
          mediaSourceState: mediaSourceObject.readyState,
          supportedTypes: [],
          sourceOpen: false,
          sourceBufferMode: '',
          buffered: [],
          error: null,
        };
        video.dataset.mseDiagnostic = JSON.stringify(mseDiagnostic);
        mediaSourceObject.addEventListener('sourceopen', () => {
          const mimeCandidates = [
            'video/mp4; codecs="avc1.42C01E,mp4a.40.2"',
            'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',
            'video/mp4',
          ];
          mseDiagnostic.mediaSourceState = mediaSourceObject.readyState;
          mseDiagnostic.sourceOpen = true;
          mseDiagnostic.supportedTypes = mimeCandidates.filter((candidate) => MediaSource.isTypeSupported(candidate));
          try {
            const mimeType = mseDiagnostic.supportedTypes[0];
            if (!mimeType) throw new Error('当前 Edge 不支持 fixture fMP4 MediaSource');
            const sourceBuffer = mediaSourceObject.addSourceBuffer(mimeType);
            mseDiagnostic.sourceBufferMode = sourceBuffer.mode;
            sourceBuffer.addEventListener('updateend', () => {
              mseDiagnostic.mediaSourceState = mediaSourceObject.readyState;
              mseDiagnostic.buffered = Array.from({ length: sourceBuffer.buffered.length }, (_, index) => ({
                start: sourceBuffer.buffered.start(index),
                end: sourceBuffer.buffered.end(index),
              }));
              video.dataset.mseDiagnostic = JSON.stringify(mseDiagnostic);
              if (mediaSourceObject.readyState === 'open') mediaSourceObject.endOfStream();
            }, { once: true });
            sourceBuffer.addEventListener('error', () => {
              mseDiagnostic.error = 'sourcebuffer-error';
              video.dataset.mseDiagnostic = JSON.stringify(mseDiagnostic);
            }, { once: true });
            sourceBuffer.appendBuffer(mediaBytes);
          } catch (error) {
            mseDiagnostic.error = String(error?.message || error);
            video.dataset.mseDiagnostic = JSON.stringify(mseDiagnostic);
            throw error;
          }
        }, { once: true });
        // 先注册 sourceopen，再把 MediaSource 绑定到 video；短数据 URL 在
        // Chromium 中可能同步完成打开，晚注册会永远错过事件。
        video.src = URL.createObjectURL(mediaSourceObject);
      } else {
        video.src = mediaSource === 'blob'
          ? URL.createObjectURL(await (await fetch(videoDataUrl)).blob())
          : videoDataUrl;
        video.load();
      }
      video.style.cssText = 'position:absolute;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';

      // 模拟 X 播放器右下角的原生控制组：FluentRead 应插入设置齿轮左侧，
      // 而不是再创建一个偏大的独立浮层。
      const controls = document.createElement('div');
      controls.style.cssText = 'position:absolute;right:8px;bottom:8px;z-index:2;display:flex;align-items:center;gap:2px;padding:2px;border-radius:6px;background:rgba(0,0,0,.28);';
      const play = document.createElement('button');
      play.type = 'button';
      play.textContent = '▶';
      play.setAttribute('aria-label', 'Play');
      const settings = document.createElement('button');
      settings.type = 'button';
      settings.textContent = '⚙';
      settings.setAttribute('aria-label', 'Settings');
      const fullscreen = document.createElement('button');
      fullscreen.type = 'button';
      fullscreen.textContent = '⛶';
      fullscreen.setAttribute('aria-label', 'Fullscreen');
      [play, settings, fullscreen].forEach((button) => {
        button.style.cssText = 'width:28px;height:28px;padding:0;border:0;color:#fff;background:transparent;font:16px/1 Arial;';
      });
      controls.append(play, settings, fullscreen);
      player.append(label, video, controls);
      document.body.appendChild(player);
      timeline.attachVideo(video);
      timeline.mark('player-created');
    }, { videoDataUrl: fixtureVideoDataUrl, mseVideoDataUrl, durationSeconds, scenario, mediaSource });

    try {
      await page.waitForFunction((expectedMediaSource) => {
        const video = document.querySelector('video');
        return Boolean(video && video.readyState >= (expectedMediaSource === 'mse' ? 1 : 2)
          && Number.isFinite(video.duration) && video.duration > 5);
      }, mediaSource, { timeout: 15000 });
    } catch (error) {
      const mediaDiagnostic = await page.evaluate(() => {
        const video = document.querySelector('video');
        return {
          readyState: video?.readyState ?? -1,
          networkState: video?.networkState ?? -1,
          duration: video?.duration ?? -1,
          error: video?.error ? { code: video.error.code, message: video.error.message } : null,
          buffered: video ? Array.from({ length: video.buffered.length }, (_, index) => ({
            start: video.buffered.start(index),
            end: video.buffered.end(index),
          })) : [],
          mseDiagnostic: video?.dataset.mseDiagnostic || '',
        };
      });
      console.error(JSON.stringify({ mediaDiagnostic }, null, 2));
      throw error;
    }
    await page.evaluate(() => {
      window.__fluentReadVideoFixtureTimeline?.mark('initial-play-start');
      void document.querySelector('video')?.play().catch(() => undefined);
      return true;
    });
    await page.waitForFunction(() => Boolean(document.querySelector('#fluent-read-video-subtitle-button')), null, { timeout: 15000 });
    const buttonState = await page.evaluate(() => ({
      host: document.querySelector('#fluent-read-video-subtitle-button')?.closest('[data-testid="videoPlayer"]')?.getAttribute('data-testid') || '',
      controlClass: document.querySelector('#fluent-read-video-subtitle-button')?.parentElement?.className || '',
      buttonWidth: document.querySelector('#fluent-read-video-subtitle-button')?.getBoundingClientRect().width || 0,
      iconWidth: document.querySelector('#fluent-read-video-subtitle-button-icon')?.getBoundingClientRect().width || document.querySelector('#fluent-read-video-subtitle-button .fluent-read-video-subtitle-button-icon')?.getBoundingClientRect().width || 0,
      iconHeight: document.querySelector('#fluent-read-video-subtitle-button .fluent-read-video-subtitle-button-icon')?.getBoundingClientRect().height || 0,
      settingsWidth: document.querySelector('[data-testid="videoPlayer"] button[aria-label="Settings"]')?.getBoundingClientRect().width || 0,
      buttonBeforeSettings: (() => {
        const button = document.querySelector('#fluent-read-video-subtitle-button');
        const settings = document.querySelector('[data-testid="videoPlayer"] button[aria-label="Settings"]');
        return Boolean(button && settings && button.parentElement === settings.parentElement
          && button.nextElementSibling === settings);
      })(),
      pageUrl: location.href,
    }));
    if (buttonState.host !== 'videoPlayer' || !buttonState.buttonBeforeSettings
      || buttonState.buttonWidth > 28.5 || buttonState.iconWidth > 16.5 || buttonState.iconHeight > 16.5
      || Math.abs(buttonState.buttonWidth - buttonState.settingsWidth) > 6) {
      throw new Error(`X 播放器设置齿轮旁控件校验失败：${JSON.stringify(buttonState)}`);
    }

    await page.locator('#fluent-read-video-subtitle-button').click();
    await page.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle-menu')?.hidden === false, null, { timeout: 10000 });
    const menuState = await page.evaluate(() => {
      const ai = document.querySelector('[data-action="toggle-ai-subtitle"]');
      const player = document.querySelector('[data-testid="videoPlayer"]');
      const menu = document.querySelector('#fluent-read-video-subtitle-menu');
      const menuRect = menu instanceof HTMLElement ? menu.getBoundingClientRect() : { width: 0, height: 0 };
      const originalHeight = player instanceof HTMLElement ? player.style.height : '';
      if (player instanceof HTMLElement) player.style.height = '180px';
      const responsiveHeight = menu instanceof HTMLElement ? menu.getBoundingClientRect().height : 0;
      if (player instanceof HTMLElement) player.style.height = originalHeight;
      return {
        brand: document.querySelector('.fluent-read-video-menu-brand')?.textContent || '',
        aiLabel: ai?.querySelector('.fluent-read-video-menu-label')?.textContent || '',
        aiState: ai?.querySelector('[data-state]')?.textContent || '',
        aiDisabled: ai instanceof HTMLButtonElement ? ai.disabled : true,
        width: menuRect.width,
        height: menuRect.height,
        responsiveHeight,
      };
    });
    if (menuState.brand !== '流畅阅读' || menuState.aiLabel !== '完整生成 AI 字幕' || menuState.aiDisabled || menuState.aiState !== '点击完整生成'
      || menuState.width > 208.5 || menuState.height > 224.5 || menuState.responsiveHeight > 136) {
      throw new Error(`X AI 字幕菜单校验失败：${JSON.stringify(menuState)}`);
    }

    // 首次使用未下载模型时，应给出可执行的设置引导，而不是把底层解码
    // 异常直接展示给用户；随后恢复已下载状态，继续验证真实本地推理链路。
    await control.evaluate(() => chrome.storage.local.remove('fluentReadVideoLocalTranscriptionModels'));
    const settingsPagePromise = context.waitForEvent('page', { timeout: 10000 });
    const menuBeforeNativeFallback = page.locator('#fluent-read-video-subtitle-menu');
    if (await menuBeforeNativeFallback.getAttribute('hidden') !== null) {
      await page.locator('#fluent-read-video-subtitle-button').click({ force: true });
      await page.waitForFunction(
        () => document.querySelector('#fluent-read-video-subtitle-menu')?.hidden === false,
        null,
        { timeout: 10000 },
      );
    }
    await page.locator('[data-action="toggle-ai-subtitle"]').click({ force: true });
    await page.waitForFunction(() => document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent === '请先下载模型', null, { timeout: 10000 });
    const settingsPage = await settingsPagePromise;
    await settingsPage.close();
    await page.screenshot({ path: screenshotPaths.modelPrompt, fullPage: true });
    capturedScreenshots.add('modelPrompt');
    const modelPromptState = await page.locator('[data-action="toggle-ai-subtitle"] [data-state]').textContent();
    await control.evaluate((model) => chrome.storage.local.set({ fluentReadVideoLocalTranscriptionModels: [model] }), localModel);
    await control.close();
    if (focusSafeHelper) {
      await focusSafeHelper.activateExtensionTabWithoutForeground(context, page);
    } else {
      await page.bringToFront();
    }
    await page.waitForFunction(() => document.visibilityState === 'visible', null, { timeout: 10000 });

    await page.evaluate(() => {
      const video = document.querySelector('video');
      if (!video) throw new Error('找不到 X fixture 视频');
      video.pause();
      video.currentTime = 0;
      window.__fluentReadVideoFixtureTimeline?.mark('ai-run-reset');
      void video.play().catch(() => undefined);
    });
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return Boolean(video && !video.paused && !video.ended && video.currentTime < 1.5);
    }, null, { timeout: 10000 });
    await page.evaluate(({ model, maxFirstCaptionMs, generationMode }) => {
      window.__fluentReadVideoFixtureTimeline?.mark('ai-request-start', { model, maxFirstCaptionMs, generationMode });
    }, { model: localModel, maxFirstCaptionMs, generationMode });
    await page.locator('[data-action="toggle-ai-subtitle"]').click({ force: true });
    await page.evaluate(() => window.__fluentReadVideoFixtureTimeline?.mark('ai-request-clicked'));

    // 完整模式的关键验收：识别和翻译期间播放器必须停在 0 秒，只有状态
    // 进入“已就绪”后才允许恢复播放。
    if (generationMode === 'full') {
      await page.waitForFunction(() => {
        const state = document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent || '';
        return state === '扫描视频中' || state === '快速读取音频中'
          || state.startsWith('识别字幕') || state.startsWith('翻译字幕');
      }, null, { timeout: 15000 });
      const preprocessingState = await page.evaluate(() => ({
        currentTime: document.querySelector('video')?.currentTime || 0,
        paused: document.querySelector('video')?.paused ?? true,
        original: document.querySelector('#fluent-read-video-subtitle-original')?.textContent?.trim() || '',
        aiState: document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent || '',
      }));
      if (preprocessingState.original || preprocessingState.aiState === '已就绪，播放中') {
        throw new Error(`完整生成期间不应提前显示/播放：${JSON.stringify(preprocessingState)}`);
      }
      await page.waitForTimeout(1000);
      const preprocessingAfterWait = await page.evaluate(() => ({
        currentTime: document.querySelector('video')?.currentTime || 0,
        paused: document.querySelector('video')?.paused ?? true,
        aiState: document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent || '',
      }));
      if (preprocessingAfterWait.aiState.startsWith('识别字幕') || preprocessingAfterWait.aiState.startsWith('翻译字幕')) {
        if (!preprocessingAfterWait.paused || preprocessingAfterWait.currentTime > 0.15) {
          throw new Error(`完整生成阶段播放器没有冻结：${JSON.stringify({ preprocessingState, preprocessingAfterWait })}`);
        }
      }
      try {
        await page.waitForFunction(() => {
          const video = document.querySelector('video');
          return document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent === '已就绪，播放中'
            && video?.paused === false;
        }, null, { timeout: fullGenerationWaitMs });
      } catch (error) {
        const localAiDiagnostic = await page.evaluate(() => ({
          video: (() => {
            const video = document.querySelector('video');
            const capture = video && (video.captureStream || video.mozCaptureStream);
            const ranges = (range) => {
              if (!range) return [];
              return Array.from({ length: range.length }, (_, index) => ({
                start: Number(range.start(index).toFixed(3)),
                end: Number(range.end(index).toFixed(3)),
              }));
            };
            return {
              currentTime: video?.currentTime ?? -1,
              duration: video?.duration ?? -1,
              paused: video?.paused ?? true,
              readyState: video?.readyState ?? -1,
              networkState: video?.networkState ?? -1,
              error: video?.error ? {
                code: video.error.code,
                message: video.error.message,
              } : null,
              buffered: ranges(video?.buffered),
              seekable: ranges(video?.seekable),
              played: ranges(video?.played),
              videoWidth: video?.videoWidth ?? 0,
              videoHeight: video?.videoHeight ?? 0,
              src: video?.currentSrc || video?.src || '',
              audioTracks: capture ? capture.call(video).getAudioTracks().length : -1,
            };
          })(),
          buttonState: document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent || '',
          source: document.querySelector('#fluent-read-video-ai-caption-container')?.getAttribute('data-fluent-read-caption-source') || '',
          original: document.querySelector('#fluent-read-video-subtitle-original')?.textContent?.trim() || '',
          translation: document.querySelector('#fluent-read-video-subtitle')?.textContent?.trim() || '',
        }));
        console.error(JSON.stringify({ localAiDiagnostic, pageErrors, pageConsole: pageConsole.slice(-120), workerConsole: workerConsole.slice(-120) }, null, 2));
        throw error;
      }
    } else {
      await page.waitForFunction(() => {
        const container = document.querySelector('#fluent-read-video-ai-caption-container');
        const state = document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent || '';
        if (/失败|超时|超过|解码|错误|不支持/.test(state)) throw new Error(`X fixture AI 字幕状态异常：${state}`);
        return container?.getAttribute('data-fluent-read-caption-source') === 'ai'
          && Boolean(document.querySelector('#fluent-read-video-subtitle-original')?.textContent?.trim());
      }, null, { timeout: firstCaptionWaitMs });
    }

    await page.waitForFunction(() => {
      const container = document.querySelector('#fluent-read-video-ai-caption-container');
      return container?.getAttribute('data-fluent-read-caption-source') === 'ai'
        && Boolean(document.querySelector('#fluent-read-video-subtitle-original')?.textContent?.trim());
    }, null, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle')?.textContent?.trim() === 'X 视频 AI 字幕。', null, { timeout: 60000 });
    const firstCaptionTimeline = await page.evaluate(() => window.__fluentReadVideoFixtureTimeline?.collect());
    const firstCaptionMetrics = summarizeTimeline(firstCaptionTimeline);
    if (firstCaptionMetrics.firstCaptionPlaybackMs === null
      || firstCaptionMetrics.firstCaptionPlaybackMs > Math.max(4_000, speechPlan.estimatedFirstSpeechEndMs + 1_200)
      || !firstCaptionMetrics.firstCaptionWhilePlaying) {
      throw new Error(`X fixture 完整生成后的首条字幕未与播放头对齐：${JSON.stringify({ firstCaptionMetrics })}`);
    }
    const liveAiResult = await page.evaluate(() => ({
      currentTime: document.querySelector('video')?.currentTime || 0,
      videoCount: document.querySelectorAll('video').length,
      original: document.querySelector('#fluent-read-video-subtitle-original')?.textContent?.trim() || '',
      translation: document.querySelector('#fluent-read-video-subtitle')?.textContent?.trim() || '',
      source: document.querySelector('#fluent-read-video-ai-caption-container')?.getAttribute('data-fluent-read-caption-source') || '',
      aiState: document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent || '',
    }));
    liveAiResult.firstCaptionMetrics = firstCaptionMetrics;
    if (liveAiResult.videoCount !== 1) {
      throw new Error(`X fixture 完整生成后残留隐藏扫描 video：${JSON.stringify(liveAiResult)}`);
    }
    if (!liveAiResult.original || liveAiResult.source !== 'ai' || liveAiResult.translation !== 'X 视频 AI 字幕。') {
      throw new Error(`X fixture 完整 AI 字幕或译文不可见：${JSON.stringify(liveAiResult)}`);
    }
    const liveCaptionGeometry = await page.evaluate(() => {
      const panel = document.querySelector('#fluent-read-video-subtitle-panel');
      const menu = document.querySelector('#fluent-read-video-subtitle-menu');
      const panelRect = panel?.getBoundingClientRect();
      const menuRect = menu?.getBoundingClientRect();
      return panelRect && menuRect ? {
        panelLeft: panelRect.left,
        panelRight: panelRect.right,
        panelTop: panelRect.top,
        panelBottom: panelRect.bottom,
        menuLeft: menuRect.left,
        menuRight: menuRect.right,
        menuTop: menuRect.top,
        menuBottom: menuRect.bottom,
        menuHidden: menu?.hasAttribute('hidden') || false,
      } : null;
    });
    if (liveCaptionGeometry && !liveCaptionGeometry.menuHidden) {
      const horizontallySeparated = liveCaptionGeometry.panelRight <= liveCaptionGeometry.menuLeft - 6;
      const verticallySeparated = liveCaptionGeometry.panelBottom <= liveCaptionGeometry.menuTop - 6
        || liveCaptionGeometry.panelTop >= liveCaptionGeometry.menuBottom + 6;
      if (!horizontallySeparated && !verticallySeparated) {
        throw new Error(`X fixture 字幕被播放器菜单遮挡：${JSON.stringify(liveCaptionGeometry)}`);
      }
    }
    await page.screenshot({ path: screenshotPaths.firstCaption, fullPage: true });
    capturedScreenshots.add('firstCaption');
    await page.evaluate(() => {
      window.postMessage({
        source: 'fluent-read',
        type: 'fluent-read-x-video-subtitle-resource',
        url: 'https://video.twimg.com/subtitles/fluentread-active-ai-fixture.vtt',
        responseText: 'WEBVTT\n\n00:00:00.000 --> 00:00:30.000\nSIDECAR MUST NOT REPLACE ACTIVE AI',
        pageHref: window.location.href,
      }, window.location.origin);
      document.querySelector('video')?.dispatchEvent(new Event('timeupdate'));
    });
    await page.waitForTimeout(500);
    const activeAiSidecarState = await page.evaluate(() => ({
      source: document.querySelector('#fluent-read-video-ai-caption-container')?.getAttribute('data-fluent-read-caption-source') || '',
      original: document.querySelector('#fluent-read-video-subtitle-original')?.textContent?.trim() || '',
      aiState: document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent || '',
    }));
    if (activeAiSidecarState.source !== 'ai'
      || activeAiSidecarState.original.includes('SIDECAR')
      || activeAiSidecarState.aiState !== '已就绪，播放中') {
      throw new Error(`AI active 时 sidecar 抢占字幕：${JSON.stringify(activeAiSidecarState)}`);
    }
    await page.locator('[data-mode="original-only"]').click({ force: true });
    await page.waitForFunction(() => {
      const mode = document.querySelector('[data-mode="original-only"]');
      const original = document.querySelector('#fluent-read-video-subtitle-original');
      const translation = document.querySelector('#fluent-read-video-subtitle');
      const state = document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent || '';
      return mode?.getAttribute('aria-checked') === 'true'
        && Boolean(original?.textContent?.trim())
        && getComputedStyle(original).visibility !== 'hidden'
        && getComputedStyle(translation).visibility === 'hidden'
        && state === '已就绪，播放中';
    }, null, { timeout: 10000 });
    const originalOnlyState = await page.evaluate(() => ({
      original: document.querySelector('#fluent-read-video-subtitle-original')?.textContent?.trim() || '',
      originalVisibility: getComputedStyle(document.querySelector('#fluent-read-video-subtitle-original')).visibility,
      translationVisibility: getComputedStyle(document.querySelector('#fluent-read-video-subtitle')).visibility,
      aiState: document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent || '',
    }));
    await page.locator('[data-mode="bilingual"]').click({ force: true });
    await page.waitForFunction(() => {
      const translation = document.querySelector('#fluent-read-video-subtitle');
      return document.querySelector('[data-mode="bilingual"]')?.getAttribute('aria-checked') === 'true'
        && translation?.textContent?.trim() === 'X 视频 AI 字幕。'
        && getComputedStyle(translation).visibility !== 'hidden';
    }, null, { timeout: 10000 });
    await page.evaluate(() => {
      const video = document.querySelector('video');
      if (!video) return;
      video.pause();
      video.dispatchEvent(new Event('timeupdate'));
    });
    await page.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle')?.textContent?.trim() === 'X 视频 AI 字幕。', null, { timeout: 60000 });
    const localAiResult = await page.evaluate(() => ({
      original: document.querySelector('#fluent-read-video-subtitle-original')?.textContent?.trim() || '',
      translation: document.querySelector('#fluent-read-video-subtitle')?.textContent?.trim() || '',
      model: document.querySelector('[data-local-model-label]')?.textContent?.trim() || '',
    }));
    if (!localAiResult.original || localAiResult.translation !== 'X 视频 AI 字幕。') {
      throw new Error(`扩展内本地 AI 字幕校验失败：${JSON.stringify(localAiResult)}`);
    }

    const pausedAiState = await page.evaluate(() => {
      const video = document.querySelector('video');
      if (!video) throw new Error('找不到 X fixture 视频');
      video.pause();
      video.dispatchEvent(new Event('timeupdate'));
      return {
        currentTime: video.currentTime,
        aiState: document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent || '',
        aiChecked: document.querySelector('[data-action="toggle-ai-subtitle"]')?.getAttribute('aria-checked') || '',
      };
    });
    await page.waitForTimeout(3200);
    const pausedAiAfterWait = await page.evaluate(() => ({
      currentTime: document.querySelector('video')?.currentTime || 0,
      aiState: document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent || '',
      aiChecked: document.querySelector('[data-action="toggle-ai-subtitle"]')?.getAttribute('aria-checked') || '',
    }));
    if (Math.abs(pausedAiAfterWait.currentTime - pausedAiState.currentTime) > 0.08
      || pausedAiState.aiState !== '已就绪，播放中'
      || pausedAiAfterWait.aiState !== '已就绪，播放中'
      || pausedAiAfterWait.aiChecked !== 'true') {
      throw new Error(`暂停期间 AI 字幕时间轴未冻结：${JSON.stringify({ pausedAiState, pausedAiAfterWait })}`);
    }
    await page.evaluate(() => {
      window.__fluentReadVideoFixtureTimeline?.mark('ai-run-resume');
      return document.querySelector('video')?.play().catch(() => undefined);
    });
    await page.waitForFunction(() => document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent === '已就绪，播放中', null, { timeout: 10000 });

    await page.waitForFunction((expectedDurationSeconds) => {
      const video = document.querySelector('video');
      return Boolean(video && (video.ended || video.currentTime >= expectedDurationSeconds - 0.2));
    }, durationSeconds, { timeout: durationSeconds * 1000 + 20000 });
    if (tailSettleMs > 0) await page.waitForTimeout(tailSettleMs);
    await page.evaluate(() => window.__fluentReadVideoFixtureTimeline?.mark('ai-run-finished'));
    await page.screenshot({ path: screenshotPaths.aiFinal, fullPage: true });
    capturedScreenshots.add('aiFinal');
    const aiTimeline = await page.evaluate(() => window.__fluentReadVideoFixtureTimeline?.collect());
    const aiMetrics = summarizeTimeline(aiTimeline);
    fixtureTimeline = aiTimeline;
    fixtureMetrics = aiMetrics;
    if (aiMetrics.nonEmptyCaptionEvents < minCaptionEvents) {
      throw new Error(`X fixture 非空 AI 字幕事件不足：${JSON.stringify({ minCaptionEvents, aiMetrics })}`);
    }
    if (aiMetrics.firstCaptionPlaybackMs === null
      || aiMetrics.firstCaptionPlaybackMs > Math.max(4_000, speechPlan.estimatedFirstSpeechEndMs + 1_200)) {
      throw new Error(`X fixture AI 字幕最终时间轴校验失败：${JSON.stringify({ aiMetrics })}`);
    }
    const stableOriginals = aiMetrics.stableOriginals || aiMetrics.distinctOriginals;
    const repeatedInsideCue = stableOriginals.find((text) => containsRepeatedTokenRun(text));
    const repeatedAcrossCues = stableOriginals.slice(1).find((text, index) =>
      longestBoundaryOverlap(stableOriginals[index], text) >= 3);
    const repeatedLeadingBoundary = stableOriginals.slice(1).find((text, index) =>
      hasRepeatedLeadingBoundarySentence(stableOriginals[index], text));
    if (repeatedInsideCue || repeatedAcrossCues || repeatedLeadingBoundary) {
      throw new Error(`X fixture AI 字幕存在滚动窗口重复：${JSON.stringify({
        repeatedInsideCue,
        repeatedAcrossCues,
        repeatedLeadingBoundary,
        stableOriginals,
        distinctOriginals: aiMetrics.distinctOriginals,
      })}`);
    }
    if (generationMode === 'full') {
      const alignmentChecks = estimateSpeechStarts(speechPlan).map(({ text, startMs }) => ({
        text,
        expectedStartMs: Math.round(startMs),
        actualStartMs: findCaptionPlaybackStart(aiTimeline, text),
      }));
      const alignmentFailures = alignmentChecks.filter(({ actualStartMs, expectedStartMs }) =>
        actualStartMs === null || Math.abs(actualStartMs - expectedStartMs) > 1_800);
      if (alignmentFailures.length > 0) {
        throw new Error(`X fixture 声音与字幕时间轴未对齐：${JSON.stringify({ alignmentChecks, alignmentFailures })}`);
      }
    }

    const menuBeforeNativeTrack = page.locator('#fluent-read-video-subtitle-menu');
    if (await menuBeforeNativeTrack.getAttribute('hidden') !== null) {
      await page.locator('#fluent-read-video-subtitle-button').click({ force: true });
      await page.waitForFunction(
        () => document.querySelector('#fluent-read-video-subtitle-menu')?.hidden === false,
        null,
        { timeout: 10000 },
      );
    }
    await page.locator('[data-action="toggle-ai-subtitle"]').click({ force: true });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const video = document.querySelector('video');
      if (!video) throw new Error('找不到 X fixture 视频');
      const track = document.createElement('track');
      track.kind = 'captions';
      track.label = 'English';
      track.srclang = 'en';
      track.src = URL.createObjectURL(new Blob(['WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nHello from the X video.'], { type: 'text/vtt' }));
      track.default = true;
      video.appendChild(track);
      video.currentTime = 1;
      video.dispatchEvent(new Event('timeupdate'));
    });
    try {
      await page.waitForFunction(() => {
        const track = document.querySelector('video')?.textTracks[0];
        return Boolean(track?.cues && track.cues.length > 0);
      }, null, { timeout: 10000 });
    } catch (error) {
      const trackDiagnostic = await page.evaluate(() => {
        const video = document.querySelector('video');
        const track = video?.textTracks[0];
        return {
          elementTracks: video?.querySelectorAll('track').length || 0,
          textTracks: video?.textTracks.length || 0,
          mode: track?.mode || '',
          readyState: track?.readyState ?? -1,
          cues: track?.cues?.length || 0,
          src: video?.querySelector('track')?.src || '',
        };
      });
      console.error(JSON.stringify({ trackDiagnostic, pageErrors }, null, 2));
      throw error;
    }
    await page.waitForFunction(() => {
      const container = document.querySelector('#fluent-read-video-ai-caption-container');
      return container?.getAttribute('data-fluent-read-caption-source') === 'native'
        && document.querySelector('#fluent-read-video-subtitle-original')?.textContent?.trim() === 'Hello from the X video.';
    }, null, { timeout: 30000 });
    await page.waitForFunction(() => {
      const container = document.querySelector('#fluent-read-video-ai-caption-container');
      return container?.getAttribute('data-fluent-read-caption-source') === 'native'
        && document.querySelector('#fluent-read-video-subtitle')?.textContent?.trim() === 'X 视频 AI 字幕。';
    }, null, { timeout: 30000 });

    const result = await page.evaluate(() => ({
      localAiResult: null,
      liveAiResult: null,
      aiMetrics: null,
      modelPromptState: '',
      pausedAiState: null,
      pausedAiAfterWait: null,
      originalOnlyState: null,
      activeAiSidecarState: null,
      localAiSource: document.querySelector('#fluent-read-video-ai-caption-container')?.getAttribute('data-fluent-read-caption-source') || '',
      original: document.querySelector('#fluent-read-video-subtitle-original')?.textContent?.trim() || '',
      translation: document.querySelector('#fluent-read-video-subtitle')?.textContent?.trim() || '',
      syntheticSource: document.querySelector('#fluent-read-video-ai-caption-container')?.getAttribute('data-fluent-read-caption-source') || '',
      menuState: document.querySelector('[data-action="toggle-ai-subtitle"] [data-state]')?.textContent || '',
    }));
    result.localAiResult = localAiResult;
    result.liveAiResult = liveAiResult;
    result.aiMetrics = aiMetrics;
    result.modelPromptState = modelPromptState;
    result.pausedAiState = pausedAiState;
    result.pausedAiAfterWait = pausedAiAfterWait;
    result.originalOnlyState = originalOnlyState;
    result.activeAiSidecarState = activeAiSidecarState;
    await page.screenshot({ path: screenshotPaths.final, fullPage: true });
    capturedScreenshots.add('final');
    if (pageErrors.length > 0) throw new Error(`X fixture 页面异常：${JSON.stringify(pageErrors)}`);
    if (requestLog.some((entry) => entry.url?.endsWith('/audio/transcriptions'))
      || requestLog.filter((entry) => entry.url?.endsWith('/chat/completions')).length < 1) {
      throw new Error(`本地 AI 字幕不应请求云端转写：${JSON.stringify(requestLog)}`);
    }
    // offscreen 空闲关闭包含活动快照，Blob URL 还可能让 Chromium 延迟回收
    // renderer。等待“稳定低于阈值”或 8 秒硬上限，避免把刚 terminate Worker
    // 的瞬时 RSS 当成泄漏，同时仍会对真正不下降的进程失败。
    let resourceSummary = summarizeResourceSamples(resourceSamples);
    const maxSettledExtensionRssMb = Math.max(
      resourceLimits.settledRssFallbackMb,
      resourceSummary.initialExtensionRssMb + resourceLimits.settledBaselineHeadroomMb,
    );
    if (resourceSampleMs > 0) {
      const resourceSettleDeadline = Date.now() + 8_000;
      while (Date.now() < resourceSettleDeadline) {
        const settledWithinLimit = resourceSummary.sampleCount >= 3
          && resourceSummary.settledExtensionCpuPercent <= 20
          && resourceSummary.settledExtensionRssMb <= maxSettledExtensionRssMb
          && resourceSummary.settledToPeakExtensionRssRatio <= resourceLimits.settledToPeakRatio;
        if (settledWithinLimit || resourceSummary.peakExtensionRssMb < 400) break;
        await page.waitForTimeout(Math.max(500, resourceSampleMs));
        resourceSummary = summarizeResourceSamples(resourceSamples);
      }
    }
    if (resourceSummary.sampleCount >= 3
      && resourceSummary.peakExtensionRssMb >= 400
      && (resourceSummary.settledExtensionCpuPercent > 20
        || resourceSummary.settledExtensionRssMb > maxSettledExtensionRssMb
        || resourceSummary.settledToPeakExtensionRssRatio > resourceLimits.settledToPeakRatio)) {
      throw new Error(`X fixture 停止后扩展资源没有释放：${JSON.stringify({
        ...resourceSummary,
        maxSettledExtensionRssMb,
      })}`);
    }
    fixtureResult = result;
    fixtureTimeline = await page.evaluate(() => window.__fluentReadVideoFixtureTimeline?.collect());
    fixtureMetrics = summarizeTimeline(fixtureTimeline);
    persistEventsArtifact('passed');
    console.log(JSON.stringify({
      model: localModel,
      durationSeconds,
      scenario,
      thresholds,
      metrics: fixtureMetrics,
      resources: resourceSummary,
      result,
      requestLog,
      pageErrors,
      artifactsDir,
      eventsArtifactPath,
      screenshots: screenshotPaths,
    }, null, 2));
  } catch (error) {
    if (page && !page.isClosed()) {
      try {
        await page.evaluate((message) => window.__fluentReadVideoFixtureTimeline?.mark('fixture-failed', { message }), String(error));
        fixtureTimeline = await page.evaluate(() => window.__fluentReadVideoFixtureTimeline?.collect()) || fixtureTimeline;
        fixtureMetrics = summarizeTimeline(fixtureTimeline);
        await page.screenshot({ path: screenshotPaths.failure, fullPage: true });
        capturedScreenshots.add('failure');
      } catch (evidenceError) {
        pageErrors.push(`保存失败证据时异常：${String(evidenceError.stack || evidenceError)}`);
      }
    }
    persistEventsArtifact('failed', error);
    throw error;
  } finally {
    if (resourceSampleTimer) clearInterval(resourceSampleTimer);
    if (launchedBrowser.close) await launchedBrowser.close();
    else await context.close();
    await new Promise((resolve) => server.close(resolve));
    if (cleanupProfile) fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
