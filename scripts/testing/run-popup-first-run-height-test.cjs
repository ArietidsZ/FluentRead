#!/usr/bin/env node
/**
 * @file scripts/testing/run-popup-first-run-height-test.cjs
 * Verify that a fresh toolbar popup sizes itself from onboarding and main content.
 * A short emulated viewport reproduces the previous 130px CSS feedback loop;
 * the browser runs in an isolated, focus-safe profile.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');

const args = {timeout: 30000};
for (let index = 2; index < process.argv.length; index += 1) {
  const flag = process.argv[index];
  if (flag === '--background') continue;
  assert.ok(flag.startsWith('--') && process.argv[index + 1], `Invalid argument ${flag}`);
  args[flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = process.argv[++index];
}
for (const name of ['extensionDir', 'playwrightRoot', 'browserPath', 'focusSafeHelper', 'artifactsDir']) {
  assert.ok(args[name], `Missing ${name}`);
  args[name] = path.resolve(args[name]);
}
args.timeout = Number(args.timeout);
assert.ok(fs.existsSync(path.join(args.extensionDir, 'manifest.json')), 'Production extension missing');
fs.mkdirSync(args.artifactsDir, {recursive: true});

const {chromium} = createRequire(path.join(args.playwrightRoot, 'popup-height.cjs'))('playwright');
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(args.focusSafeHelper);
const report = {scope: 'fresh-popup-height', profileMode: 'new-temporary-profile', cases: [], errors: []};
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-popup-height-'));

async function inspect(page, label, selector, screenshot) {
  await page.locator(selector).waitFor({state: 'visible', timeout: args.timeout});
  await page.waitForTimeout(350);
  const geometry = await page.evaluate(selector => {
    const shell = document.querySelector('.popup-shell');
    const card = document.querySelector(selector);
    const shellRect = shell.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    return {
      viewport: {width: innerWidth, height: innerHeight},
      shell: {width: shellRect.width, height: shellRect.height, bottom: shellRect.bottom},
      card: {top: cardRect.top, bottom: cardRect.bottom},
      scrollHeight: shell.scrollHeight,
      clientHeight: shell.clientHeight,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      mainHidden: getComputedStyle(document.querySelector('.popup-content')).display === 'none',
    };
  }, selector);
  report.cases.push({label, geometry});
  assert.equal(geometry.viewport.height, 130, `${label}: constrained viewport changed`);
  assert.ok(geometry.shell.height >= 300 && geometry.shell.height <= 560, `${label}: popup locked to ${geometry.shell.height}px`);
  assert.ok(geometry.card.bottom <= geometry.shell.bottom + 1, `${label}: card clipped by popup shell`);
  assert.ok(geometry.scrollHeight <= geometry.clientHeight + 1, `${label}: initial content requires internal scrolling`);
  assert.equal(geometry.horizontalOverflow, false, `${label}: horizontal overflow`);
  assert.equal(geometry.mainHidden, label !== 'main', `${label}: wrong content visibility`);
  await page.setViewportSize({width: 400, height: 560});
  await page.screenshot({path: path.join(args.artifactsDir, screenshot)});
  await page.setViewportSize({width: 400, height: 130});
}

async function main() {
  let session;
  try {
    session = await launchFocusSafePersistentContext({
      chromium,
      profileDir,
      browserPath: args.browserPath,
      background: true,
      headless: false,
      displayTarget: 'secondary',
      viewport: {width: 1280, height: 900},
      timeout: args.timeout,
      browserArgs: [
        `--disable-extensions-except=${args.extensionDir}`,
        `--load-extension=${args.extensionDir}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    Object.assign(report, {
      launchMode: session.launchMode,
      focusPolicy: session.focusPolicy,
      windowPlacement: session.windowPlacement,
    });
    assert.equal(session.launchMode, 'macos-background-cdp');
    assert.equal(session.focusPolicy, 'launchservices-no-foreground');
    const {context} = session;
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: args.timeout});
    const popup = await newPageWithoutForeground(context, args.timeout);
    popup.on('pageerror', error => report.errors.push(`pageerror: ${error.message}`));
    popup.on('console', message => {
      if (message.type() === 'error') report.errors.push(`console: ${message.text()}`);
    });
    await popup.setViewportSize({width: 400, height: 130});
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`, {waitUntil: 'domcontentloaded', timeout: args.timeout});
    await popup.locator('.popup-shell[data-config-ready="true"]').waitFor({state: 'visible', timeout: args.timeout});
    await inspect(popup, 'welcome', '.language-onboarding-card', 'welcome.png');
    await popup.locator('[data-testid="onboarding-language-next"]').click();
    await inspect(popup, 'language', '.language-onboarding-card', 'language.png');
    await popup.locator('.onboarding-form .onboarding-confirm').click();
    await popup.locator('[data-testid="ui-language-onboarding"]').waitFor({state: 'detached', timeout: args.timeout});
    await inspect(popup, 'main', '.popup-content', 'main.png');
    assert.deepEqual(report.errors, [], `Popup console errors: ${report.errors.join('; ')}`);
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.errors.push(error.stack || String(error));
    throw error;
  } finally {
    fs.writeFileSync(path.join(args.artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    if (session) await session.close();
    fs.rmSync(profileDir, {recursive: true, force: true});
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
