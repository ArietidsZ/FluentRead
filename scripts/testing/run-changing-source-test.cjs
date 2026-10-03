#!/usr/bin/env node
'use strict';

// 用生产扩展、真实按键和本地确定性翻译验证动态来源收敛；隔离 profile，不抢用户焦点。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {startTranslationFixtureServer, installTranslationFixtureOnWorker} = require('../run-full-page-translation-test.cjs');
const argument = (name, fallback) => {const index = process.argv.indexOf(`--${name}`); return index < 0 ? fallback : process.argv[index + 1];};
const extensionDir = path.resolve(argument('extension-dir', '.output/chrome-mv3'));
const artifactsDir = path.resolve(argument('artifacts-dir', '/private/tmp/fluentread-changing-source'));
const {chromium} = require(path.join(argument('playwright-root'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground} = require(argument('focus-safe-helper', path.join(os.homedir(), '.codex/skills/fluentread-browser-translation-test/scripts/focus-safe-browser.cjs')));
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-changing-source-'));
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Dynamic source fixture</title>
<style>body{font:18px/1.7 system-ui;margin:40px}main{max-width:900px}p{margin:12px 0}#probe{position:fixed;right:20px;top:20px}</style>
<button id="probe" translate="no">Host click</button><main>
<p id="clock">12:34 PM</p><p id="duration">5 minutes</p><p id="number">1,234.56</p>
<p id="split-timer" role="timer"><span>5</span> minutes <span>12</span> seconds</p>
<p id="normal">The task takes 5 minutes and processes 123 records.</p>
<p id="neighbor">Readers can continue reading this stable neighboring paragraph.</p>
<p id="counter">Visitors: 100</p><p id="changing">Processing the first section.</p>
<p id="inline">This stable paragraph includes <span id="inline-number">99</span> records and a timer <time>2 minutes ago</time>.</p>
</main><script>window.probeClicks=0;document.querySelector('#probe').onclick=()=>window.probeClicks++;</script></html>`;
const server = http.createServer((_request, response) => {response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});response.end(html);});
const report = {ok: false, extensionDir, evidenceBoundary: 'Production extension, isolated real Edge, deterministic local Microsoft transport; no live-provider or Firefox runtime claims.', cases: [], errors: []};
fs.mkdirSync(artifactsDir, {recursive: true});

(async () => {
    let launched, provider;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        provider = await startTranslationFixtureServer([], 250);
        launched = await launchFocusSafePersistentContext({chromium, profileDir, background: true, headless: false,
            browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', viewport: {width:1280, height:900},
            browserArgs: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--no-first-run', '--no-default-browser-check']});
        Object.assign(report, {launchMode: launched.launchMode, focusPolicy: launched.focusPolicy, windowPlacement: launched.windowPlacement});
        assert.equal(launched.launchMode, 'macos-background-cdp');
        assert.equal(launched.windowPlacement.browserFrontmost, false);
        const {context} = launched;
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout:30000});
        const install = item => installTranslationFixtureOnWorker(item, {translationUrl:provider.translationUrl, blockedUrl:provider.blockedUrl});
        await install(worker);
        context.on('serviceworker', item => {void install(item).catch(error => report.errors.push(String(error)));});
        const origin = `chrome-extension://${new URL(worker.url()).host}`;
        const setup = await newPageWithoutForeground(context);
        await setup.goto(`${origin}/icon/128.png`);
        let sequence = 0;
        const configure = patch => setup.evaluate(async ({patch, sequence}) => {
            const current = await chrome.runtime.sendMessage({type:'configStorageRead', key:'local:config'});
            const saved = await chrome.runtime.sendMessage({type:'persistConfig', mode:'patch', config:patch,
                expected:Object.fromEntries(Object.keys(patch).map(key => [key,current.value[key]])),
                clientId:'changing-source-fixture', sequence, baseRevision:current.value.__fluentConfigRevision || 0});
            if (!saved?.success) throw new Error(saved?.error || 'Fixture config failed');
        }, {patch, sequence: ++sequence});
        await configure({on:true, service:'microsoft', hoverTranslationService:'microsoft', to:'zh-Hans', from:'en', display:1,
            fullPageTranslationMode:'all', translationScope:'all', useCache:false, enableAIContext:false, enableAIMultiSegment:false,
            glossaryEnabled:false, autoTranslate:false, hotkey:'Control', floatingBallHotkey:'Alt+T',
            uiLanguage:'zh-CN', uiLanguageSetupCompleted:true, translationRequestsPerSecond:0, translationRequestsPerMinute:0});
        for (const mode of ['bilingual', 'single']) {
            await configure({display:mode === 'bilingual' ? 1 : 0, fullPageTranslationMode:mode === 'bilingual' ? 'all' : 'viewport'});
            const page = await newPageWithoutForeground(context);
            page.on('pageerror', error => report.errors.push(error.message));
            await page.goto(`http://127.0.0.1:${server.address().port}/${mode}`);
            await page.locator('#fluent-read-page-styles').waitFor({state:'attached'});
            await activateExtensionTabWithoutForeground(context, page);
            await page.waitForTimeout(500);
            const selector = mode === 'bilingual' ? '.fluent-read-bilingual-content' : '.fluent-read-single-slot';
            await page.keyboard.press('Alt+t');
            await page.locator(`#normal ${selector}`).waitFor({state:'attached'});
            await page.locator(`#counter ${selector}`).waitFor({state:'attached'});
            await page.locator(`#changing ${selector}`).waitFor({state:'attached'});
            await page.waitForTimeout(700);
            for (const id of ['clock','duration','number','split-timer']) {
                assert.equal(await page.locator(`#${id} ${selector}`).count(),0, `${mode} ${id} must stay original`);
            }
            const baselineItems = provider.translatedItemCount();
            await page.evaluate(() => {
                window.__stableArtifact = document.querySelector('#neighbor .fluent-read-bilingual-content, #neighbor .fluent-read-single-slot');
                window.__changes = [];
                const counter = document.querySelector('#counter');
                const changing = document.querySelector('#changing');
                let value = 101;
                window.__interval = setInterval(() => {
                    // 保留宿主来源 Text 身份，覆盖 characterData；每隔一次替换整个 Text，覆盖 childList。
                    const write = (owner, text) => {
                        const source = owner.querySelector('.fluent-read-single-slot')?.firstChild || owner.firstChild;
                        if (value % 2) source.nodeValue = text;
                        else source.replaceWith(document.createTextNode(text));
                    };
                    write(counter, `Visitors: ${value}`);
                    write(changing, `Processing section number ${value}.`);
                    document.querySelector('#inline-number').textContent = String(value);
                    window.__changes.push({counterArtifacts: counter.querySelectorAll('.fluent-read-bilingual-content,.fluent-read-single-slot').length,
                        changingArtifacts: changing.querySelectorAll('.fluent-read-bilingual-content,.fluent-read-single-slot').length});
                    value++;
                }, 250);
            });
            await page.waitForTimeout(4200);
            await page.locator('#probe').click();
            const running = await page.evaluate(() => ({
                sameNeighbor: window.__stableArtifact === document.querySelector('#neighbor .fluent-read-bilingual-content, #neighbor .fluent-read-single-slot'),
                lastSamples:window.__changes.slice(-10), clicks:window.probeClicks,
                duplicates:document.querySelectorAll('.fluent-read-bilingual-content .fluent-read-bilingual-content').length,
            }));
            assert.equal(running.sameNeighbor,true);
            assert.equal(running.duplicates,0);
            assert.ok(running.clicks > 0);
            assert.ok(running.lastSamples.every(sample => sample.counterArtifacts === 0 && sample.changingArtifacts === 0));
            assert.equal(provider.translatedItemCount(),baselineItems,'Continuously changing sources must not request translation');
            await page.evaluate(() => {clearInterval(window.__interval);document.querySelector('#changing').firstChild.nodeValue='The processing task is now complete.';});
            await page.locator(`#changing ${selector}`).waitFor({state:'attached', timeout:10000});
            assert.equal(await page.locator(`#counter ${selector}`).count(),0,'Recognized numeric label stays original after stopping');
            assert.equal(provider.translatedItemCount(),baselineItems+1,'Only latest stable text is translated');
            await page.screenshot({path:path.join(artifactsDir,`${mode}-settled.png`)});
            // 变成新正文时解除计数抑制；响应晚于 host 的变化，不得回填旧来源。
            await page.evaluate(() => {document.querySelector('#counter').firstChild.nodeValue='A newly published article is ready.';});
            await page.locator(`#counter ${selector}`).waitFor({state:'attached', timeout:10000});
            await page.keyboard.press('Alt+t');
            await page.waitForTimeout(2500);
            assert.equal(await page.locator('.fluent-read-bilingual-content,.fluent-read-single-slot').count(),0);
            assert.equal(await page.locator('#clock').textContent(),'12:34 PM');
            assert.equal(await page.locator('#counter').textContent(),'A newly published article is ready.');
            assert.equal(await page.locator('#changing').textContent(),'The processing task is now complete.');
            const inlineNumber = await page.locator('#inline-number').textContent();
            assert.equal(await page.locator('#inline').textContent(), `This stable paragraph includes ${inlineNumber} records and a timer 2 minutes ago.`);
            await page.keyboard.press('Alt+t');
            await page.locator(`#normal ${selector}`).waitFor({state:'attached'});
            assert.equal(await page.locator(`#normal ${selector}`).count(),1);
            report.cases.push({mode, continuouslyChangingRequests:0, settledRequests:1, running, restoreRetranslate:true});
            await page.close();
        }
        await configure({display:1});
        const hover = await newPageWithoutForeground(context);
        await hover.goto(`http://127.0.0.1:${server.address().port}/hover`);
        await hover.locator('#fluent-read-page-styles').waitFor({state:'attached'});
        await activateExtensionTabWithoutForeground(context, hover);
        await hover.waitForTimeout(500);
        const counts = [];
        for (const expected of [1,0,1]) {
            await hover.locator('#normal').click({position:{x:80,y:12}});
            await hover.keyboard.press('Control');
            await hover.waitForFunction(expected => document.querySelectorAll('#normal .fluent-read-bilingual-content').length === expected,expected);
            counts.push(await hover.locator('#normal .fluent-read-bilingual-content').count());
        }
        await hover.locator('#duration').click();await hover.keyboard.press('Control');await hover.waitForTimeout(700);
        assert.equal(await hover.locator('#duration .fluent-read-bilingual-content').count(),0);
        assert.equal(await hover.locator('#neighbor .fluent-read-bilingual-content').count(),0);
        report.cases.push({mode:'hover', counts, durationArtifacts:0, neighborArtifacts:0});
        report.payloads = provider.requestPayloads();
        assert.deepEqual(report.errors,[]);
        report.ok=true;
    } catch (error) {
        report.errors.push(String(error.stack || error));
        process.exitCode=1;
    } finally {
        fs.writeFileSync(path.join(artifactsDir,'report.json'),JSON.stringify(report,null,2));
        if (launched) await launched.close().catch(() => undefined);
        if (provider) await provider.close();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(profileDir,{recursive:true,force:true});
        console.log(JSON.stringify({ok:report.ok,cases:report.cases,errors:report.errors,artifactsDir},null,2));
    }
})();
