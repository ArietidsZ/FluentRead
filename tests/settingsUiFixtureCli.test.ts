/**
 * @file tests/settingsUiFixtureCli.test.ts
 * 文件职责：通过两个设置专项的实际公开 CLI 子进程验证异常与资源清理。
 * 主要内容：仅替换外部 launcher/page/文件系统故障端口；partial launch 使用本测试实际持有的 Node 子进程句柄，等待关闭回执后才允许 profile 删除。
 * 模块边界：不模拟设置 DOM、不执行 native/UI 断言、不启动浏览器或请求服务；默认执行 process.cwd() 下的公开脚本，私有源覆写必须显式提供。
 */
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {spawn, type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const sourceRoot = path.resolve(process.env.FLUENTREAD_SETTINGS_UI_FIXTURE_SOURCE_ROOT || process.cwd());
const evidenceRoot = process.env.FLUENTREAD_SETTINGS_UI_FIXTURE_EVIDENCE;
const scripts = ['run-settings-search-results-layout-test.cjs', 'run-service-group-navigation-test.cjs'];
type Exit = {code: number | null; signal: NodeJS.Signals | null};
type Event = {kind: string; [key: string]: any};
const owned = new Map<ChildProcess, Promise<Exit>>();
const receipts: Record<string, unknown>[] = [];
let suiteRoot: string;
let invocation = 0;
let activeTimers = 0;

function track(child: ChildProcess): Promise<Exit> {
    const closed = new Promise<Exit>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => {owned.delete(child); resolve({code, signal});});
    });
    owned.set(child, closed);
    return closed;
}

function gone(child: ChildProcess): boolean {
    if (!child.pid) return false;
    try {process.kill(child.pid, 0); return false;}
    catch (error) {return (error as NodeJS.ErrnoException).code === 'ESRCH';}
}

async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    activeTimers++;
    try {
        return await Promise.race([promise, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Owned process/port deadline exceeded')), milliseconds);
        })]);
    } finally {if (timer) clearTimeout(timer); activeTimers--;}
}

async function stopOwned(child: ChildProcess, closed: Promise<Exit>, reason: string): Promise<Exit> {
    const signals: string[] = [];
    if (owned.has(child)) {signals.push('SIGTERM'); child.kill('SIGTERM');}
    let exit: Exit;
    try {exit = await bounded(closed, 1500);}
    catch {
        if (owned.has(child)) {signals.push('SIGKILL'); child.kill('SIGKILL');}
        exit = await bounded(closed, 1500);
    }
    receipts.push({pid: child.pid, reason, signals, waited: true, gone: gone(child), ...exit});
    if (!gone(child)) throw new Error('Tracked owned process is still alive after close');
    return exit;
}

const preload = String.raw`
const fs=require('node:fs'),path=require('node:path');
const fixture=process.env.SETTINGS_CLI_FIXTURE,flags=global.__settingsCliFlags=new Set(process.env.SETTINGS_CLI_FAULT.split('+'));
const log=global.__settingsCliLog=(kind,data={})=>fs.appendFileSync(path.join(fixture,'events.jsonl'),JSON.stringify({kind,...data})+'\n');
let ownedProfile;
const temp=fs.mkdtempSync;
fs.mkdtempSync=function(prefix,...rest){
 log('profile-create-attempt',{prefix});
 if(flags.has('temp-fail'))throw Error('CONTROLLED_TEMP_ACQUISITION_FAILURE');
 if(!/^\/private\/tmp\/fr-(settings-search-results|service-group-navigation)-$/.test(prefix))throw Error('UNEXPECTED_TEMP_PREFIX');
 ownedProfile=temp.call(this,path.join(fixture,'profiles','owned-'),...rest);
 log('profile-created',{directory:ownedProfile});return ownedProfile;
};
const remove=fs.rmSync;
fs.rmSync=function(directory,...rest){
 if(directory!==ownedProfile)throw Error('REFUSE_FOREIGN_PROFILE_REMOVAL');
 log('profile-remove',{directory});
 if(flags.has('remove-fail'))throw Error('CONTROLLED_PROFILE_REMOVE_FAILURE');
 const result=remove.call(this,directory,...rest);log('profile-removed',{directory});return result;
};
const write=fs.writeFileSync;
fs.writeFileSync=function(file,...rest){
 if(file===path.join(fixture,'artifacts','report.json'))log('report-write');
 return write.call(this,file,...rest);
};
log('cli-ready',{pid:process.pid});
`;

const launcher = String.raw`
const fs=require('node:fs'),path=require('node:path');
const flags=global.__settingsCliFlags,log=global.__settingsCliLog,fixture=process.env.SETTINGS_CLI_FIXTURE;
let pending=0;
function actorPort(type,profileDir){
 return new Promise((resolve,reject)=>{
  pending++;
  const timer=setTimeout(()=>{process.removeListener('message',onMessage);pending--;reject(Error('ACTOR_PORT_TIMEOUT'));},1500);
  function onMessage(message){if(message.type!==type+'-receipt')return;clearTimeout(timer);process.removeListener('message',onMessage);pending--;if(message.error)reject(Error(message.error));else resolve(message);}
  process.on('message',onMessage);process.send({type,profileDir});
 });
}
exports.launchFocusSafePersistentContext=async options=>{
 log('launch-attempt',{profileDir:options.profileDir});
 if(flags.has('partial-launch')||flags.has('actor-close'))log('actor-ready-receipt',await actorPort('actor-start',options.profileDir));
 if(flags.has('partial-launch'))throw Error('CONTROLLED_PARTIAL_LAUNCH_FAILURE');
 const context={serviceWorkers:()=>[{url:()=> 'chrome-extension://controlled-external-port/background.js'}]};
 return {context,launchMode:'controlled-external-port',focusPolicy:'no-browser',windowPlacement:{},close:async()=>{
  log('session-close-start');
  if(flags.has('close-fail'))throw Error('CONTROLLED_SESSION_CLOSE_FAILURE');
  if(flags.has('actor-close')){
   const receipt=await actorPort('actor-stop',options.profileDir);
   if(!receipt.waited||!receipt.gone||!receipt.timerCleared||!receipt.fdClosed)throw Error('UNCONFIRMED_ACTOR_CLOSE');
   log('actor-close-receipt',receipt);
  }
  if(flags.has('ownership-swap')){
   fs.renameSync(options.profileDir,options.profileDir+'.original');
   fs.symlinkSync(path.join(fixture,'foreign-profile'),options.profileDir);
   log('profile-ownership-swapped',{directory:options.profileDir});
  }
  log('session-close-success');
 }};
};
exports.newPageWithoutForeground=async()=>{
 log('page-acquisition-failure');
 if(flags.has('primary-null'))throw null;
 throw Error('CONTROLLED_PRIMARY_PAGE_FAILURE');
};
process.on('exit',()=>log('external-port-timers',{pending}));
`;

const actorSource = String.raw`
const fs=require('node:fs'),path=require('node:path');
const profileDir=process.argv[2];
const fd=fs.openSync(path.join(profileDir,'owned-actor.lock'),'w');
const timer=setInterval(()=>{},1000);
process.stdout.write(JSON.stringify({ready:true,pid:process.pid,profileDir})+'\n');
process.once('SIGTERM',()=>{
 clearInterval(timer);fs.closeSync(fd);
 process.stdout.write(JSON.stringify({timerCleared:true,fdClosed:true})+'\n',()=>process.exit(0));
});
`;

beforeAll(() => {
    const parent = process.env.FLUENTREAD_SETTINGS_UI_FIXTURE_TEMP_ROOT || tmpdir();
    mkdirSync(parent, {recursive: true});
    suiteRoot = mkdtempSync(path.join(parent, 'settings-ui-cli-'));
});
afterAll(async () => {
    for (const [child, closed] of [...owned]) await stopOwned(child, closed, 'suite-finally');
    if (evidenceRoot) {
        mkdirSync(evidenceRoot, {recursive: true});
        writeFileSync(path.join(evidenceRoot, 'resource-receipts.json'), JSON.stringify({testWorkerPid: process.pid, receipts, activeOwnedHandles: owned.size, activeTimers}, null, 2));
    }
    expect(owned.size).toBe(0);
    expect(activeTimers).toBe(0);
    if (suiteRoot) rmSync(suiteRoot, {recursive: true, force: true});
});

async function invoke(script: string, fault: string) {
    const number = ++invocation;
    const fixture = path.join(suiteRoot, String(number));
    for (const directory of ['runtime/playwright', 'profiles', 'foreign-profile', 'extension']) mkdirSync(path.join(fixture, directory), {recursive: true});
    if (fault.includes('mkdir-fail')) writeFileSync(path.join(fixture, 'artifacts'), 'actual file blocks mkdir');
    else mkdirSync(path.join(fixture, 'artifacts'));
    if (fault.includes('report-eisdir')) mkdirSync(path.join(fixture, 'artifacts', 'report.json'));
    writeFileSync(path.join(fixture, 'foreign-profile', 'sentinel'), 'foreign profile must survive');
    writeFileSync(path.join(fixture, 'runtime/playwright/index.js'), 'exports.chromium={};\n');
    writeFileSync(path.join(fixture, 'runtime/playwright/package.json'), '{"type":"commonjs","main":"index.js"}');
    writeFileSync(path.join(fixture, 'preload.cjs'), preload);
    writeFileSync(path.join(fixture, 'launcher.cjs'), launcher);
    writeFileSync(path.join(fixture, 'actor.cjs'), actorSource);
    writeFileSync(path.join(fixture, 'events.jsonl'), '');
    const scriptPath = path.join(sourceRoot, 'scripts/testing', script);
    const child = spawn(process.execPath, ['--require', path.join(fixture, 'preload.cjs'), scriptPath,
        '--playwright-root', path.join(fixture, 'runtime'), '--focus-safe-helper', path.join(fixture, 'launcher.cjs'),
        '--extension-dir', path.join(fixture, 'extension'), '--artifacts-dir', path.join(fixture, 'artifacts')], {
        cwd: fixture, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: {...process.env, SETTINGS_CLI_FAULT: fault, SETTINGS_CLI_FIXTURE: fixture},
    });
    const closed = track(child);
    let stdout = '', stderr = '', actorOutput = '', portError: unknown;
    let actor: ChildProcess | undefined;
    let actorClosed: Promise<Exit> | undefined;
    let actorStop: Promise<Exit> | undefined;
    let result: any;
    child.stdout!.on('data', chunk => {stdout += chunk;});
    child.stderr!.on('data', chunk => {stderr += chunk;});
    async function onMessage(message: any) {
        try {
            if (message.type === 'actor-start') {
                if (actor || path.dirname(message.profileDir) !== path.join(fixture, 'profiles')) throw new Error('Refuse foreign or duplicate actor');
                actor = spawn(process.execPath, [path.join(fixture, 'actor.cjs'), message.profileDir], {stdio: ['ignore', 'pipe', 'pipe']});
                actorClosed = track(actor);
                const ready = new Promise<void>(resolve => {
                    actor!.stdout!.on('data', chunk => {actorOutput += chunk; if (actorOutput.includes('"ready":true')) resolve();});
                });
                await bounded(ready, 1500);
                child.send({type: 'actor-start-receipt', pid: actor.pid, actualOwnedHandle: true});
            } else if (message.type === 'actor-stop') {
                if (!actor || !actorClosed || actorStop) throw new Error('Refuse unowned or repeated actor stop');
                actorStop = stopOwned(actor, actorClosed, 'awaited-launcher-close');
                const exit = await actorStop;
                child.send({type: 'actor-stop-receipt', pid: actor.pid, waited: true, gone: gone(actor),
                    timerCleared: actorOutput.includes('"timerCleared":true'), fdClosed: actorOutput.includes('"fdClosed":true'), ...exit});
            }
        } catch (error) {
            portError = error;
            if (child.connected) child.send({type: message.type + '-receipt', error: String(error)});
        }
    }
    child.on('message', onMessage);
    try {
        const exit = await bounded(closed, 5000);
        receipts.push({pid: child.pid, reason: 'cli-natural-exit', waited: true, gone: gone(child), ...exit});
        const events: Event[] = readFileSync(path.join(fixture, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
        const profiles = events.filter(event => event.kind === 'profile-created').map(event => ({path: event.directory, existsAtCliClose: existsSync(event.directory)}));
        const reportFile = path.join(fixture, 'artifacts/report.json');
        const report = existsSync(reportFile) && statSync(reportFile).isFile() ? JSON.parse(readFileSync(reportFile, 'utf8')) : undefined;
        let summary;
        try {summary = JSON.parse(stdout.trim().split('\n').at(-1) || '');} catch {summary = undefined;}
        result = {...exit, fault, script, scriptPath, scriptSha256: createHash('sha256').update(readFileSync(scriptPath)).digest('hex'),
            cliPid: child.pid, cliWaited: true, cliGone: gone(child), stdout, stderr, events, profiles, report, summary,
            actorAtCliClose: actor ? {pid: actor.pid, alive: !gone(actor), profileExists: profiles[0]?.existsAtCliClose, output: actorOutput} : undefined,
            foreignSentinelAtCliClose: readFileSync(path.join(fixture, 'foreign-profile/sentinel'), 'utf8')};
    } finally {
        if (actorStop) await actorStop;
        if (actor && actorClosed && owned.has(actor)) await stopOwned(actor, actorClosed, 'fixture-finally');
        if (owned.has(child)) await stopOwned(child, closed, 'fixture-finally');
        child.removeListener('message', onMessage);
        if (evidenceRoot && result) {
            mkdirSync(evidenceRoot, {recursive: true});
            writeFileSync(path.join(evidenceRoot, `${number}-${script}-${fault}.json`), JSON.stringify({...result,
                actorGoneAfterTeardown: actor ? gone(actor) : undefined, actorOutputAfterTeardown: actorOutput,
                activeOwnedHandlesAfterTeardown: owned.size, activeTimersAfterTeardown: activeTimers, portError: portError ? String(portError) : undefined}, null, 2));
        }
    }
    expect(portError).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.cliGone).toBe(true);
    expect(result.foreignSentinelAtCliClose).toBe('foreign profile must survive');
    if (actor) expect(gone(actor)).toBe(true);
    return result;
}

const count = (result: any, kind: string) => result.events.filter((event: Event) => event.kind === kind).length;
function primary(result: any, message = 'CONTROLLED_PRIMARY_PAGE_FAILURE') {
    expect(result.code).toBe(1);
    expect(result.report?.ok ?? result.summary?.ok, 'cleanup/primary failure cannot claim UI success').toBe(false);
    expect(result.report?.error ?? result.summary?.error, 'primary error stays available').toContain(message);
    expect(result.report?.cases ?? result.summary?.cases, 'fixture fails before any native/UI case runs').toEqual(result.report ? [] : 0);
}
function cleanupErrors(record: any): string {
    expect(Array.isArray(record?.cleanupErrors), 'independent cleanup failures have a structured array').toBe(true);
    return record.cleanupErrors.join('\n');
}
function removed(result: any) {
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].existsAtCliClose).toBe(false);
    expect(count(result, 'profile-removed')).toBe(1);
}

for (const script of scripts) describe(`${script} actual public CLI cleanup`, () => {
    it('cleans independently before EISDIR report failure and preserves the primary', async () => {
        const result = await invoke(script, 'report-eisdir');
        primary(result); removed(result);
        expect(cleanupErrors(result.summary)).toMatch(/report write:.*EISDIR/s);
        expect(count(result, 'session-close-success')).toBe(1);
        expect(result.events.findIndex((event: Event) => event.kind === 'profile-removed')).toBeLessThan(result.events.findIndex((event: Event) => event.kind === 'report-write'));
    });
    it('records close failure, keeps profile and persists report false', async () => {
        const result = await invoke(script, 'close-fail');
        primary(result);
        expect(cleanupErrors(result.report)).toContain('CONTROLLED_SESSION_CLOSE_FAILURE');
        expect(result.report.retainedProfile).toBe(result.profiles[0].path);
        expect(result.profiles[0].existsAtCliClose).toBe(true);
        expect(count(result, 'profile-remove')).toBe(0);
    });
    it('reports independent close and report failures without replacing the primary', async () => {
        const result = await invoke(script, 'close-fail+report-eisdir');
        primary(result);
        expect(cleanupErrors(result.summary)).toContain('CONTROLLED_SESSION_CLOSE_FAILURE');
        expect(cleanupErrors(result.summary)).toContain('EISDIR');
        expect(result.summary.retainedProfile).toBe(result.profiles[0].path);
        expect(count(result, 'profile-remove')).toBe(0);
    });
    it('keeps partial-launch profile while its actual owned actor has no exit receipt', async () => {
        const result = await invoke(script, 'partial-launch');
        primary(result, 'CONTROLLED_PARTIAL_LAUNCH_FAILURE');
        expect(result.actorAtCliClose).toMatchObject({alive: true, profileExists: true});
        expect(result.report.retainedProfile).toBe(result.profiles[0].path);
        expect(count(result, 'profile-remove')).toBe(0);
    });
    it('removes only after close awaits actual owned actor exit and fd/timer release', async () => {
        const result = await invoke(script, 'actor-close');
        primary(result); removed(result);
        expect(result.actorAtCliClose).toMatchObject({alive: false, profileExists: false});
        const receipt = result.events.find((event: Event) => event.kind === 'actor-close-receipt');
        expect(receipt).toMatchObject({waited: true, gone: true, timerCleared: true, fdClosed: true});
        expect(result.events.findIndex((event: Event) => event.kind === 'actor-close-receipt')).toBeLessThan(result.events.findIndex((event: Event) => event.kind === 'profile-remove'));
        expect(result.events.findIndex((event: Event) => event.kind === 'profile-removed')).toBeLessThan(result.events.findIndex((event: Event) => event.kind === 'report-write'));
    });
    it('preserves a null non-Error primary and still closes/removes', async () => {
        const result = await invoke(script, 'primary-null');
        primary(result, 'null'); removed(result);
        expect(result.report.error).toBe('null');
        expect(result.stderr).not.toContain('TypeError');
    });
    it('guards actual artifacts mkdir failure and publishes primary plus report-write error', async () => {
        const result = await invoke(script, 'mkdir-fail');
        primary(result, 'EEXIST');
        expect(result.profiles).toHaveLength(0);
        expect(count(result, 'launch-attempt')).toBe(0);
        expect(cleanupErrors(result.summary)).toContain('report write');
    });
    it('guards temp acquisition failure without launch or profile removal', async () => {
        const result = await invoke(script, 'temp-fail');
        primary(result, 'CONTROLLED_TEMP_ACQUISITION_FAILURE');
        expect(result.profiles).toHaveLength(0);
        expect(count(result, 'launch-attempt')).toBe(0);
        expect(count(result, 'profile-remove')).toBe(0);
    });
    it('records profile removal failure after successful close without losing primary', async () => {
        const result = await invoke(script, 'remove-fail');
        primary(result);
        expect(cleanupErrors(result.report)).toContain('CONTROLLED_PROFILE_REMOVE_FAILURE');
        expect(result.report.retainedProfile).toBe(result.profiles[0].path);
        expect(result.profiles[0].existsAtCliClose).toBe(true);
        expect(count(result, 'session-close-success')).toBe(1);
    });
    it('retains changed profile identity without deleting the foreign replacement', async () => {
        const result = await invoke(script, 'ownership-swap');
        primary(result);
        expect(cleanupErrors(result.report)).toContain('Temporary profile ownership changed');
        expect(result.report.retainedProfile).toBe(result.profiles[0].path);
        expect(result.profiles[0].existsAtCliClose).toBe(true);
        expect(count(result, 'profile-remove')).toBe(0);
    });
});
