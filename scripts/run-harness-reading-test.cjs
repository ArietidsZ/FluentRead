#!/usr/bin/env node
// 在隔离、可见但不抢焦点的 Edge profile 中验证 ReadingPanel 与真实 Harness gateway。
// 本脚本只操作临时 profile；fixture API 只模拟 OpenAI-compatible HTTP，不替换扩展后台处理。
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
function arg(argv, name, fallback) { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; }
function parseArgs(argv) {
    const out = {
        extensionDir: path.resolve(arg(argv, 'extension-dir', '.output/chrome-mv3')),
        playwrightRoot: arg(argv, 'playwright-root', process.env.PLAYWRIGHT_ROOT),
        artifactsDir: path.resolve(arg(argv, 'artifacts-dir', path.join(os.tmpdir(), 'fluentread-harness-reading-test'))),
        browserPath: arg(argv, 'browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
        focusSafeHelper: arg(argv, 'focus-safe-helper', ''), persistenceOnly: argv.includes('--persistence-only'), headed: argv.includes('--headed'),
    };
    if (!out.playwrightRoot)
        throw new Error('必须传入 --playwright-root');
    if (!fs.existsSync(path.join(out.extensionDir, 'manifest.json')))
        throw new Error(`找不到扩展产物：${out.extensionDir}`);
    if (!out.headed && !out.focusSafeHelper)
        throw new Error('后台模式必须传入 --focus-safe-helper');
    return out;
}
function loadPlaywright(root) { try {
    return require('playwright');
}
catch {
    return createRequire(path.join(path.resolve(root), '__harness_runner__.cjs'))('playwright');
} }
function assert(ok, message) { if (!ok)
    throw new Error(message); }
function parseStored(value) { if (typeof value !== 'string')
    return value || {}; try {
    return JSON.parse(value) || {};
}
catch {
    return {};
} }
async function send(page, message) { return page.evaluate((request) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`消息超时: ${request.type}`)), 10000); chrome.runtime.sendMessage(request, (response) => { const error = chrome.runtime.lastError?.message; clearTimeout(timer); error ? reject(new Error(error)) : resolve(response); }); }), message); }
async function readConfig(page) { const [configResponse, credentialResponse] = await Promise.all([send(page, { type: 'configStorageRead', key: 'local:config' }), send(page, { type: 'configStorageRead', key: 'local:credentials' })]); assert(configResponse?.success === true && credentialResponse?.success === true, `配置读取失败: ${JSON.stringify({ configResponse, credentialResponse })}`); const config = parseStored(configResponse.value); const credentials = parseStored(credentialResponse.value); return { ...config, ...credentials }; }
async function persistConfig(page, patch) {
    const current = await readConfig(page);
    const response = await send(page, { type: 'persistConfig', config: { ...current, ...patch }, clientId: `harness-fixture-${process.pid}`, sequence: Date.now(), baseRevision: current.__fluentConfigRevision });
    assert(response?.success === true, `配置保存失败: ${JSON.stringify(response)}`);
    await page.waitForTimeout(400);
    return readConfig(page);
}
function cdpChildren(node) { return [...(node?.children || []), ...(node?.shadowRoots || []), ...(node?.contentDocument ? [node.contentDocument] : [])]; }
function attr(node, name) { const a = node?.attributes || []; for (let i = 0; i < a.length; i += 2)
    if (a[i] === name)
        return a[i + 1] || ''; return ''; }
function find(node, predicate) { if (!node)
    return null; if (predicate(node))
    return node; for (const child of cdpChildren(node)) {
    const hit = find(child, predicate);
    if (hit)
        return hit;
} return null; }
function text(node) { return !node ? '' : node.nodeName === '#text' ? node.nodeValue || '' : cdpChildren(node).map(text).join(''); }
async function shadowSnapshot(page) { const session = await page.context().newCDPSession(page); const { root } = await session.send('DOM.getDocument', { depth: -1, pierce: true }); const host = find(root, n => attr(n, 'id') === 'fluent-read-selection-translator-container'); return { host, text: text(host), session }; }
async function clickShadowButton(page, label) { const { host, session } = await shadowSnapshot(page); const buttons = []; const collect = node => { if (!node)
    return; if (node.nodeName?.toLowerCase() === 'button')
    buttons.push({ aria: attr(node, 'aria-label'), text: text(node).trim(), nodeId: node.nodeId }); for (const child of cdpChildren(node))
    collect(child); }; collect(host); const button = find(host, n => n.nodeName?.toLowerCase() === 'button' && (attr(n, 'aria-label') === label || text(n).trim() === label)); assert(button?.nodeId, `找不到闭合 Shadow 按钮: ${label}; buttons=${JSON.stringify(buttons)}`); const box = await session.send('DOM.getBoxModel', { nodeId: button.nodeId }); const quad = box.model?.content || box.model?.border; assert(quad?.length >= 8, `按钮没有可点击几何位置: ${label}; box=${JSON.stringify(box)}`); const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4; const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4; await session.send('DOM.focus', { nodeId: button.nodeId }).catch(() => { }); await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' }); await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); return { buttons, x, y }; }
async function fillShadowInput(page, label, value) { const { host, session } = await shadowSnapshot(page); const input = find(host, n => n.nodeName?.toLowerCase() === 'input' && attr(n, 'aria-label') === label); assert(input?.nodeId, `找不到闭合 Shadow 输入框: ${label}`); const resolved = await session.send('DOM.resolveNode', { nodeId: input.nodeId }); await session.send('Runtime.callFunctionOn', { objectId: resolved.object.objectId, functionDeclaration: `function(value) { this.focus(); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(this, value); this.dispatchEvent(new Event('input', {bubbles: true})); }`, arguments: [{ value }] }); await session.send('Runtime.releaseObject', { objectId: resolved.object.objectId }).catch(() => { }); }
async function selectText(page, selector, end = 42) { return page.evaluate(({ selector, end }) => { const node = document.querySelector(selector)?.firstChild; if (!node)
    throw new Error(`找不到文本: ${selector}`); const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, Math.min(end, node.textContent.length)); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection.toString(); }, { selector, end }); }
async function main() {
    const args = parseArgs(process.argv.slice(2));
    fs.mkdirSync(args.artifactsDir, { recursive: true });
    const { chromium } = loadPlaywright(args.playwrightRoot);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-harness-edge-'));
    let context;
    let close = async () => context?.close();
    let newPage = () => context.newPage();
    const requests = [];
    let responseDelayMs = 0;
    const server = http.createServer(async (req, res) => {
        if (req.method === 'GET' && req.url === '/favicon.ico') {
            res.writeHead(204).end();
            return;
        }
        if (req.method === 'GET' && req.url === '/fixture') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Harness fixture</title></head><body><main><p id="target">Although the task was difficult, she finished it on time.</p><p id="neighbor">A neighboring paragraph must remain untouched.</p><nav id="navigation">Hidden navigation metadata</nav><input id="input" value="form text"></main></body></html>');
            return;
        }
        if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
            res.writeHead(404).end();
            return;
        }
        const chunks = [];
        for await (const chunk of req)
            chunks.push(chunk);
        let body = {};
        try {
            body = JSON.parse(Buffer.concat(chunks).toString());
        }
        catch { }
        requests.push(body);
        const delay = responseDelayMs;
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
        const toolRound = hasTools && requests.filter(item => Array.isArray(item.tools) && item.tools.length > 0).length === 1;
        const message = toolRound ? { role: 'assistant', tool_calls: [{ id: 'fixture-read-context', type: 'function', function: { name: 'read_context', arguments: '{}' } }] } : { role: 'assistant', content: delay ? '迟到的旧回答' : '这句话表示：虽然任务很难，她仍然按时完成了。' };
        res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(JSON.stringify({ id: 'harness-fixture', choices: [{ index: 0, message, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 9, total_tokens: 21 } }));
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    const result = { ok: false, extensionDir: args.extensionDir, browser: 'Microsoft Edge', launchMode: null, focusPolicy: null, windowPlacement: null, cases: [], caseCoverage: {}, screenshots: [], consoleErrors: [], httpErrors: [], apiRequests: requests, persistenceCases: [], quickClose: {}, crossPageSync: {}, latestWriteWins: {} };
    const record = (id, status, details = {}) => { const item = { id, status, ...details }; result.cases.push(item); result.caseCoverage[id] = item; return item; };
    try {
        const browserArgs = [`--disable-extensions-except=${args.extensionDir}`, `--load-extension=${args.extensionDir}`, '--no-first-run', '--no-default-browser-check'];
        if (!args.headed) {
            const helper = require(path.resolve(args.focusSafeHelper));
            const session = await helper.launchFocusSafePersistentContext({ chromium, profileDir: profile, browserPath: args.browserPath, headless: false, background: true, browserArgs, viewport: { width: 1280, height: 900 } });
            context = session.context;
            close = session.close;
            newPage = () => helper.newPageWithoutForeground(context);
            Object.assign(result, { launchMode: session.launchMode, focusPolicy: session.focusPolicy, windowPlacement: session.windowPlacement });
        }
        else {
            context = await chromium.launchPersistentContext(profile, { executablePath: args.browserPath, headless: false, args: browserArgs, viewport: { width: 1280, height: 900 } });
            result.launchMode = 'playwright-headed';
            result.focusPolicy = 'foreground-authorized';
            result.windowPlacement = { mode: 'headed-explicit-foreground' };
        }
        context.on('response', response => { if (response.status() >= 400)
            result.httpErrors.push({ status: response.status(), url: response.url() }); });
        context.on('page', target => { target.on('console', message => { if (message.type() === 'error')
            result.consoleErrors.push(`context: ${message.text()} @ ${message.location().url}`); }); });
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 30000 });
        const extensionId = worker.url().match(/^chrome-extension:\/\/([^/]+)/)[1];
        result.extensionId = extensionId;
        const configPage = await newPage();
        configPage.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon.ico'))
            result.consoleErrors.push(`config: ${m.text()}`); });
        await configPage.goto(`chrome-extension://${extensionId}/options.html#settings-harness`, { waitUntil: 'domcontentloaded' });
        await configPage.waitForTimeout(1200);
        const fixtureUrl = `http://127.0.0.1:${port}/fixture`;
        await persistConfig(configPage, { service: 'openai', customOpenAIProviders: [{ id: 'custom:fixture', name: 'Local fixture', endpoint: `http://127.0.0.1:${port}/v1/chat/completions`, models: ['learning-fixture'] }], token: { 'custom:fixture': 'fixture-token' }, model: { 'custom:fixture': 'learning-fixture' }, harness: { enabled: false, service: 'custom:fixture', model: 'learning-fixture', defaultAction: 'meaning', actions: ['meaning', 'grammar', 'usage', 'practice'], contextMode: 'paragraph', maxContextChars: 1500, explanationDepth: 'concise', learningLevel: 'intermediate' } });
        const page = await newPage();
        page.on('pageerror', e => result.consoleErrors.push(e.message));
        page.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon.ico'))
            result.consoleErrors.push(m.text()); });
        await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        if (!args.persistenceOnly) {
        const disabled = await shadowSnapshot(page);
        record('disabled-no-entry', disabled.host ? 'failed' : 'passed');
        const config = await readConfig(configPage);
        await persistConfig(configPage, { harness: { ...config.harness, enabled: true, service: 'custom:fixture', model: 'learning-fixture' } });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        const beforeSelection = requests.length;
        const targetBox = await page.locator('#target').boundingBox();
        assert(targetBox && targetBox.width > 20 && targetBox.height > 10, '目标段落没有有效几何位置');
        await page.mouse.move(targetBox.x + 8, targetBox.y + targetBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(Math.min(targetBox.x + targetBox.width - 8, targetBox.x + 420), targetBox.y + targetBox.height / 2, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(700);
        const actualSelection = await page.evaluate(() => getSelection()?.toString().trim() || '');
        assert(actualSelection && /lthough the task was difficult/.test(actualSelection) && !actualSelection.includes('WXT Shadow Root'), `真实选区未落在目标文本: ${actualSelection.slice(0, 180)}`);
        const selected = await shadowSnapshot(page);
        assert(selected.host, '启用 Harness 后没有 closed Shadow UI');
        assert(requests.length === beforeSelection, '仅选择文本就发起了 Harness 请求');
        record('selection-entry-visible-no-request', 'passed', { selectedText: actualSelection });
        const before = requests.length;
        const clickInfo = await clickShadowButton(page, '理解选中文本');
        await page.waitForTimeout(1200);
        assert(requests.length > before, `点击理解没有经过真实 gateway 发请求: ${JSON.stringify({ clickInfo, after: (await shadowSnapshot(page)).text.slice(-400) })}`);
        record('click-sends-request', 'passed', { requestCount: requests.length });
        assert(requests.some(item => item.messages?.some(message => message.role === 'tool')), '段落工具没有完成配对回合');
        for (const action of ['拆句', '用法', '练习']) {
            const beforeAction = requests.length;
            await clickShadowButton(page, action);
            await page.waitForTimeout(700);
            assert(requests.length > beforeAction, `${action} 没有产生请求`);
            record(`action-${action}`, 'passed');
        }
        const { host: followHost } = await shadowSnapshot(page);
        const followInput = find(followHost, n => n.nodeName?.toLowerCase() === 'input' && attr(n, 'aria-label') === '继续追问');
        assert(followInput?.nodeId, '找不到继续追问输入框');
        const beforeFollowup = requests.length;
        await fillShadowInput(page, '继续追问', '为什么使用 although？');
        await clickShadowButton(page, '发送追问');
        await page.waitForTimeout(1000);
        assert(requests.length > beforeFollowup, '继续追问没有提交请求');
        assert(requests.at(-1).messages.filter(message => message.role === 'user').length >= 2 && JSON.stringify(requests.at(-1)).includes('为什么使用 although？'), '追问没有携带真实问答历史');
        record('followup-submit-history', 'passed', { requestCount: requests.length });
        responseDelayMs = 1800;
        const beforeCancel = requests.length;
        await clickShadowButton(page, '练习');
        await page.waitForTimeout(150);
        await clickShadowButton(page, '停止');
        await page.waitForTimeout(2200);
        const cancelled = await shadowSnapshot(page);
        assert(requests.length > beforeCancel && !cancelled.text.includes('迟到的旧回答') && cancelled.text.includes('已停止'), '取消后迟到结果仍覆盖阅读卡');
        responseDelayMs = 0;
        record('cancel-delayed-result-does-not-overwrite', 'passed', { requestCount: requests.length });
        await page.evaluate(() => getSelection()?.removeAllRanges());
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        const targetBox2 = await page.locator('#target').boundingBox();
        assert(targetBox2, '换选区目标没有几何位置');
        await page.mouse.move(targetBox2.x + 8, targetBox2.y + targetBox2.height / 2);
        await page.mouse.down();
        await page.mouse.move(targetBox2.x + 260, targetBox2.y + targetBox2.height / 2, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(500);
        const firstSelection = await page.evaluate(() => getSelection()?.toString().trim() || '');
        responseDelayMs = 1800;
        await clickShadowButton(page, '理解选中文本');
        await page.waitForTimeout(150);
        responseDelayMs = 0;
        await page.evaluate(() => getSelection()?.removeAllRanges());
        const neighborBox = await page.locator('#neighbor').boundingBox();
        assert(neighborBox, '换选区邻段没有几何位置');
        await page.mouse.move(neighborBox.x + 8, neighborBox.y + neighborBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(neighborBox.x + 220, neighborBox.y + neighborBox.height / 2, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(500);
        const secondSelection = await page.evaluate(() => getSelection()?.toString().trim() || '');
        assert(firstSelection && secondSelection && !secondSelection.includes(firstSelection), '快速换选区没有产生新选区');
        await clickShadowButton(page, '理解选中文本');
        await page.waitForTimeout(2200);
        const freshCard = await shadowSnapshot(page);
        assert(freshCard.text.includes(secondSelection) && !freshCard.text.includes('迟到的旧回答'), '旧选区的迟到回答覆盖了新卡片');
        record('switch-selection-staleness', 'passed', { firstSelection, secondSelection });
        await persistConfig(configPage, { harness: { ...(await readConfig(configPage)).harness, contextMode: 'selection' } });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        const selectionBox = await page.locator('#target').boundingBox();
        await page.mouse.move(selectionBox.x + 8, selectionBox.y + selectionBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(selectionBox.x + 260, selectionBox.y + selectionBox.height / 2, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(500);
        const selectionOnlyBefore = requests.length;
        await clickShadowButton(page, '理解选中文本');
        await page.waitForTimeout(1000);
        const selectionOnlyRequest = requests.slice(selectionOnlyBefore).find(item => item.messages?.some(message => message.role === 'user'));
        assert(selectionOnlyRequest && !JSON.stringify(selectionOnlyRequest).includes('neighbor') && !JSON.stringify(selectionOnlyRequest).includes('Hidden navigation'), 'selection-only 请求带入了段落或隐藏内容');
        assert(!selectionOnlyRequest.tools?.length && !JSON.stringify(selectionOnlyRequest).includes('finished it on time.'), 'selection-only 请求包含未选中的同段内容或工具');
        record('selection-only-no-paragraph', 'passed');
        const settingsPage = await newPage();
        settingsPage.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon.ico'))
            result.consoleErrors.push(`settings: ${m.text()}`); });
        await settingsPage.goto(`chrome-extension://${extensionId}/options.html#settings-harness`, { waitUntil: 'domcontentloaded' });
        await settingsPage.waitForTimeout(1200);
        const settingsState = await settingsPage.evaluate(() => ({ section: document.querySelector('#settings-harness')?.getAttribute('style') || '', moreOpen: document.querySelector('.harness-more')?.hasAttribute('open') || false }));
        assert(settingsState.moreOpen === false, '更多偏好默认未折叠');
        await settingsPage.screenshot({ path: path.join(args.artifactsDir, 'harness-settings-1280.png') });
        result.screenshots.push(path.join(args.artifactsDir, 'harness-settings-1280.png'));
        record('settings-page-and-persistence', 'passed', { section: 'settings-harness', moreOpen: settingsState.moreOpen });
        await settingsPage.setViewportSize({ width: 390, height: 844 });
        assert(await settingsPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390px设置页横向溢出');
        await settingsPage.screenshot({ path: path.join(args.artifactsDir, 'harness-settings-390.png') });
        result.screenshots.push(path.join(args.artifactsDir, 'harness-settings-390.png'));
        record('settings-narrow-390', 'passed');
        await settingsPage.emulateMedia({ colorScheme: 'dark' });
        await settingsPage.waitForFunction(() => document.documentElement.classList.contains('dark'));
        await settingsPage.screenshot({ path: path.join(args.artifactsDir, 'harness-settings-dark.png') });
        result.screenshots.push(path.join(args.artifactsDir, 'harness-settings-dark.png'));
        record('settings-dark', 'passed');
        await settingsPage.close();
        await persistConfig(configPage, { harness: { ...(await readConfig(configPage)).harness, contextMode: 'paragraph' } });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        const sentenceBox = await page.locator('#target').boundingBox();
        await page.mouse.move(sentenceBox.x + 8, sentenceBox.y + sentenceBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(sentenceBox.x + 180, sentenceBox.y + sentenceBox.height / 2, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(500);
        const sentenceBefore = requests.length;
        await clickShadowButton(page, '理解选中文本');
        await page.waitForTimeout(400);
        await clickShadowButton(page, '理解整句');
        await page.waitForTimeout(1000);
        const sentenceRequest = requests.slice(sentenceBefore).filter(item => item.messages?.some(message => message.role === 'user')).at(-1);
        assert(sentenceRequest && JSON.stringify(sentenceRequest).includes('Although the task was difficult, she finished it on time.'), '理解整句请求未使用完整句子');
        record('expand-sentence-sends-full-sentence', 'passed');
        await persistConfig(configPage, { selectionTranslatorMode: 'bilingual', disableSelectionTranslator: false, harness: { ...(await readConfig(configPage)).harness, contextMode: 'selection' } });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        const dualBox = await page.locator('#target').boundingBox();
        await page.mouse.move(dualBox.x + 8, dualBox.y + dualBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(dualBox.x + 180, dualBox.y + dualBox.height / 2, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(500);
        const dualSnapshot = await shadowSnapshot(page);
        assert(dualSnapshot.text.includes('理解') && dualSnapshot.text.includes('翻译'), 'Harness 与原有划词入口未同时可用');
        record('harness-and-legacy-selection-entry', 'passed');
        await page.mouse.move(dualBox.x + 1, dualBox.y + dualBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(dualBox.x + dualBox.width - 1, dualBox.y + dualBox.height / 2, {steps: 10});
        await page.mouse.up();
        await page.waitForTimeout(500);
        await clickShadowButton(page, '理解选中文本');
        await page.waitForTimeout(900);
        const screenshot = path.join(args.artifactsDir, 'harness-reading-panel.png');
        const {host: cardHost, session: cardSession} = await shadowSnapshot(page);
        const card = find(cardHost, node => attr(node, 'class').split(' ').includes('fr-translation-tooltip'));
        const {model: cardBox} = await cardSession.send('DOM.getBoxModel', {nodeId: card.nodeId});
        const quad = cardBox.border;
        await page.screenshot({path: screenshot, clip: {x: quad[0], y: quad[1], width: quad[2] - quad[0], height: quad[5] - quad[1]}});
        result.screenshots.push(screenshot);
        } else {
            await persistConfig(configPage, {harness: {...(await readConfig(configPage)).harness, enabled: true, contextMode: 'selection'}});
        }
        const uiPersistPage = await newPage();
        uiPersistPage.on('console', message => {if (message.type() === 'warning') (result.warnings ||= []).push(message.text())});
        await uiPersistPage.goto(`chrome-extension://${extensionId}/options.html#settings-harness`, { waitUntil: 'domcontentloaded' });
        await uiPersistPage.waitForTimeout(1000);
        const enabledSwitch = uiPersistPage.getByRole('switch', { name: '启用 Harness' });
        const beforeSwitch = await enabledSwitch.getAttribute('aria-checked');
        assert(beforeSwitch === 'true', '持久化测试起始开关应开启');
        await enabledSwitch.locator('xpath=ancestor::*[contains(@class, "el-switch")][1]').locator('.el-switch__core').click();
        await uiPersistPage.waitForFunction(() => document.querySelector('[role="switch"][aria-label="启用 Harness"]')?.getAttribute('aria-checked') === 'false');
        await uiPersistPage.getByText('更多偏好', { exact: true }).click();
        await uiPersistPage.getByRole('radio', { name: '当前段落' }).click();
        await uiPersistPage.waitForTimeout(900);
        result.persistenceBeforeClose = {harness: (await readConfig(uiPersistPage)).harness, checked: await enabledSwitch.getAttribute('aria-checked')};
        await uiPersistPage.close();
        const reopened = await newPage();
        await reopened.goto(`chrome-extension://${extensionId}/options.html#settings-harness`, { waitUntil: 'domcontentloaded' });
        await reopened.waitForTimeout(1000);
        const reopenedSwitch = reopened.getByRole('switch', { name: '启用 Harness' });
        const reopenedConfig = await readConfig(reopened);
        const switchState = await reopenedSwitch.getAttribute('aria-checked');
        result.persistenceAfterReopen = {harness: reopenedConfig.harness, checked: switchState};
        assert(switchState === 'false' && reopenedConfig.harness.enabled === false && reopenedConfig.harness.contextMode === 'paragraph', '设置 UI 修改关闭重开后未持久化');
        const persistence = record('settings-ui-modify-close-reopen', 'passed', { before: {enabled: true, contextMode: 'selection'}, after: {enabled: false, contextMode: 'paragraph'}, uiChecked: switchState });
        result.persistenceCases.push(persistence);
        await reopened.screenshot({path: path.join(args.artifactsDir, 'harness-settings-reopened.png')});
        await page.reload({waitUntil: 'domcontentloaded'});
        await page.waitForTimeout(500);
        const resumedConfig = await readConfig(configPage);
        assert(resumedConfig.harness.enabled === false, '关闭重开后其他设置页没有同步');
        result.crossPageSync = {passed: true};
        result.quickClose = {executed: false};
        result.latestWriteWins = {executed: false};
        await reopened.close();
        result.apiRequests = requests;
        result.ok = result.cases.every(item => item.status === 'passed') && result.consoleErrors.length === 0 && result.httpErrors.length === 0;
        fs.writeFileSync(path.join(args.artifactsDir, 'report.json'), `${JSON.stringify(result, null, 2)}\n`);
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (!result.ok)
            process.exitCode = 1;
    }
    catch (error) {
        result.error = error.stack || error.message;
        fs.writeFileSync(path.join(args.artifactsDir, 'report.json'), `${JSON.stringify(result, null, 2)}\n`);
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        process.exitCode = 1;
    }
    finally {
        await close().catch(() => { });
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(profile, { recursive: true, force: true });
    }
}
main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
