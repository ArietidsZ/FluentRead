'use strict';
/**
 * @file scripts/testing/run-custom-headers-ui-test.cjs
 * 文件职责：在隔离 Edge 中复现 issue #522，自定义服务保存稳定会话头后通过真实 HTTP 连接检查。
 * 主要内容：创建两项服务、配置并重开设置、检查请求头与请求体隔离、非法输入和清空恢复，并输出截图及报告。
 * 模块边界：仅使用临时 profile 和本地模拟模型，不访问用户浏览器或真实付费服务；依赖 focus-safe helper。
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const arg = (name, fallback) => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1]; };
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-issue522-ui'));
const {chromium} = require(path.join(arg('playwright-root', ''), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper', ''));
fs.mkdirSync(artifactsDir, {recursive: true});
const report = {extensionDir, providerEvidence: 'local-http-mock-model', cases: [], requests: [], consoleErrors: []};
let launched;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    report.requests.push({path: req.url, headers: req.headers, body: JSON.parse(body)});
    res.writeHead(200, {'content-type': 'application/json', 'access-control-allow-origin': '*'});
    res.end(JSON.stringify({id: 'fixture', object: 'chat.completion', created: 1, model: 'fixture', choices: [{index: 0, message: {role: 'assistant', content: '连接成功'}, finish_reason: 'stop'}], usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2}}));
  });
});
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-issue522-'));
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/v1/chat/completions`;
  launched = await launchFocusSafePersistentContext({chromium, profileDir,
    browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: false, background: true,
    browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check'],
    viewport: {width: 1440, height: 1000}, timeout: 30000,
  });
  Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
  const context = launched.context;
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const origin = new URL(worker.url()).origin;
  const url = `${origin === 'null' ? `chrome-extension://${new URL(worker.url()).host}` : origin}/options.html#settings-services`;
  let page;
  async function open() {
    page = await newPageWithoutForeground(context);
    page.on('pageerror', e => report.consoleErrors.push(e.message));
    await page.goto(url);
    await page.locator('.service-catalog').waitFor();
  }
  async function add(name) {
    await page.getByTestId('custom-service-add').click();
    await page.getByTestId('custom-service-name').fill(name);
    await page.getByTestId('custom-service-endpoint').fill(endpoint);
    await page.getByTestId('custom-service-api-key').fill('fixture-default-token');
    await page.getByTestId('custom-service-model').fill('fixture');
    await page.getByTestId('custom-service-save').click();
    await page.getByTestId('custom-service-dialog').waitFor({state: 'hidden'});
  }
  async function select(name) {
    await page.locator('[data-service-section="custom"] [data-service-value]').filter({hasText: name}).click();
    const advanced = page.locator('[data-configuration-group="advanced"]');
    const customRequest = advanced.locator('[data-configuration-group="custom-request"]');
    if (!await advanced.getAttribute('open').then(x => x !== null)) await advanced.locator('summary').click();
    return customRequest.getByTestId('custom-service-headers').locator('textarea');
  }
  async function check() {
    const before = report.requests.length;
    await page.locator('.detail-hero [data-connection-test-button]').last().click();
    await page.locator('[data-api-key-list] .api-key-state.is-success').waitFor({timeout: 30000});
    assert.equal(report.requests.length, before + 1);
    return report.requests.at(-1);
  }
  await open();
  await add('Issue 522 A');
  const input = await select('Issue 522 A');
  const value = JSON.stringify({'x-opencode-session': 'stable-ui-session', Authorization: 'Bearer fixture-header-token', 'X-Title': 'Fixture'});
  await input.fill(value);
  const first = await check();
  assert.equal(first.headers['x-opencode-session'], 'stable-ui-session');
  assert.equal(first.headers.authorization, 'Bearer fixture-header-token');
  assert(!JSON.stringify(first.body).includes('stable-ui-session'));
  report.cases.push('connection-test-sends-headers-separately-from-body');
  await page.close(); await open();
  const reopened = await select('Issue 522 A');
  assert.equal(await reopened.inputValue(), value);
  assert.equal((await check()).headers['x-opencode-session'], 'stable-ui-session');
  report.cases.push('close-reopen-persistence-and-stable-session');
  await reopened.scrollIntoViewIfNeeded();
  await page.screenshot({path: path.join(artifactsDir, 'custom-headers-persisted.png')});
  await add('Issue 522 B');
  assert.equal(await (await select('Issue 522 B')).inputValue(), '');
  const other = await check();
  assert.equal(other.headers['x-opencode-session'], undefined);
  assert.equal(other.headers.authorization, 'Bearer fixture-default-token');
  report.cases.push('second-service-isolated');
  const headers = await select('Issue 522 A');
  await headers.fill('{"x-invalid": 42}');
  await page.getByTestId('custom-service-headers').locator('.error-text').waitFor();
  const count = report.requests.length;
  await page.locator('.detail-hero [data-connection-test-button]').last().click();
  await page.locator('[data-api-key-list] .api-key-state.is-error').waitFor();
  assert.equal(report.requests.length, count);
  report.cases.push('invalid-header-blocks-network');
  await headers.fill('');
  assert.equal((await check()).headers.authorization, 'Bearer fixture-default-token');
  report.cases.push('clearing-restores-default-headers');
  await headers.fill(value);
  await check();
  await page.setViewportSize({width: 820, height: 900});
  await headers.scrollIntoViewIfNeeded();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({path: path.join(artifactsDir, 'custom-headers-narrow.png')});
  report.cases.push('narrow-layout-no-page-overflow');
  assert.equal(report.consoleErrors.length, 0);
  report.status = 'passed';
}
main().catch(error => {report.status = 'failed'; report.error = error.stack; process.exitCode = 1;})
  .finally(async () => {
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    await launched?.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profileDir, {recursive: true, force: true});
    console.log(JSON.stringify({status: report.status, cases: report.cases, error: report.error, artifactsDir}, null, 2));
  });
