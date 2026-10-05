#!/usr/bin/env node
/**
 * @file fixture-server.mjs
 * Loopback-only synthetic fixture server for the Linux-native BrowserOS Neo acceptance run.
 *
 * Usage: node fixture-server.mjs [PORT]     (default port 57280)
 *
 * Contract (all values are synthetic; nothing here is copied from another machine):
 *   - binds 127.0.0.1 only and rejects any Host header other than 127.0.0.1:<port>;
 *   - GET /            synthetic article page (data-fixture paragraph, single-image canvas,
 *                      manga canvas, readonly textarea);
 *   - GET /image.png   deterministic real PNG bytes (single image);
 *   - GET /manga.png   deterministic real PNG bytes (manga page);
 *   - POST /v1/chat/completions          OpenAI-compatible non-streaming JSON for the models
 *                                        fixture-normal and fixture-private only;
 *   - POST /slow/v1/chat/completions     same, delayed by 2200 ms;
 *   - POST /fail/v1/chat/completions     HTTP 503;
 *   - GET  /metrics    {"synthetic":true,"requests":[{sequence,model,mode,endpoint}]};
 *   - stream:true      -> HTTP 400;
 *   - Authorization   -> when the header is present it must be exactly
 *                        "Bearer fixture-not-secret", otherwise HTTP 401;
 *   - request bodies are never logged (only model/stream/endpoint metadata is retained);
 *   - prints one JSON line with the bound URL on startup and exits on SIGTERM/SIGINT.
 */
import http from 'node:http';
import zlib from 'node:zlib';

const PORT = (() => {
  const raw = process.argv[2];
  if (raw === undefined || raw === '') return 57280;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`invalid port argument: ${raw}`);
  }
  return value;
})();
const HOST = '127.0.0.1';
const FIXTURE_TOKEN = 'fixture-not-secret';
const FIXED_MODELS = new Set(['fixture-normal', 'fixture-private']);
const BODY_LIMIT_BYTES = 1024 * 1024;
const SLOW_DELAY_MS = 2200;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------- real PNG bytes
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
const crc32 = buffer => {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
};
const pngChunk = (type, data) => {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 'ascii');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return chunk;
};
/** Deterministic 8-bit RGBA PNG encoder (no external dependencies). */
const makePng = (width, height, pixelAt) => {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      raw[offset++] = r; raw[offset++] = g; raw[offset++] = b; raw[offset++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, {level: 9})),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};

const IMAGE_PNG = makePng(320, 180, (x, y) => {
  if ((x - 250) ** 2 + (y - 42) ** 2 <= 20 ** 2) return [250, 208, 64, 255];
  if (y < 96) return [58 + Math.floor(y / 4), 132 + Math.floor(y / 3), 226 - Math.floor(y / 5), 255];
  const ridge = 96 + Math.round(14 * Math.sin(x / 37)) + Math.round(6 * Math.sin(x / 11));
  if (y < ridge) return [122, 122, 130, 255];
  return [58 + (x % 7), 132 + (y % 9), 74 + (x % 5), 255];
});

const MANGA_PNG = makePng(256, 256, (x, y) => {
  if (x < 6 || y < 6 || x > 249 || y > 249) return [24, 24, 24, 255];
  const panelA = x >= 14 && x <= 241 && y >= 14 && y <= 118;
  const panelB = x >= 14 && x <= 241 && y >= 138 && y <= 241;
  if (panelA && (x + y) % 18 < 2) return [46, 46, 46, 255];
  if (panelB && (x - y + 512) % 22 < 3) return [70, 70, 70, 255];
  const bubble = (x - 182) ** 2 + (y - 62) ** 2;
  if (bubble <= 34 ** 2) {
    if (bubble >= 29 ** 2) return [24, 24, 24, 255];
    if (y > 58 && y < 62 && x > 168 && x < 196) return [24, 24, 24, 255];
    return [248, 248, 248, 255];
  }
  if (panelA || panelB) return [248, 248, 248, 255];
  return [200, 200, 200, 255];
});

// ---------------------------------------------------------------- article page
const articleHtml = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Synthetic fixture article</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 24px; color: #1b1b1b; }
  [data-fixture="article-paragraph"] { max-width: 640px; }
  canvas { border: 1px solid #999; display: block; margin: 12px 0; background: #fff; }
  textarea { display: block; margin: 12px 0; width: 480px; max-width: 100%; }
</style>
</head>
<body data-fixture="article-body">
<h1 data-fixture="article-title">Synthetic fixture article</h1>
<p data-fixture="article-paragraph">This paragraph is synthetic fixture content for the local BrowserOS Neo Linux-native acceptance run. It contains no user data, no credentials and no phrasing copied from any real document.</p>
<canvas id="single-image-canvas" data-fixture="single-image-canvas" width="320" height="180" aria-label="single image fixture"></canvas>
<canvas id="manga-canvas" data-fixture="manga-canvas" width="256" height="256" aria-label="manga fixture"></canvas>
<textarea data-fixture="readonly-textarea" readonly rows="4" aria-label="readonly fixture textarea">Readonly fixture textarea for synthetic acceptance checks.</textarea>
<script>
const SINGLE_IMAGE_DATA_URL = 'data:image/png;base64,${IMAGE_PNG.toString('base64')}';
(async () => {
  const draw = async (canvasId, source) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.getElementById(canvasId);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.dataset.pngDataUrl = canvas.toDataURL('image/png');
  };
  await draw('single-image-canvas', SINGLE_IMAGE_DATA_URL);
  await draw('manga-canvas', '/manga.png');
  window.__fixtureReady = true;
  document.body.dataset.fixtureReady = 'true';
})().catch(error => { window.__fixtureError = String(error); });
</script>
</body>
</html>`;

// ---------------------------------------------------------------- request bookkeeping
const requests = [];
let sequence = 0;

const recordRequest = (endpoint, parsedBody) => {
  const model = parsedBody && typeof parsedBody === 'object' && typeof parsedBody.model === 'string'
    ? parsedBody.model
    : null;
  const mode = parsedBody && typeof parsedBody === 'object' && parsedBody.stream === true
    ? 'streaming'
    : 'non-streaming';
  const entry = {sequence: ++sequence, model, mode, endpoint};
  requests.push(entry);
  return entry;
};

const errorPayload = (message, type = 'fixture_error') => ({error: {message, type, code: null}});

/** Single deterministic OpenAI-compatible non-streaming response. */
const completionPayload = (entry, model) => ({
  id: `chatcmpl-fixture-${entry.sequence}`,
  object: 'chat.completion',
  created: 0,
  model,
  choices: [{
    index: 0,
    message: {role: 'assistant', content: `synthetic fixture completion for ${model}`},
    finish_reason: 'stop',
  }],
  usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2},
});

// ---------------------------------------------------------------- HTTP helpers
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
};

const sendJson = (res, status, payload) => {
  const bytes = Buffer.from(`${JSON.stringify(payload)}\n`);
  res.writeHead(status, {
    ...CORS_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': bytes.length,
    'cache-control': 'no-store',
  });
  res.end(bytes);
};

const sendPng = (res, bytes) => {
  res.writeHead(200, {
    ...CORS_HEADERS,
    'content-type': 'image/png',
    'content-length': bytes.length,
    'cache-control': 'no-store',
  });
  res.end(bytes);
};

const sendHtml = (res, html) => {
  const bytes = Buffer.from(html);
  res.writeHead(200, {
    ...CORS_HEADERS,
    'content-type': 'text/html; charset=utf-8',
    'content-length': bytes.length,
    'cache-control': 'no-store',
  });
  res.end(bytes);
};

const readBody = req => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > BODY_LIMIT_BYTES) {
      reject(Object.assign(new Error('request body exceeds fixture limit'), {statusCode: 413}));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

const authorized = req => {
  const header = req.headers.authorization;
  if (header === undefined) return true; // the header is optional; only a wrong value is rejected
  return header === `Bearer ${FIXTURE_TOKEN}`;
};

// ---------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  try {
    if ((req.headers.host ?? '') !== `${HOST}:${PORT}`) {
      res.writeHead(403, {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'});
      res.end('forbidden host\n');
      return;
    }
    const pathname = new URL(req.url ?? '/', `http://${HOST}:${PORT}`).pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {...CORS_HEADERS, 'content-length': 0});
      res.end();
      return;
    }
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      sendHtml(res, articleHtml());
      return;
    }
    if (req.method === 'GET' && pathname === '/image.png') {
      sendPng(res, IMAGE_PNG);
      return;
    }
    if (req.method === 'GET' && pathname === '/manga.png') {
      sendPng(res, MANGA_PNG);
      return;
    }
    if (req.method === 'GET' && pathname === '/metrics') {
      sendJson(res, 200, {synthetic: true, requests: requests.slice()});
      return;
    }

    const chatEndpoints = new Set([
      '/v1/chat/completions',
      '/slow/v1/chat/completions',
      '/fail/v1/chat/completions',
    ]);
    if (chatEndpoints.has(pathname)) {
      if (req.method !== 'POST') {
        sendJson(res, 405, errorPayload(`method ${req.method} is not supported on ${pathname}`));
        return;
      }
      const body = await readBody(req);
      let parsed = null;
      let parseFailed = false;
      try {
        parsed = body.length > 0 ? JSON.parse(body.toString('utf8')) : null;
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) parseFailed = true;
      } catch {
        parseFailed = true;
      }
      // Record metadata only; the body itself is never persisted or logged.
      const entry = recordRequest(pathname, parseFailed ? null : parsed);
      if (!authorized(req)) {
        sendJson(res, 401, errorPayload('authorization header must be "Bearer fixture-not-secret"'));
        return;
      }
      if (pathname === '/fail/v1/chat/completions') {
        sendJson(res, 503, errorPayload('synthetic failure endpoint'));
        return;
      }
      if (pathname === '/slow/v1/chat/completions') await sleep(SLOW_DELAY_MS);
      if (parseFailed) {
        sendJson(res, 400, errorPayload('request body must be a JSON object'));
        return;
      }
      if (parsed.stream === true) {
        sendJson(res, 400, errorPayload('stream=true is not supported by this fixture'));
        return;
      }
      const model = typeof parsed.model === 'string' ? parsed.model : null;
      if (!model || !FIXED_MODELS.has(model)) {
        sendJson(res, 404, errorPayload(`unknown fixture model: ${model ?? 'null'}`));
        return;
      }
      sendJson(res, 200, completionPayload(entry, model));
      return;
    }

    sendJson(res, 404, errorPayload(`no fixture route for ${pathname}`));
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, error?.statusCode ?? 500, errorPayload('synthetic fixture server error'));
    } else {
      res.destroy();
    }
  }
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

server.on('error', error => {
  console.error(`fixture-server failed to listen on ${HOST}:${PORT}: ${error.message}`);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({url: `http://${HOST}:${PORT}`, host: HOST, port: PORT}));
});
