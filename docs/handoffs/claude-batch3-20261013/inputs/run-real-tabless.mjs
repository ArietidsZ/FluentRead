import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {openOwnedNeo, until, delay} from './owned-neo-session.mjs';

const evidence = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(evidence, '../..');
const extension = path.join(workspace, 'FluentRead-pr906-tabless-vocabulary-candidate-20261013/.output/chrome-mv3');
const publicKey = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8')).key;
assert.equal(typeof publicKey, 'string');
const expectedExtensionId = crypto.createHash('sha256').update(Buffer.from(publicKey,'base64')).digest('hex').slice(0,32).replace(/[0-9a-f]/g, digit=>String.fromCharCode(97+parseInt(digit,16)));
const lease = path.join(workspace, 'CW-BROWSER-COORDINATION/NEO-UI-EXCLUSIVE-LEASE');
const runId = 'tabless-real-' + new Date().toISOString().replace(/[^0-9]/g, '');
const deadline = Date.parse('2026-10-13T07:00:00Z');
const acceptanceMode = process.env.FLUENT_TABLESS_ACCEPTANCE_MODE || 'exact-document';
assert.ok(['exact-document', 'missing-document-cache-fallback'].includes(acceptanceMode), 'Unknown acceptance mode');
const stamp = () => new Date().toISOString();
const write = (name, value) => fs.writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2) + '\n');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const report = {runId, startedAtUTC: stamp(), cases: [], privateAcceptance: 'NOT_RUN: no currently enabled temporary incognito profile; no permission setting changed', ambiguousNativeResult: 'NOT_TRIGGERED: browser document IDs are unique; no fabricated contexts', paidOrRealProviderCalls: 0};
report.acceptanceMode = acceptanceMode;
report.downstreamRuntimeAcceptance = 'NOT_RUN';
let browser, worker, leaseOwned = false, watchdog, interrupted;
const check = () => {if (interrupted) throw interrupted;};
async function evaluate(session, expression, awaitPromise = true) {check();return browser.cdp.evaluate(session, expression, undefined, awaitPromise);}
async function targets() {return (await browser.cdp.send('Target.getTargets')).targetInfos;}
async function attach(targetId) {
    const {sessionId} = await browser.cdp.send('Target.attachToTarget', {targetId, flatten: true});
    await browser.cdp.send('Runtime.enable', {}, sessionId);return sessionId;
}
async function snapshot() {return evaluate(worker, 'JSON.parse(JSON.stringify(globalThis.__tablessAudit))');}
async function cacheCount() {
    return evaluate(worker, `(async () => {
        const names = await indexedDB.databases();
        const dbInfo = names.find(item => /translation/i.test(item.name) && /cache/i.test(item.name));
        if (!dbInfo) return {databasePresent:false, entries:0};
        return await new Promise((resolve,reject) => {
            const request = indexedDB.open(dbInfo.name);
            request.onerror = () => reject(new Error('owned cache open failed'));
            request.onsuccess = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('entries')) {db.close();reject(new Error('owned cache entries missing'));return;}
                const count = db.transaction('entries','readonly').objectStore('entries').count();
                count.onerror = () => {db.close();reject(new Error('owned cache count failed'));};
                count.onsuccess = () => {db.close();resolve({databasePresent:true,entries:count.result});};
            };
        });
    })()`);
}
async function openPopup() {
    await evaluate(worker, 'chrome.action.openPopup()');
    const info = await until(async () => (await targets()).find(item => item.url === `chrome-extension://${report.extensionId}/popup.html`), 5000, 'real extension popup');
    const session = await attach(info.targetId);
    return {session, targetId: info.targetId};
}
let requestSequence = 0;
function message(origin, timeoutMs = 4000) {
    return {origin, serviceOverride:'google', sourceLanguage:'en', targetLanguage:'zh-Hans', enableNativeBatch:false,
        useCache:true, requestTimeoutMs:timeoutMs, clientRequestId:runId+'-'+(++requestSequence)};
}
async function send(popup, payload, wait = true) {
    return evaluate(popup.session, `globalThis.__tablessJob = chrome.runtime.sendMessage(${JSON.stringify(payload)}).then(value => ({ok:true,value}),error => ({ok:false,errorName:error.name}));${wait ? 'globalThis.__tablessJob' : 'true'}`, wait);
}
async function holdMetadata() {await evaluate(worker, 'globalThis.__tablessAudit.hold = true;true');}
async function releaseMetadata() {await evaluate(worker, 'globalThis.__releaseTablessMetadata();true');}
async function waitQuery(count) {await until(async () => (await snapshot()).queries.length >= count, 3000, 'production metadata lookup reached');}
async function closePopup(popup) {await browser.cdp.send('Target.closeTarget', {targetId: popup.targetId});}
async function runCase(name, operation) {
    const item = {name, startedAtUTC:stamp()};report.cases.push(item);const began = Date.now();
    try {item.evidence = await operation();item.status='PASS';item.exitCode=0;}
    catch (error) {
        item.status='FAIL';item.exitCode=1;item.error=error.message;
        try {item.failureSnapshot=await snapshot();}
        catch (captureError) {item.failureSnapshotError=captureError.message;}
        throw error;
    }
    finally {item.finishedAtUTC=stamp();item.wallMilliseconds=Date.now()-began;write('RESULTS-IN-PROGRESS.json',report);}
}

try {
    assert.ok(Date.now()+240000 < deadline, 'Do not admit a browser run near the conservative deadline');
    assert.ok(!fs.existsSync(lease), 'Existing owner: stop, do not take over');
    fs.mkdirSync(lease,{mode:0o700});leaseOwned=true;
    fs.writeFileSync(path.join(lease,'owner.json'),JSON.stringify({runId,ownerPid:process.pid,sourceThread:'01a12510-99a1-74af-b47a-1f72d44940ce',startedAtUTC:stamp(),expiresAtUTC:new Date(Date.now()+240000).toISOString(),scope:'one bounded actual tabless privacy acceptance; isolated Xvfb; no incognito setting changes'})+'\n',{flag:'wx',mode:0o600});
    watchdog=setTimeout(() => {interrupted=new Error('Bounded 180-second browser budget reached');browser?.cdp.close();},180000);
    browser=await openOwnedNeo(extension,evidence);
    report.browserLaunchedAtUTC=stamp();report.profileRoot=browser.root;
    const version=await browser.cdp.send('Browser.getVersion');report.browserVersion=version.product;
    const candidate=await until(async () => (await targets()).find(item => item.type==='service_worker' && item.url===`chrome-extension://${expectedExtensionId}/background.js`),15000,'retained FluentRead worker loaded');
    report.extensionId=new URL(candidate.url).hostname;worker=await attach(candidate.targetId);
    assert.equal(await evaluate(worker,'chrome.runtime.id'),report.extensionId);
    assert.equal(await evaluate(worker,"typeof chrome.runtime.getContexts"),'function','Native runtime.getContexts unavailable');
    const hook = () => {
        const audit = globalThis.__tablessAudit = {inbox:[],queries:[],mockCalls:[],blockedFetches:[],hold:false};
        const nativeContexts = chrome.runtime.getContexts.bind(chrome.runtime), nativeFetch = globalThis.fetch.bind(globalThis);
        const releases=[];
        chrome.runtime.getContexts = async filter => {
            const query={startedAt:Date.now(),documentIds:[...(filter.documentIds||[])],held:audit.hold};audit.queries.push(query);
            if (audit.hold) await new Promise(resolve=>releases.push(resolve));
            query.nativeStartedAt=Date.now();
            const results=await nativeContexts(filter);
            query.results=results.map(item=>({documentId:item.documentId,contextType:item.contextType,incognito:item.incognito}));
            query.finishedAt=Date.now();return results;
        };
        globalThis.__releaseTablessMetadata=()=>{audit.hold=false;releases.splice(0).forEach(release=>release());};
        chrome.runtime.onMessage.addListener((message,sender)=>{
            if (typeof message?.clientRequestId==='string' && message.clientRequestId.startsWith('tabless-real-')) {
                audit.inbox.push({at:Date.now(),clientRequestId:message.clientRequestId,type:message.type||'legacy-translation',
                    sender:{id:sender.id,documentId:sender.documentId,hasTab:sender.tab!==undefined,tabIncognito:sender.tab?.incognito}});
            }
        });
        globalThis.fetch=async (input,init={})=>{
            const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
            if (url.protocol==='chrome-extension:' && url.hostname===chrome.runtime.id) return nativeFetch(input,init);
            if (url.hostname==='translate-pa.googleapis.com' && url.pathname==='/v1/translateHtml') {
                const payload=JSON.parse(String(init.body));const texts=payload[0][0];
                if (!Array.isArray(texts)||!texts.every(text=>text.includes('cw-tabless-fixture-'))) throw new Error('Only synthetic fixture text admitted');
                audit.mockCalls.push({at:Date.now(),provider:'google-html-local-memory-mock',segments:texts.length});
                return new Response(JSON.stringify([texts.map(()=>'<pre>本地合成验收译文</pre>')]),{status:200,headers:{'content-type':'application/json'}});
            }
            audit.blockedFetches.push({at:Date.now(),protocol:url.protocol,hostname:url.hostname});
            throw new Error('External network denied by test transport');
        };
        return {instrumented:true,realMetadataAPI:true,providerBoundary:'global fetch only; broker/router/resolver/cache unchanged'};
    };
    report.instrumentation=await evaluate(worker,'('+hook.toString()+')()');
    report.incognitoPermission=await evaluate(worker,'new Promise(resolve=>chrome.extension.isAllowedIncognitoAccess(resolve))');

    if (acceptanceMode === 'missing-document-cache-fallback') {
        // Separate negative identity case. Never relabel the original positive-query gate.
        report.originalExactDocumentAcceptance = 'NOT_RUN: separate fallback mode selected';
        report.paidOrRealProviderCalls = 'NOT_MEASURED_GLOBALLY: only worker-global fetch is intercepted';
        report.privateModelSelection = 'NOT_TESTED: unknown privacy does not imply a private/local provider';
        report.cancellationDeadlineAcceptance = 'NOT_RUN';
        report.pageSummaryAcceptance = 'NOT_RUN';
        report.cacheReadInstrumentation = 'NOT_INSTALLED: this case checks per-request mock dispatch and net entry count, not raw cache reads/writes';
        await runCase('native-missing-document-no-translation-cache-reuse', async () => {
            const p = await openPopup();
            const before = await snapshot(), initialCache = await cacheCount();
            const requests = [], responses = [], perRequestMockDeltas = [];
            const origin = 'cw-tabless-fixture-missing-document-' + runId;
            // Sequential completion distinguishes reusable cache from in-flight sharing.
            for (const forgedPrivacy of [false, false, true, true]) {
                const request = message(origin);
                if (forgedPrivacy) Object.assign(request, {
                    privateContext: false, incognito: false,
                    documentId: 'untrusted-payload-document',
                });
                requests.push(request);
                const callsBefore = (await snapshot()).mockCalls.length;
                responses.push(await send(p, request));
                perRequestMockDeltas.push((await snapshot()).mockCalls.length - callsBefore);
            }
            const after = await snapshot(), finalCache = await cacheCount();
            const requestIds = requests.map(item => item.clientRequestId);
            const senders = after.inbox.filter(item => requestIds.includes(item.clientRequestId));
            const queries = after.queries.slice(before.queries.length);
            const providerCalls = after.mockCalls.length - before.mockCalls.length;
            const blockedFetches = after.blockedFetches.slice(before.blockedFetches.length);
            write('MISSING-DOCUMENT-PREASSERT.json', {
                runId, requestIds, before, after, initialCache, finalCache, responses, perRequestMockDeltas,
                forgedPayloadCases: [2, 3], originalExactDocumentAcceptance: report.originalExactDocumentAcceptance,
            });
            assert.equal(senders.length, requests.length, 'Every native sender must be retained');
            for (const request of requests) {
                const matching = senders.filter(item => item.clientRequestId === request.clientRequestId);
                assert.equal(matching.length, 1, 'Native sender receipt must be unique');
                assert.equal(matching[0].sender.id, report.extensionId);
                assert.equal(matching[0].sender.hasTab, false);
                assert.equal(matching[0].sender.documentId, undefined, 'A document-bearing sender belongs to a different case');
            }
            report.originalExactDocumentAcceptance = 'UNMET: verified native popup documentId absent; original positive-query cases not run';
            assert.equal(queries.length, 0, 'Missing native document identity must not trigger context lookup');
            for (const response of responses) {
                assert.equal(response.ok, true);
                assert.equal(response.value, '本地合成验收译文');
            }
            assert.deepEqual(perRequestMockDeltas, [1, 1, 1, 1], 'Each sequential request must reach the local mock exactly once');
            assert.equal(providerCalls, requests.length, 'Total mock count must match request receipts');
            assert.equal(finalCache.entries, initialCache.entries, 'No net translation cache entry growth is permitted');
            assert.equal(blockedFetches.length, 0, 'Unexpected network attempts invalidate this case');
            await closePopup(p);
            return {realSenders: senders, realContextQueries: queries, providerCalls,
                cacheEntriesBefore: initialCache.entries, cacheEntriesAfter: finalCache.entries,
                sequentialResponses: responses.length, perRequestMockDeltas, spoofedPayloadDidNotSuppressMockDispatch: true,
                cacheReadsAndWrites: 'NOT_INSTRUMENTED', netCacheEntryGrowth: 0, pendingDeduplication: 'NOT_TESTED'};
        });
        report.status = 'PASS_SCOPED_MISSING_DOCUMENT_CACHE_FALLBACK_ONLY';
        report.downstreamRuntimeAcceptance = 'SCOPED_TRANSLATION_CACHE_FALLBACK_ONLY';
        report.exitCode = 0;
    } else {
    await runCase('actual-public-popup-cache',async()=>{
        const p=await openPopup();const before=await snapshot();const initialCache=await cacheCount();
        const first=message('cw-tabless-fixture-public');const second=message(first.origin);
        const response1=await send(p,first);const response2=await send(p,second);
        const after=await snapshot();const queries=after.queries.slice(before.queries.length);
        write('PUBLIC-POPUP-PREASSERT.json',{
            runId,requestIds:[first.clientRequestId,second.clientRequestId],
            before,after,initialCache,response1,response2
        });
        assert.equal(response1.ok,true);assert.equal(response2.ok,true);
        assert.equal(response1.value,'本地合成验收译文');assert.equal(response2.value,response1.value);
        assert.equal(queries.length,2,'Production metadata wrapper must be reached');
        const senders=after.inbox.filter(item=>item.clientRequestId===first.clientRequestId||item.clientRequestId===second.clientRequestId);
        assert.equal(senders.length,2);assert.ok(senders.every(item=>item.sender.id===report.extensionId&&item.sender.documentId&&!item.sender.hasTab));
        assert.ok(queries.every((query,i)=>query.documentIds.length===1&&query.documentIds[0]===senders[i].sender.documentId&&query.results.length===1&&query.results[0].documentId===query.documentIds[0]&&query.results[0].contextType==='POPUP'&&query.results[0].incognito===false));
        assert.equal(after.mockCalls.length-before.mockCalls.length,1);
        const finalCache=await cacheCount();assert.equal(finalCache.entries-initialCache.entries,1);
        await closePopup(p);return {realSenders:senders,realContextQueries:queries,providerCalls:1,cacheEntriesBefore:initialCache.entries,cacheEntriesAfter:finalCache.entries};
    });
    await runCase('actual-closed-popup-unknown-cache-off',async()=>{
        const before=await snapshot(),initialCache=await cacheCount();
        for(let i=0;i<2;i++){
            const p=await openPopup();await holdMetadata();const expected=(await snapshot()).queries.length+1;
            await send(p,message('cw-tabless-fixture-unknown'),false);await waitQuery(expected);
            await closePopup(p);await delay(100);await releaseMetadata();
            await until(async()=> (await snapshot()).mockCalls.length>=before.mockCalls.length+i+1,3000,'unknown request reaches only local mock');
        }
        const after=await snapshot(),queries=after.queries.slice(before.queries.length),finalCache=await cacheCount();
        assert.equal(queries.length,2);assert.ok(queries.every(query=>query.held&&query.results?.length===0));
        assert.equal(after.mockCalls.length-before.mockCalls.length,2);assert.equal(finalCache.entries,initialCache.entries);
        return {realContextQueries:queries,providerCalls:2,cacheEntriesBefore:initialCache.entries,cacheEntriesAfter:finalCache.entries,removedRealPopupDocuments:true,unknownPreservesTranslationButDisablesCache:true};
    });
    for(const kind of ['cancel','deadline'])await runCase('actual-popup-'+kind+'-no-late-provider',async()=>{
        const p=await openPopup(),before=await snapshot(),initialCache=await cacheCount();await holdMetadata();
        const request=message('cw-tabless-fixture-'+kind,1000);await send(p,request,false);await waitQuery(before.queries.length+1);
        let cancelResponse;
        if(kind==='cancel'){
            cancelResponse=await evaluate(p.session,`chrome.runtime.sendMessage({type:'fluentReadTranslationCancel',clientRequestId:${JSON.stringify(request.clientRequestId)}})`);
            assert.equal(cancelResponse?.success,true);assert.equal(cancelResponse?.cancelled,true);
        }
        else await delay(1200);
        const response=await evaluate(p.session,'globalThis.__tablessJob');
        assert.equal(response.ok,true,'Production background must return a structured failure');
        assert.equal(response.value?.marker,'fluentread-translation-error-v1');
        if(kind==='deadline')assert.equal(response.value.kind,'timeout');
        else assert.match(response.value.message,/cancel|abort|取消/iu);
        await releaseMetadata();await delay(350);
        const after=await snapshot(),query=after.queries.at(-1),finalCache=await cacheCount();
        assert.equal(after.mockCalls.length,before.mockCalls.length);assert.equal(finalCache.entries,initialCache.entries);
        assert.ok(query.held&&query.results.length===1&&query.results[0].incognito===false);
        await closePopup(p);return {response,cancelResponse,realLateContextQuery:query,providerCallsAfterAbortOrDeadline:0,cacheEntriesBefore:initialCache.entries,cacheEntriesAfter:finalCache.entries};
    });
    report.status='PASS_SCOPED_PUBLIC_UNKNOWN_CANCEL_DEADLINE';report.exitCode=0;
    report.downstreamRuntimeAcceptance = 'SCOPED_PUBLIC_UNKNOWN_CANCEL_DEADLINE';
    }
}catch(error){report.status='BLOCKED_OR_FAILED_SINGLE_ATTEMPT';report.exitCode=1;report.error=error.message;}
finally{
    clearTimeout(watchdog);
    if(browser){try{await browser.close();report.ownedCleanupVerified=true;}catch(error){report.cleanupError=error.message;report.exitCode=1;}}
    if(leaseOwned){
        const owner=JSON.parse(fs.readFileSync(path.join(lease,'owner.json'),'utf8'));assert.equal(owner.runId,runId);assert.equal(owner.ownerPid,process.pid);
        write('LEASE-RELEASE.json',{...owner,releasedAtUTC:stamp(),ownedCleanupVerified:report.ownedCleanupVerified===true});
        fs.unlinkSync(path.join(lease,'owner.json'));fs.rmdirSync(lease);
    }
    report.finishedAtUTC=stamp();write('RESULTS.json',report);
    console.log(JSON.stringify({status:report.status,exitCode:report.exitCode,browserVersion:report.browserVersion,cases:report.cases.map(item=>({name:item.name,status:item.status,exitCode:item.exitCode,startedAtUTC:item.startedAtUTC,finishedAtUTC:item.finishedAtUTC})),error:report.error,cleanupError:report.cleanupError,ownedCleanupVerified:report.ownedCleanupVerified}));
    process.exitCode=report.exitCode??1;
}
