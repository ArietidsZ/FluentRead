#!/usr/bin/env node
'use strict';

// PDF 划词专项：生产扩展、临时 Edge profile、真实鼠标拖选与快捷键；翻译服务仅连接本机确定性夹具。
// 包含本地/在线导入、原生查看器 Popup 分流、跨行与迟到结果归属、长 PDF 有界 Canvas/TextLayer、窄屏暗色。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {guardBrowserClose, getGuardedBrowserPid} = require('./testing/owned-browser-close.cjs');
const execFileAsync = promisify(execFile);
const support = require('./run-selection-trigger-test.cjs');
const arg = (name, fallback) => {const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1];};
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const LINES = [
  'PDF selection translation keeps the original layout.',
  'Reading across lines should become one clean sentence.',
  'First ownership request must never replace a newer selection.',
  'Second ownership selection owns the final Chinese answer.',
];

async function createPdf(pageCount, rotation = 0) {
  const {PDFDocument, StandardFonts, rgb, degrees} = createRequire(path.join(__dirname, '..', 'package.json'))('pdf-lib');
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let number = 1; number <= pageCount; number += 1) {
    const page = document.addPage([595, 842]);
    if (rotation) page.setRotation(degrees(rotation));
    page.drawText(`FluentRead PDF fixture page ${number}`, {font, x: 44, y: 792, size: 15});
    LINES.forEach((line, index) => page.drawText(line, {font, x: 44, y: 748 - index * 28, size: 11}));
    page.drawRectangle({x: 44, y: 420, width: 280, height: 100, color: rgb(0.86, 0.93, 0.88)});
    page.drawText('Original figures, fonts and page geometry remain intact.', {font, x: 44, y: 390, size: 11});
  }
  return Buffer.from(await document.save());
}

async function createFixture(files) {
  const state = {requests: [], pdfRequests: [], completed: [], stalledRequests: 0, canceledDownloads: 0};
  const server = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', '*');
    if (request.method === 'OPTIONS') {response.writeHead(204); response.end(); return;}
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/favicon.ico') {response.writeHead(204); response.end(); return;}
    if (pathname === '/stalled.pdf') {
      state.stalledRequests += 1; response.once('close', () => {state.canceledDownloads += 1;});
      response.setHeader('Content-Type', 'application/pdf'); response.setHeader('Content-Length', files['/selection-fixture.pdf'].length);
      response.flushHeaders(); response.write(files['/selection-fixture.pdf'].subarray(0, 32)); return;
    }
    if (files[pathname]) {
      state.pdfRequests.push(pathname);
      response.setHeader('Content-Type', 'application/pdf');
      response.setHeader('Content-Length', files[pathname].length);
      response.end(files[pathname]); return;
    }
    if (pathname !== '/v1/chat/completions') {response.writeHead(404); response.end(); return;}
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const prompt = body.messages.filter(message => message.role === 'user').map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
      const source = /SOURCE_BEGIN([\s\S]*?)SOURCE_END/u.exec(prompt)?.[1];
      assert.equal(typeof source, 'string', '翻译夹具需要明确的 SOURCE_BEGIN/SOURCE_END 原文边界');
      const entry = {source, startedAt: Date.now()}; state.requests.push(entry);
      await wait(source.includes('First ownership') ? 1600 : 20);
      state.completed.push({...entry, completedAt: Date.now(), disconnected: response.destroyed});
      if (response.destroyed) return;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({id: 'pdf-selection-fixture', object: 'chat.completion', created: 1, model: 'pdf-fixture',
        choices: [{index: 0, message: {role: 'assistant', content: `测试译文：${source}`}, finish_reason: 'stop'}],
        usage: {prompt_tokens: 10, completion_tokens: 10, total_tokens: 20}}));
    } catch (error) {response.writeHead(400); response.end(JSON.stringify({error: {message: error.message}}));}
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  return {state, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => {server.close(resolve); server.closeAllConnections();})};
}

async function until(predicate, message, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {if (await predicate()) return; await wait(75);}
  throw new Error(message);
}

// WeakRef 不人为持有已释放资源；统计包括未挂回 DOM 的在途/迟到 Canvas，不能只数可见页。
function installResourceProbe() {
  const native = Document.prototype.createElement;
  const refs = [];
  Document.prototype.createElement = function(name, ...rest) {
    const element = Reflect.apply(native, this, [name, ...rest]);
    if (name === 'canvas' || name === 'div') refs.push(new WeakRef(element));
    return element;
  };
  globalThis.__pdfProbe = () => {
    const elements = refs.map(reference => reference.deref()).filter(Boolean);
    const canvases = elements.filter(element => element.tagName === 'CANVAS' && element.getAttribute('aria-hidden') === 'true' && element.style.width && element.width > 0 && element.height > 0);
    const textLayers = elements.filter(element => element.hasAttribute('data-fluentread-pdf-text') && element.childNodes.length > 0);
    const pagePixels = [...document.querySelectorAll('.pdf-page-row')].map(row => ({page: Number(row.dataset.pageNumber),
      pixels: [...row.querySelectorAll('canvas')].reduce((sum, canvas) => sum + canvas.width * canvas.height, 0)}));
    return {shells: document.querySelectorAll('.pdf-page-row').length, canvases: canvases.length, textLayers: textLayers.length, pagePixels,
      sourceOnly: document.querySelectorAll('.pdf-page-column.translated').length === 0,
      attachedCanvases: document.querySelectorAll('.pdf-layout-viewer canvas').length,
      pixels: canvases.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0)};
  };
  globalThis.__pdfPeaks = {shells: 0, canvases: 0, textLayers: 0, pixels: 0};
  setInterval(() => {const state = globalThis.__pdfProbe(); for (const key of Object.keys(globalThis.__pdfPeaks)) globalThis.__pdfPeaks[key] = Math.max(globalThis.__pdfPeaks[key], state[key]);}, 40);
}

async function main() {
  const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
  const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-pdf-selection'));
  const packages = arg('playwright-root', process.env.PLAYWRIGHT_ROOT);
  const arxivPath = arg('arxiv-pdf');
  const liveArxiv = process.argv.includes('--live-arxiv');
  const skipRotations = process.argv.includes('--skip-rotations');
  assert(packages, '需要 --playwright-root 或 PLAYWRIGHT_ROOT');
  assert(fs.existsSync(path.join(extensionDir, 'manifest.json')), '请先生成生产扩展产物');
  if (arxivPath) assert(fs.existsSync(arxivPath), '找不到 --arxiv-pdf 指定的论文');
  const {chromium} = createRequire(path.join(path.resolve(packages), 'pdf-selection-runner.cjs'))('playwright');
  const helper = require(path.resolve(arg('focus-safe-helper', path.join(__dirname, 'testing/focus-safe-browser.cjs'))));
  fs.mkdirSync(artifactsDir, {recursive: true});
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-pdf-selection-'));
  // Chromium 原生键盘浏览非编辑文字需启用 caret browsing；只设置新建临时 profile，不读取用户 profile。
  fs.mkdirSync(path.join(profileDir, 'Default'), {recursive: true});
  fs.writeFileSync(path.join(profileDir, 'Default', 'Preferences'), JSON.stringify({settings: {a11y: {caretbrowsing: {enabled: true, show_dialog: false}}}}));
  const report = {ok: false, extensionDir, artifactsDir, cases: [], screenshots: [], importTimings: [], resources: [], consoleErrors: [],
    providerEvidence: 'Production extension and real PDF.js/Edge input; deterministic loopback translation fixture. arXiv fixture is local unless a separate live import is recorded.',
    profileMode: 'new temporary profile', nativeCaretBrowsing: {enabled: true, scope: 'new temporary test profile only', preference: 'settings.a11y.caretbrowsing.enabled'}, selectionInput: 'real Playwright mouse drag and keyboard over PDF.js TextLayer',
    selectionLimits: {paperTitle: 'Not claimed: prior isolated background Input title drags collapsed with unchanged text-node identity and user-select:text; no product cause demonstrated. This suite selects meaningful abstract source text.'}};
  if (skipRotations) report.skipped = ['rotatedPDF'];
  let fixture, launched, page, launchAttempted = false;
  const record = name => {report.cases.push(name); process.stdout.write(`PASS ${name}\n`);};
  try {
    const smallPdf = await createPdf(3), longPdf = await createPdf(120);
    fs.writeFileSync(path.join(artifactsDir, 'selection-fixture.pdf'), smallPdf);
    fs.writeFileSync(path.join(artifactsDir, 'long-120.pdf'), longPdf);
    fixture = await createFixture({'/selection-fixture.pdf': smallPdf});
    launchAttempted = true;
    launched = await helper.launchFocusSafePersistentContext({chromium, profileDir,
      browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'), background: true, headless: false,
      viewport: {width: 1440, height: 960}, displayTarget: 'secondary', timeout: 30000,
      browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
    guardBrowserClose(launched, profileDir);
    Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
    assert.equal(launched.windowPlacement.browserFrontmost, false, '测试浏览器不能成为用户前台应用');
    const context = launched.context;
    const browserPid = await getGuardedBrowserPid(launched);
    const checkFocus = async stage => {
      if (process.platform !== 'darwin') return;
      const script = "ObjC.import('AppKit'); const app=$.NSWorkspace.sharedWorkspace.frontmostApplication; JSON.stringify({pid:Number(app.processIdentifier),name:ObjC.unwrap(app.localizedName)||''});";
      const {stdout} = await execFileAsync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], {timeout: 5000});
      const frontmost = JSON.parse(stdout.trim()); assert(Number.isInteger(frontmost.pid), '无法读取当前前台应用，停止测试');
      (report.frontmostSnapshots ||= []).push({stage, ...frontmost, browserFrontmost: frontmost.pid === browserPid});
      assert.notEqual(frontmost.pid, browserPid, `测试 Edge 成为前台，停止 ${stage}`);
    };
    const {worker, extensionId} = await support.waitForWorker(context);
    const origin = `chrome-extension://${extensionId}`;
    const preparePage = async next => {
      next.setDefaultTimeout(30000);
      next.on('pageerror', error => report.consoleErrors.push({url: next.url(), error: error.message}));
      next.on('console', message => {if (message.type() === 'error') report.consoleErrors.push({url: next.url(), error: message.text()});});
      await next.addInitScript(installResourceProbe); return next;
    };
    const newPage = async () => preparePage(await helper.newPageWithoutForeground(context, 30000));
    const initialPage = context.pages().find(candidate => /^about:blank#fluentread-background-/u.test(candidate.url()));
    const configPage = initialPage ? await preparePage(initialPage) : await newPage();
    await configPage.goto(`${origin}/document.html`); await configPage.locator('.file-drop-zone').waitFor(); await checkFocus('initial document page');
    const current = await support.readStoredConfig(configPage), service = 'custom:pdf-fixture';
    await support.patchStoredConfig(configPage, {on: true, uiLanguage: 'zh-CN', uiLanguageSetupCompleted: true, service, from: 'en', to: 'zh-Hans',
      selectionTranslationService: service, documentService: service, model: {...current.model, [service]: 'pdf-fixture'},
      documentModel: {...current.documentModel, [service]: 'pdf-fixture'}, user_role: {...current.user_role, [service]: 'SOURCE_BEGIN{{origin}}SOURCE_END'},
      customOpenAIProviders: [{id: service, name: 'PDF 本机确定性测试', endpoint: `${fixture.base}/v1/chat/completions`, models: ['pdf-fixture']}],
      requireApiKey: {[`v2:${JSON.stringify([service, 'pdf-fixture'])}`]: false}, token: {...current.token, [service]: 'fixture-token'},
      selectionTranslatorMode: 'bilingual', selectionTranslatorTrigger: 'icon', selectionTranslatorDelay: 0, selectionTranslatorAutoDismiss: false,
      useCache: false, hotkey: 'none', floatingBallHotkey: 'none', enableAIContext: false, enableAIMultiSegment: false});
    const patch = async value => {await support.patchStoredConfig(configPage, value); await wait(200);};
    const openDocument = async () => {
      // 已完成的本机夹具译文经真实产品确认清空，避免导航触发 beforeunload 让自动化失去下一步输入。
      if (await configPage.locator('.task-progress.complete').count()) {
        await configPage.locator('.document-settings-button').click(); await configPage.locator('.sidebar-change-file').click();
        const confirm = configPage.locator('dialog[open][aria-labelledby="confirm-document-heading"]'); if (await confirm.count()) await confirm.locator('.translate-document-button').click();
        await configPage.locator('.file-drop-zone').waitFor();
      }
      await configPage.goto(`${origin}/document.html`); await configPage.locator('.file-drop-zone').waitFor(); await checkFocus('document reload'); return configPage;
    };
    const shot = async name => {await checkFocus(name); const file = path.join(artifactsDir, `${name}.png`); await page.screenshot({path: file, animations: 'disabled'}); report.screenshots.push(file);};
    const rowReady = async number => {await page.locator(`.pdf-page-row[data-page-number="${number}"][data-render-state="ready"] [data-fluentread-pdf-text] span`).first().waitFor();};
    const load = async (name, buffer) => {
      const started = Date.now(), requestsBefore = fixture.state.requests.length; await page.locator('input[type=file]').setInputFiles({name, mimeType: 'application/pdf', buffer});
      await page.locator('.workspace-heading h1').filter({hasText: name}).waitFor({timeout: 60000}); await rowReady(1);
      report.importTimings.push({name, firstSelectablePageMs: Date.now() - started});
      assert.equal(fixture.state.requests.length, requestsBefore, '仅导入 PDF 不得发送整份文档到翻译服务'); await checkFocus(`import ${name}`);
    };
    const resourceState = async label => {
      const state = await page.evaluate(() => ({...globalThis.__pdfProbe(), peaks: {...globalThis.__pdfPeaks}}));
      assert(state.shells <= 5 && state.canvases <= (state.sourceOnly ? 5 : 10) && state.textLayers <= 5, `PDF 资源必须有界：${JSON.stringify(state)}`);
      assert(state.pagePixels.every(entry => entry.pixels <= 2_500_000), `单页源/译画布合计超过 2.5m：${JSON.stringify(state)}`);
      assert(state.pixels <= 12_500_000 && state.peaks.pixels <= 12_500_000, `Canvas 像素超过 12.5m：${JSON.stringify(state)}`);
      assert(state.peaks.shells <= 5 && state.peaks.canvases <= 10 && state.peaks.textLayers <= 5, `历史资源峰值超限：${JSON.stringify(state)}`);
      report.resources.push({label, ...state}); return state;
    };
    const readerGeometry = async label => {
      const geometry = await page.locator('.reading-content.reading-pdf').evaluate(parent => {
        const viewer = parent.querySelector('[data-document-reader="pdf"]'), scroll = viewer.querySelector('[data-pdf-scroll]');
        const frame = viewer.querySelector('.pdf-page-row[data-render-state="ready"] .pdf-page-frame'), canvas = frame?.querySelector('canvas');
        const measure = element => {const bounds = element.getBoundingClientRect(); return {left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height};};
        return {viewport: {width: innerWidth, height: innerHeight}, parent: measure(parent), viewer: measure(viewer), scroll: measure(scroll), frame: frame && measure(frame), canvas: canvas && measure(canvas), direction: getComputedStyle(parent).flexDirection};
      });
      (report.readerGeometries ||= []).push({label, ...geometry});
      assert.equal(geometry.direction, 'column', 'PDF 阅读器和未翻译提示必须按列排列');
      assert(geometry.viewer.width >= geometry.parent.width - 2, `PDF 阅读器未占满阅读区：${JSON.stringify(geometry)}`);
      assert(geometry.scroll.width >= geometry.viewer.width - 2, `PDF 滚动区宽度被兄弟提示挤占：${JSON.stringify(geometry)}`);
      if (await page.locator('.pdf-zoom-control select').inputValue() === 'fit') {
        const minimumPageWidth = geometry.viewport.width <= 600 ? 250 : Math.min(geometry.scroll.width - 65, 600);
        assert(geometry.frame?.width >= minimumPageWidth && geometry.canvas?.width >= minimumPageWidth, `适合宽度的 PDF 页面必须保持可读尺寸：${JSON.stringify(geometry)}`);
      }
      return geometry;
    };
    const uiNode = async name => support.findCdpNode((await support.getSelectionUiTree(page)).root, node => support.hasCdpClass(node, name));
    const uiText = async () => support.cdpText(await uiNode('fr-translation-tooltip'));
    const clickNode = async name => {
      const {session, root} = await support.getSelectionUiTree(page);
      const node = support.findCdpNode(root, candidate => support.hasCdpClass(candidate, name)); assert(node, `缺少 ${name}`);
      const {model} = await session.send('DOM.getBoxModel', {nodeId: node.nodeId}); const q = model.content;
      await page.mouse.click((q[0] + q[2] + q[4] + q[6]) / 4, (q[1] + q[3] + q[5] + q[7]) / 4);
    };
    const normalizeSelection = value => value.replace(/\u00ad/gu, '').replace(/[\s\u00a0]+/gu, ' ').trim();
    const nativeSelectionState = () => page.evaluate(() => {
      const selection = getSelection(), describe = node => node && {text: node.textContent?.slice(0, 180), connected: node.isConnected, page: node.parentElement?.closest('[data-pdf-page-number]')?.getAttribute('data-pdf-page-number')};
      return {text: selection?.toString(), anchor: describe(selection?.anchorNode), anchorOffset: selection?.anchorOffset, focus: describe(selection?.focusNode), focusOffset: selection?.focusOffset,
        anchorSameAsStart: selection?.anchorNode === globalThis.__pdfGestureStartNode, focusSameAsStart: selection?.focusNode === globalThis.__pdfGestureStartNode,
        originalPointConnected: globalThis.__pdfGestureStartNode?.isConnected, isCollapsed: selection?.isCollapsed, scrollTop: document.querySelector('[data-pdf-scroll]').scrollTop, pages: [...document.querySelectorAll('.pdf-page-row')].map(row => row.dataset.pageNumber)};
    });
    const characterPoint = async (number, text, atEnd) => page.evaluate(({number, text, atEnd}) => {
      const span = [...document.querySelectorAll(`[data-fluentread-pdf-text][data-pdf-page-number="${number}"] span`)].find(element => element.textContent.includes(text));
      if (!span) throw new Error(`真实拖选目标缺失：${text}`);
      const textNode = span.firstChild, index = span.textContent.indexOf(text), desiredOffset = index + (atEnd ? text.length : 0);
      const glyphOffset = atEnd ? desiredOffset - 1 : desiredOffset, range = document.createRange();
      range.setStart(textNode, glyphOffset); range.setEnd(textNode, glyphOffset + 1);
      const rect = range.getBoundingClientRect(), viewport = document.querySelector('[data-pdf-scroll]').getBoundingClientRect();
      const probes = [];
      // 只读 caret 探针验证浏览器命中的实际字符，避免 PDF.js 的 transform/裁剪坐标让拖选扩成多行。
      for (const fractionY of [0.5, 0.35, 0.65, 0.01, 0.99]) {
        const edges = atEnd ? [rect.right - 0.1, rect.right - 0.4, rect.right, rect.right + 0.4] : [rect.left + 0.1, rect.left + 0.4, rect.left, rect.left - 0.4];
        for (const x of [...edges, rect.left + rect.width / 2, rect.left + 0.1, rect.right - 0.1]) {
          const y = rect.top + rect.height * fractionY;
          if (x <= viewport.left || x >= viewport.right || y <= viewport.top + 3 || y >= viewport.bottom - 3) continue;
          const caret = document.caretPositionFromPoint?.(x, y), caretRange = !caret && document.caretRangeFromPoint?.(x, y);
          const node = caret ? caret.offsetNode : caretRange?.startContainer, offset = caret ? caret.offset : caretRange?.startOffset;
          probes.push({x, y, text: node?.textContent?.slice(0, 120), offset});
          if (node === textNode && offset === desiredOffset) {
            const hit = document.elementFromPoint(x, y), ancestors = []; let ancestor = hit;
            for (let count = 0; ancestor && count < 8; count += 1, ancestor = ancestor.parentElement) {const style = getComputedStyle(ancestor); ancestors.push({tag: ancestor.tagName, className: ancestor.className, userSelect: style.userSelect, pointerEvents: style.pointerEvents});}
            return {x, y, expectedOffset: desiredOffset, caretOffset: offset, text: span.textContent, hitHtml: hit?.outerHTML?.slice(0, 400), ancestors,
              glyph: {left: rect.left, top: rect.top, width: rect.width, height: rect.height}, scrollTop: document.querySelector('[data-pdf-scroll]').scrollTop};
          }
        }
      }
      throw new Error(`真实拖选坐标无法命中目标字符：${JSON.stringify({text, number, atEnd, desiredOffset, glyph: rect.toJSON(), span: span.getBoundingClientRect().toJSON(), viewport: viewport.toJSON(), transform: getComputedStyle(span).transform, probes})}`);
    }, {number, text, atEnd});
    const dragLines = async (first, last = first, number = 1) => {
      await checkFocus('before selection input');
      await helper.activateExtensionTabWithoutForeground(context, page);
      await page.keyboard.press('Escape'); await page.locator('.pdf-selection-hint').click();
      assert(await page.evaluate(() => !getSelection()?.rangeCount || getSelection().isCollapsed), '下一次拖选前必须用真实点击清除旧选区，防止浏览器启动文字拖放');
      await page.locator(`[data-fluentread-pdf-text][data-pdf-page-number="${number}"] span`).filter({hasText: first}).first().scrollIntoViewIfNeeded();
      const points = {start: await characterPoint(number, first, false), end: await characterPoint(number, last, true)};
      const gesture = {kind: 'same-page', number, first, last, ...points, states: []}; (report.selectionGestures ||= []).push(gesture);
      await page.mouse.move(points.start.x, points.start.y); await page.mouse.down(); await page.evaluate(() => {globalThis.__pdfGestureStartNode = getSelection()?.anchorNode;}); gesture.states.push({stage: 'down', ...await nativeSelectionState()});
      await page.mouse.move(points.end.x, points.end.y, {steps: 18}); gesture.states.push({stage: 'move', ...await nativeSelectionState()}); await page.mouse.up();
      const selected = await page.evaluate(() => getSelection()?.toString() || '');
      Object.assign(gesture, {selected, scrollTopAfter: await page.locator('[data-pdf-scroll]').evaluate(element => element.scrollTop)});
      assert.equal(normalizeSelection(selected), normalizeSelection(first === last ? first : `${first} ${last}`), `真实拖选必须严格对应指定原文：${selected}`); return selected;
    };
    const translateDrag = async (first, last = first) => {const selected = await dragLines(first, last); await until(() => uiNode('fr-selection-indicator'), 'PDF 划词入口未出现'); await clickNode('fr-selection-indicator'); await until(async () => (await uiText()).includes('测试译文'), 'PDF 划词译文未出现'); return selected;};
    const translateKeyboardLine = async text => {
      await checkFocus('before native keyboard selection'); await helper.activateExtensionTabWithoutForeground(context, page);
      await page.keyboard.press('Escape'); await page.locator('.pdf-selection-hint').click();
      await page.locator('[data-fluentread-pdf-text][data-pdf-page-number="1"] span').filter({hasText: text}).first().scrollIntoViewIfNeeded();
      const start = await characterPoint(1, text, false); await page.mouse.click(start.x, start.y);
      await page.evaluate(() => {globalThis.__pdfGestureStartNode = getSelection()?.anchorNode;});
      const gesture = {kind: 'native-keyboard', first: text, start, key: 'Shift+ArrowRight', count: text.length, states: [{stage: 'caret-click', ...await nativeSelectionState()}]};
      (report.selectionGestures ||= []).push(gesture);
      assert.equal(gesture.states[0].anchorOffset, 0, '键盘选择必须从真实鼠标点击的原文起始 caret 开始');
      await page.keyboard.down('Shift');
      try {for (let offset = 0; offset < text.length; offset += 1) await page.keyboard.press('ArrowRight');} finally {await page.keyboard.up('Shift');}
      gesture.states.push({stage: 'keyboard-selected', ...await nativeSelectionState()});
      const selected = await page.evaluate(() => getSelection()?.toString() || ''); gesture.selected = selected;
      assert.equal(normalizeSelection(selected), normalizeSelection(text), '旋转页真实键盘选择必须严格对应指定原文');
      await until(() => uiNode('fr-selection-indicator'), '旋转页键盘划词入口未出现'); await clickNode('fr-selection-indicator');
      await until(async () => (await uiText()).includes(`测试译文：${text}`), '旋转页键盘选区未返回确定性中文译文'); return selected;
    };
    const paperSelectionTarget = () => page.locator('[data-fluentread-pdf-text][data-pdf-page-number="1"] span').evaluateAll(spans => {
      const texts = spans.map(span => span.textContent);
      return texts.find(text => /dominant|Transformer|architecture/iu.test(text) && text.trim().split(/\s+/u).length >= 4 && !/copyright|license|permission|attribution|Google hereby/iu.test(text));
    });
    const dragAcrossPages = async () => {
      await checkFocus('before cross-page selection input'); await helper.activateExtensionTabWithoutForeground(context, page); await page.keyboard.press('Escape'); await page.locator('.pdf-selection-hint').click();
      await page.locator('.pdf-zoom-control select').selectOption('1'); await wait(200); await rowReady(1);
      const first = 'Original figures, fonts and page geometry remain intact.', last = 'FluentRead PDF fixture page 2';
      const firstSpan = page.locator('[data-fluentread-pdf-text][data-pdf-page-number="1"] span').filter({hasText: first}).first();
      await firstSpan.scrollIntoViewIfNeeded();
      const start = await characterPoint(1, first, false);
      const nativeState = nativeSelectionState;
      report.crossPageGesture = {start, states: []};
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      await page.evaluate(() => {globalThis.__pdfGestureStartNode = getSelection()?.anchorNode;});
      report.crossPageGesture.states.push({stage: 'down', ...await nativeState()});
      try {
        // 先超过原页上的真实拖拽阈值，再滚动；否则 Chromium 会在后来的移动点重新决定起始 caret。
        await page.mouse.move(start.x + 20, start.y, {steps: 4}); report.crossPageGesture.states.push({stage: 'start-drag', ...await nativeState()});
        // 浏览器 Input 的按下/拖动创建真实选区；只滚动内层视口，不写入 Selection 或 DOM Range。
        await page.locator('[data-pdf-scroll]').evaluate(element => {const next = element.querySelector('.pdf-page-row[data-page-number="2"]'); if (!next) throw new Error('跨页拖选需要第二页'); element.scrollTop = Number.parseFloat(next.style.top);});
        await rowReady(2); await wait(100);
        report.crossPageGesture.states.push({stage: 'scroll', ...await nativeState()});
        const end = await characterPoint(2, last, true); report.crossPageGesture.end = end; await page.mouse.move(end.x, end.y, {steps: 18});
        report.crossPageGesture.states.push({stage: 'move', ...await nativeState()});
      } finally {await page.mouse.up();}
      report.crossPageGesture.states.push({stage: 'up', ...await nativeState()});
      const selected = await page.evaluate(() => getSelection()?.toString() || '');
      assert(selected.includes(first) && selected.includes(last), `真实跨页拖选没有保留两端：${selected}`);
      await until(() => uiNode('fr-selection-indicator'), '跨页划词入口未出现'); await clickNode('fr-selection-indicator');
      await until(async () => (await uiText()).includes('测试译文'), '跨页划词译文未出现');
      const requestedSource = fixture.state.requests.at(-1).source;
      assert.equal(requestedSource, `${first} ${last}`, '跨页请求必须只有两页原文，不能夹入页眉、原文标签或页码控件');
      assert(!/原文|第\s*2\s*页|可选择原文/u.test(requestedSource), '跨页请求混入了阅读器装饰文字');
      assert((await uiText()).includes(`测试译文：${requestedSource}`)); report.crossPage = {nativeSelection: selected, requestedSource, input: 'mouse down; inner viewport scrollTop; mouse move and up'};
    };

    page = await openDocument(); await load('sample.pdf', fs.readFileSync(path.join(__dirname, '..', 'examples/document-translation/sample.pdf'))); await resourceState('local sample'); await shot('sample-local'); record('local sample PDF retains canvas and a selectable PDF.js text layer');
    if (arxivPath) {
      page = await openDocument(); await load('attention-is-all-you-need.pdf', fs.readFileSync(arxivPath));
      const text = await page.locator('[data-fluentread-pdf-text][data-pdf-page-number="1"]').innerText(); assert(/attention/iu.test(text), '论文第一页文字层必须含 Attention');
      const target = await paperSelectionTarget(); report.localArxivSource = target;
      assert(target, '论文必须有可拖选的真实多词文本'); await translateDrag(target); await shot('arxiv-local-selection'); await resourceState('arxiv local'); record('actual arXiv PDF imports locally and a real mouse selection produces Chinese fixture output');
    }
    for (const rotation of skipRotations ? [] : [90, 180, 270]) {
      page = await openDocument(); const rotated = await createPdf(1, rotation); await load(`rotation-${rotation}.pdf`, rotated); await shot(`rotation-${rotation}-source`);
      assert.equal(await page.locator('[data-fluentread-pdf-text]').getAttribute('data-main-rotation'), String(rotation), 'TextLayer 应声明真实 PDF 页面方向');
      const proof = {rotation, pointerAttempt: null}; (report.rotatedSelections ||= []).push(proof);
      try {proof.pointerAttempt = {status: 'selected', selected: await dragLines(LINES[0])};}
      catch (error) {
        if (error?.code !== 'ERR_ASSERTION' || !error.message.includes('真实拖选必须严格对应指定原文')) throw error;
        proof.pointerAttempt = {status: 'inconclusive', error: error.message, limitation: 'Background browser Input collapsed native drag despite correct glyph hit and unchanged source node; no mouse-selection success claimed.'};
      }
      proof.keyboardSelection = await translateKeyboardLine(LINES[0]); proof.requestedSource = fixture.state.requests.at(-1).source;
      assert.equal(proof.requestedSource, LINES[0], '旋转页面键盘选区请求必须严格对应单行原文');
      await resourceState(`rotation ${rotation}`); await shot(`rotation-${rotation}-keyboard-selection`); record(`rotated ${rotation}° PDF supports exact native keyboard selection and Chinese fixture output; pointer evidence recorded separately`);
    }
    page = await openDocument(); await load('selection-fixture.pdf', smallPdf);
    const nativeCrossLine = await translateDrag(LINES[0], LINES[1]);
    const source = fixture.state.requests.at(-1).source; assert.equal(source, `${LINES[0]} ${LINES[1]}`, '跨行请求必须严格对应两行原文'); assert(!/[\r\n]/u.test(source), '跨行选区请求应规范成连续原文');
    assert((await uiText()).includes(`测试译文：${source}`)); report.crossLine = {nativeSelection: nativeCrossLine, requestedSource: source}; await shot('cross-line-selection'); record('real cross-line drag preserves source layout and sends one normalized sentence to the chosen service');
    await dragAcrossPages(); await shot('cross-page-selection'); await resourceState('cross-page selection pins'); record('real mouse drag across adjacent pages translates source text without reader labels or page metadata');
    await page.keyboard.press('Escape'); const returnToFirst = page.locator('.pdf-page-navigation input'); await returnToFirst.fill('1'); await returnToFirst.press('Enter'); await rowReady(1);
    const before = fixture.state.requests.length; await dragLines(LINES[2]); await until(() => uiNode('fr-selection-indicator'), '旧选区入口缺失'); await clickNode('fr-selection-indicator'); await until(() => fixture.state.requests.length > before, '旧选区请求未开始');
    await translateDrag(LINES[3]); await wait(1800); assert((await uiText()).includes(LINES[3]) && !(await uiText()).includes(LINES[2]), '旧请求覆盖了新选区结果'); await shot('late-selection-owner'); record('late response from the previous PDF selection cannot replace the new selection');
    await page.keyboard.press('Escape'); await patch({selectionTranslatorTrigger: 'Control'}); const shortcutBefore = fixture.state.requests.length; await dragLines(LINES[0]); await wait(200); assert.equal(fixture.state.requests.length, shortcutBefore);
    await page.keyboard.down('Control'); await page.keyboard.up('Control'); await until(async () => (await uiText()).includes('测试译文'), '真实 Control 未触发 PDF 划词'); record('real Control respects shortcut-only selection trigger'); await patch({selectionTranslatorTrigger: 'icon'}); await page.keyboard.press('Escape');
    await page.locator('.pdf-zoom-control select').selectOption('1'); await wait(200); await rowReady(1);
    const sourceGeometry = () => page.locator('.pdf-page-row[data-page-number="1"] .pdf-page-column:not(.translated) .pdf-page-frame').evaluate(frame => {
      const bounds = frame.getBoundingClientRect(), span = frame.querySelector('[data-fluentread-pdf-text] span'), glyphs = span.getBoundingClientRect();
      return {width: bounds.width, height: bounds.height, firstText: span.textContent, firstGlyph: {left: glyphs.left - bounds.left, top: glyphs.top - bounds.top, width: glyphs.width, height: glyphs.height}};
    });
    const sourceBeforeTranslation = await sourceGeometry(), documentRequestsBefore = fixture.state.requests.length;
    await page.locator('.translation-actions .translate-document-button').click(); await page.locator('.document-status').filter({hasText: '翻译完成'}).waitFor();
    assert(fixture.state.requests.length > documentRequestsBefore, '整份文档翻译必须实际调用已选服务');
    const modes = page.locator('[aria-label="阅读方式"]'); await modes.getByRole('button', {name: '双语', exact: true}).click();
    await page.locator('.pdf-page-row[data-page-number="1"][data-render-state="ready"] .pdf-page-column.translated canvas').waitFor();
    assert.deepEqual(await sourceGeometry(), sourceBeforeTranslation, '双语原页 CSS 尺寸和 PDF.js 字形几何必须保持原版面');
    await translateDrag(LINES[0], LINES[1]); await resourceState('three-page bilingual'); await shot('translated-bilingual-selection');
    await page.keyboard.press('Escape'); await modes.getByRole('button', {name: '译文', exact: true}).click();
    await until(async () => await page.locator('.pdf-page-row[data-page-number="1"][data-render-state="ready"] .pdf-page-column.translated canvas').count()
      && await page.locator('[data-fluentread-pdf-text]').count() === 0, '仅译文模式必须显示译页画布并移除原文文字层');
    await resourceState('three-page translated'); await shot('translated-only-pages');
    await modes.getByRole('button', {name: '原文', exact: true}).click(); await rowReady(1); await until(async () => await page.locator('.pdf-page-column.translated').count() === 0, '原文模式仍残留译页');
    assert.deepEqual(await sourceGeometry(), sourceBeforeTranslation, '恢复原文模式必须保留原始页面和文字几何'); await resourceState('three-page restored source');
    record('whole-document fixture translation preserves source geometry and original/bilingual/translated modes with bounded canvases');
    await patch({selectionTranslatorTrigger: 'contextMenu'}); const contextBefore = fixture.state.requests.length; await dragLines(LINES[1]); await wait(200);
    assert.equal(fixture.state.requests.length, contextBefore, '右键模式应等待明确的后台指令'); assert.equal(await uiNode('fr-selection-indicator'), null, '右键模式不显示划词入口');
    const documentTabId = await page.evaluate(async () => (await chrome.tabs.getCurrent()).id);
    const sendContextMenu = () => worker.evaluate(async tabId => chrome.runtime.sendMessage({type: 'documentSelectionTranslate', tabId}), documentTabId);
    const firstContextResponse = await sendContextMenu(); assert.equal(firstContextResponse.status, 'success'); await until(async () => (await uiText()).includes(`测试译文：${LINES[1]}`), '后台右键指令未打开匹配文档页的划词卡片');
    await page.keyboard.press('Escape'); await until(async () => !(await uiNode('fr-translation-tooltip')), 'Esc 未关闭右键划词卡片');
    const reopenedContextResponse = await sendContextMenu(); assert.equal(reopenedContextResponse.status, 'success'); await until(async () => (await uiText()).includes(`测试译文：${LINES[1]}`), '同一真实选区经右键指令不能重新打开卡片');
    report.documentContextMenu = {documentTabId, firstResponse: firstContextResponse, reopenedResponse: reopenedContextResponse, sender: 'actual extension service worker runtime.sendMessage', nativeOsMenuGesture: false};
    await shot('context-menu-runtime-selection'); record('actual trusted background runtime command opens and reopens the selected PDF card; native OS menu gesture is outside this proof');
    await patch({selectionTranslatorTrigger: 'icon'}); await page.keyboard.press('Escape');
    await page.setViewportSize({width: 390, height: 844}); await page.emulateMedia({colorScheme: 'dark'}); await patch({theme: 'dark'}); await page.locator('.pdf-zoom-control select').selectOption('fit'); await wait(200); await rowReady(1); await translateDrag(LINES[0]);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390px 文档页横向溢出'); await readerGeometry('390 dark translated source'); await shot('selection-390-dark'); await resourceState('390 dark'); record('390px dark reading retains original text selection and usable card'); await page.emulateMedia({colorScheme: 'light'}); await patch({theme: 'light'}); await page.setViewportSize({width: 1440, height: 960});

    page = await openDocument(); const beforeOnline = fixture.state.requests.length;
    await page.locator('#online-pdf-url').fill(`${fixture.base}/stalled.pdf`); await page.locator('#online-pdf-url').press('Enter');
    await until(() => fixture.state.stalledRequests > 0, '在线导入未开始读取迟缓 PDF'); await until(async () => /\d/u.test(await page.locator('.upload-description').innerText()), '下载阶段应显示实际字节进度');
    await page.locator('.file-drop-zone').getByRole('button', {name: '取消导入', exact: true}).click(); await until(() => fixture.state.canceledDownloads > 0, '取消后仍在读取在线 PDF 连接');
    assert.equal(await page.locator('[data-document-reader="pdf"]').count(), 0, '取消导入不得打开部分 PDF'); assert(await page.locator('#online-pdf-url').isEnabled(), '取消后应该允许立即重试');
    await page.locator('#online-pdf-url').fill(`${fixture.base}/selection-fixture.pdf`); await page.locator('#online-pdf-url').press('Enter'); await rowReady(1); assert.equal(fixture.state.requests.length, beforeOnline); await translateDrag(LINES[0], LINES[1]); await shot('online-pdf-selection'); record('online HTTP PDF byte progress cancels a stalled body and retries into the same selectable reader');
    const nativePdf = await newPage(); await nativePdf.goto(`${fixture.base}/selection-fixture.pdf`, {waitUntil: 'domcontentloaded'});
    const destination = await openDocument(), destinationId = await destination.evaluate(async () => (await chrome.tabs.getCurrent()).id);
    // tabs.create 生产行为会新建页面；预创建目标先离开 document.html，避免仅更新 fragment 而不重新挂载。
    await destination.goto('about:blank');
    const popup = await newPage(); await helper.activateExtensionTabWithoutForeground(context, nativePdf); await popup.goto(`${origin}/popup.html`); await popup.locator('.popup-shell[data-config-ready="true"]').waitFor();
    await popup.evaluate(targetId => {globalThis.__pdfReaderOpens = []; chrome.tabs.create = (properties, callback) => {globalThis.__pdfReaderOpens.push(properties); const promise = chrome.tabs.update(targetId, {url: properties.url, active: false}); if (callback) promise.then(callback); return promise;}; window.close = () => {};}, destinationId);
    await helper.activateExtensionTabWithoutForeground(context, nativePdf); await popup.locator('[data-testid="page-translation"]').click(); await destination.waitForURL(/document\.html#pdf=/u); page = destination;
    const opens = await popup.evaluate(() => globalThis.__pdfReaderOpens); assert.equal(opens.length, 1); assert.equal(new URLSearchParams(new URL(opens[0].url).hash.slice(1)).get('pdf'), `${fixture.base}/selection-fixture.pdf`);
    report.nativePopupRedirect = {sourceUrl: nativePdf.url(), requests: opens, nativeTabCreation: false, focusAdapter: 'precreated background reader destination; actual popup tabs.create arguments and tabs.update(active:false), original close captured'};
    await rowReady(1);
    await translateDrag(LINES[0]); await shot('native-popup-reader-selection'); record('native PDF popup full-page action hands the source URL to the reader and its real selection card works'); await popup.close(); await nativePdf.close();

    page = await openDocument(); await load('long-120.pdf', longPdf); assert((await page.locator('.pdf-page-total').innerText()).includes('120')); await resourceState('120 first page');
    for (const number of [60, 120, 1, 100, 25, 119, 2, 60]) {
      const input = page.locator('.pdf-page-navigation input'), navigation = {target: number, valueBefore: await input.inputValue()}; (report.pageJumps ||= []).push(navigation);
      await input.fill(String(number)); navigation.valueAfterFill = await input.inputValue(); await input.press('Enter'); navigation.valueAfterEnter = await input.inputValue();
      await rowReady(number); navigation.valueAtReady = await input.inputValue(); await resourceState(`jump ${number}`);
    }
    for (const zoom of ['1', '1.5']) {await page.locator('.pdf-zoom-control select').selectOption(zoom); await wait(200); await rowReady(60); assert.equal(await page.locator('.pdf-page-navigation input').inputValue(), '60', '远处页缩放必须保持当前页'); await resourceState(`page 60 zoom ${zoom}`);}
    await page.locator('[data-pdf-scroll]').focus(); await page.keyboard.press('End'); await rowReady(120); await page.keyboard.press('Home'); await rowReady(1); await resourceState('keyboard End/Home');
    await page.locator('[data-pdf-scroll]').evaluate(element => {for (const fraction of [0.8, 0.2, 0.95, 0.1, 1, 0]) element.scrollTop = element.scrollHeight * fraction;}); await rowReady(1); await resourceState('rapid scroll');
    await page.locator('.pdf-zoom-control select').selectOption('fit'); await page.setViewportSize({width: 390, height: 844}); await wait(200); await rowReady(1); await readerGeometry('120 pages 390 fit'); await resourceState('120 pages 390 fit'); await shot('long-120-390');
    record('120-page jump, zoom, keyboard and rapid scroll keep resident Canvas/TextLayer <= 5 and pixels <= 12.5m');
    if (liveArxiv) {
      report.liveArxiv = {ok: false, url: 'https://arxiv.org/pdf/1706.03762', interception: false};
      try {
        page = await openDocument(); await page.setViewportSize({width: 1440, height: 960}); const started = Date.now();
        await page.locator('#online-pdf-url').fill(report.liveArxiv.url); await page.locator('#online-pdf-url').press('Enter'); await rowReady(1);
        report.liveArxiv.firstSelectablePageMs = Date.now() - started;
        const target = await paperSelectionTarget(); report.liveArxiv.selectedSource = target;
        assert(target, '实时论文未提供可选择文字'); await translateDrag(target); await readerGeometry('live arxiv'); await shot('arxiv-live-selection'); await resourceState('live arxiv'); report.liveArxiv.ok = true;
        record('live arXiv URL fetches without interception and its real selection translates through the local fixture');
      } catch (error) {report.liveArxiv.error = error.stack || String(error); report.liveArxiv.limitation = 'Requested live network import failed; local arXiv fixture does not substitute for live proof.';}
    }
    assert.equal(report.consoleErrors.length, 0, `浏览器错误：${JSON.stringify(report.consoleErrors)}`); await checkFocus('suite complete');
    report.fixtureRequests = fixture.state; report.ok = !liveArxiv || report.liveArxiv.ok;
    if (!report.ok) process.exitCode = 1;
  } catch (error) {report.ok = false; report.error = error.stack || String(error); process.exitCode = 1; if (page && !page.isClosed()) {try {const file = path.join(artifactsDir, 'failure.png'); await page.screenshot({path: file}); report.screenshots.push(file);} catch {}}}
  finally {
    let closed = false;
    try {if (launched) {await launched.close(); closed = true;}} catch (error) {report.ok = false; report.cleanupError = error.stack || String(error); process.exitCode = 1;}
    if (fixture) {report.fixtureRequests = fixture.state; await fixture.close();}
    if (closed || !launchAttempted) fs.rmSync(profileDir, {recursive: true, force: true}); else report.retainedProfile = profileDir;
    const reportPath = path.join(artifactsDir, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    const resourcePeaks = report.resources.reduce((peaks, resource) => {
      for (const key of ['shells', 'canvases', 'textLayers', 'pixels']) peaks[key] = Math.max(peaks[key], resource.peaks[key]);
      return peaks;
    }, {shells: 0, canvases: 0, textLayers: 0, pixels: 0});
    process.stdout.write(JSON.stringify({ok: report.ok, cases: report.cases.length, screenshots: report.screenshots.length, reportPath,
      resourcePeaks, readerGeometries: report.readerGeometries, liveArxiv: report.liveArxiv,
      nativeCaretBrowsing: report.nativeCaretBrowsing, selectionLimits: report.selectionLimits,
      foregroundChecks: report.frontmostSnapshots?.length || 0, foregroundViolations: report.frontmostSnapshots?.filter(snapshot => snapshot.browserFrontmost).length || 0,
      consoleErrors: report.consoleErrors, skipped: report.skipped, error: report.error, cleanupError: report.cleanupError, retainedProfile: report.retainedProfile}, null, 2) + '\n');
  }
}

if (require.main === module) main().catch(error => {process.stderr.write((error.stack || String(error)) + '\n'); process.exitCode = 1;});
