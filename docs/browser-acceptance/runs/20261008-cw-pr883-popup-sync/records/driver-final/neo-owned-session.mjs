/**
 * CW Linux 隔离 Neo 测试会话：真实 headed X11 窗口，仅使用获批 BrowserOS 回环 CDP。
 * 不修改应用、系统权限、日常 profile 或 Cua 策略；验证归属后才控制，清理仅限本次进程。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here = fileURLToPath(import.meta.url);
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(test, timeout = 30_000, label = 'wait') {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {const value = await test(); if (value) return value; await delay(100);}
    throw new Error(`Timed out: ${label}`);
}
const write = (name, value) => fs.writeFileSync(name, JSON.stringify(value, null, 2) + '\n');
function processStat(pid) {
    try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const tail = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        return {pid: Number(pid), uid: fs.statSync(`/proc/${pid}`).uid, ppid: Number(tail[1]), pgid: Number(tail[2]), startTicks: tail[19]};
    } catch {return undefined;}
}
function processInfo(pid) {
    const info = processStat(pid); if (!info) return undefined;
    try {
        const args = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
            .map(arg => arg.replace(/([?&](?:sentry_key|token|api_key|key)=)[^&\s]+/gi, '$1<redacted>'));
        const security = Object.fromEntries(fs.readFileSync(`/proc/${pid}/status`, 'utf8').split('\n')
            .filter(line => /^(?:NoNewPrivs|Seccomp|Seccomp_filters|CapEff):/.test(line)).map(line => line.split(/:\s*/)));
        return {...info, exe: fs.readlinkSync(`/proc/${pid}/exe`), args, security};
    } catch {return undefined;}
}
function processes(groups, known, root) {
    const stats = fs.readdirSync('/proc').filter(name => /^\d+$/.test(name)).map(processStat)
        .filter(item => item && item.uid === process.getuid());
    const selected = new Set(stats.filter(item => groups.includes(item.pgid) || known.get(item.pid) === item.startTicks).map(item => item.pid));
    let changed = true;
    while (changed) {changed = false; for (const item of stats) if (!selected.has(item.pid) && selected.has(item.ppid)) {selected.add(item.pid); changed = true;}}
    const details = [...selected].map(processInfo).filter(Boolean);
    // Crashpad 可另建进程组，只读取已归属浏览器明确引用的 handler PID，且核对临时目录和执行文件。
    for (const item of [...details]) for (const arg of item.args) {
        const match = /--crashpad-handler-pid=(\d+)/.exec(arg); if (!match || selected.has(Number(match[1]))) continue;
        const handler = processInfo(Number(match[1]));
        if (handler?.uid === process.getuid() && handler.exe === '/usr/lib/browserclaw/chrome_crashpad_handler'
            && handler.args.some(arg => arg.includes(root))) {selected.add(handler.pid); details.push(handler);}
    }
    for (const item of details) known.set(item.pid, item.startTicks);
    return details;
}
function listeners(owned) {
    const sockets = new Set();
    for (const item of owned) {
        try {for (const fd of fs.readdirSync(`/proc/${item.pid}/fd`)) {
            try {const match = /^socket:\[(\d+)\]$/.exec(fs.readlinkSync(`/proc/${item.pid}/fd/${fd}`)); if (match) sockets.add(match[1]);} catch {}
        }} catch {}
    }
    const found = [];
    for (const version of ['tcp', 'tcp6']) for (const line of fs.readFileSync(`/proc/net/${version}`, 'utf8').trim().split('\n').slice(1)) {
        const fields = line.trim().split(/\s+/);
        if (fields[3] !== '0A' || !sockets.has(fields[9])) continue;
        const [address, port] = fields[1].split(':');
        const loopback = address === '0100007F' || address === '00000000000000000000000001000000';
        found.push({family: version, address: loopback ? version === 'tcp' ? '127.0.0.1' : '::1' : `NON_LOOPBACK:${address}`,
            port: parseInt(port, 16), inode: fields[9], loopback});
    }
    return found;
}
export function desktopWindows() {
    const code = `import subprocess,json,ast
p=subprocess.run(['gdbus','call','--session','--dest','org.cua.WinRects','--object-path','/org/cua/WinRects','--method','org.cua.WinRects.GetRects'],capture_output=True,text=True)
if p.returncode: raise RuntimeError('WinRects read-only call failed: '+str(p.returncode))
d=json.loads(ast.literal_eval(p.stdout.strip())[0])
if isinstance(d,dict): d=d.get('windows',[])
print(json.dumps([{k:w.get(k) for k in ['id','pid','x','y','width','height','focused'] if k in w} for w in d]))
`;
    return JSON.parse(execFileSync('python3', ['-c', code], {encoding: 'utf8', timeout: 15_000}));
}
export class Cdp {
    constructor(socket) {
        this.socket = socket; this.sequence = 0; this.pending = new Map(); this.events = [];
        socket.addEventListener('message', event => {
            const packet = JSON.parse(event.data);
            if (packet.id) {const pending = this.pending.get(packet.id); if (!pending) return;
                this.pending.delete(packet.id); clearTimeout(pending.timer);
                packet.error ? pending.reject(new Error(`${pending.method}: ${packet.error.message}`)) : pending.resolve(packet.result);
            } else {this.events.push(packet); this.onEvent?.(packet);}
        });
        socket.addEventListener('close', () => {for (const item of this.pending.values()) {clearTimeout(item.timer); item.reject(new Error('Owned CDP closed'));} this.pending.clear();});
    }
    static async connect(url) {
        assert.match(url, /^ws:\/\/(?:127\.0\.0\.1|\[::1\]):\d+\//);
        const socket = new WebSocket(url);
        await new Promise((resolve, reject) => {socket.addEventListener('open', resolve, {once: true}); socket.addEventListener('error', reject, {once: true});});
        return new Cdp(socket);
    }
    send(method, params = {}, sessionId) {
        return new Promise((resolve, reject) => {
            const id = ++this.sequence;
            const timer = setTimeout(() => {this.pending.delete(id); reject(new Error(`CDP deadline: ${method}`));}, 30_000);
            this.pending.set(id, {resolve, reject, timer, method});
            this.socket.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
        });
    }
    async evaluate(sessionId, expression, contextId, awaitPromise = true) {
        const result = await this.send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise,
            ...(contextId !== undefined ? {contextId} : {})}, sessionId);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
    }
    close() {this.socket.close();}
}

if (process.argv[2] === '--inner') {
    const root = process.argv[3], flags = JSON.parse(process.argv[4]);
    assert.ok(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir()) + '/fluentread-neo-port-'));
    const child = spawn('/usr/bin/browserclaw', flags, {stdio: ['ignore', 'inherit', 'inherit']});
    write(path.join(root, 'browser.json'), {pid: child.pid, innerPid: process.pid,
        display: process.env.DISPLAY, bus: process.env.DBUS_SESSION_BUS_ADDRESS, home: process.env.HOME,
        profile: path.join(root, 'profile'), xdgRuntime: process.env.XDG_RUNTIME_DIR, waylandInherited: Boolean(process.env.WAYLAND_DISPLAY)});
    process.on('SIGTERM', () => child.kill('SIGTERM'));
    child.on('exit', code => {process.exitCode = code ?? 1;});
} else {
    // 库导入不会启动进程；只有 openOwnedNeo 的显式调用创建隔离会话。
}

export async function openOwnedNeo(extensionDir, evidenceDir) {
    assert.equal(process.platform, 'linux');
    const expectedApp = '1d196af45b5e15ae9261790e40204f17c16b49bc';
    const appRoot = path.dirname(path.dirname(fs.realpathSync(extensionDir)));
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], {cwd: appRoot, encoding: 'utf8'}).trim(), expectedApp);
    assert.equal(execFileSync('git', ['status', '--porcelain'], {cwd: appRoot, encoding: 'utf8'}), '');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(extensionDir, 'manifest.json'))).digest('hex'), 'cc92950ad08ed2e2f02bd55a0756048e6569ec51c9341d9e678b65fb3d8d03f7');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(extensionDir, 'background.js'))).digest('hex'), '7a222e70f6e294681feff959856cb47cc0f7191a861e0f700dc01d4b1dfc6984');
    const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fluentread-neo-port-'));
    const token = crypto.randomUUID(); fs.writeFileSync(path.join(root, '.owner'), token, {flag: 'wx', mode: 0o600});
    for (const folder of ['home', 'config', 'cache', 'data', 'run', 'profile']) fs.mkdirSync(path.join(root, folder), {mode: 0o700});
    const busConfig = path.join(root, 'dbus-session.xml');
    fs.writeFileSync(busConfig, `<busconfig><type>session</type><listen>unix:tmpdir=${path.join(root,'run')}</listen><auth>EXTERNAL</auth>
        <policy context="default"><allow send_destination="*"/><allow receive_sender="*"/><allow own="*"/></policy></busconfig>`, {mode: 0o600});
    const identity = fs.statSync(root);
    const auth = path.join(root, 'Xauthority'); fs.writeFileSync(auth, '', {mode: 0o600});
    let number;
    for (let candidate = 80; candidate < 120; candidate++) if (!fs.existsSync(`/tmp/.X${candidate}-lock`) && !fs.existsSync(`/tmp/.X11-unix/X${candidate}`)) {number = candidate; break;}
    assert.ok(number); const display = `:${number}`;
    execFileSync('xauth', ['-f', auth, 'add', display, 'MIT-MAGIC-COOKIE-1', crypto.randomBytes(16).toString('hex')], {stdio: 'ignore'});
    const env = {PATH: process.env.PATH, LANG: 'C.UTF-8', TZ: 'UTC', HOME: path.join(root, 'home'), DISPLAY: display, XAUTHORITY: auth,
        XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'), XDG_DATA_HOME: path.join(root, 'data'),
        XDG_RUNTIME_DIR: path.join(root, 'run'), XDG_SESSION_TYPE: 'x11'};
    const xf = fs.openSync(path.join(evidenceDir, 'xvfb.stderr.txt'), 'a');
    const xvfb = spawn('Xvfb', [display, '-screen', '0', '1440x1000x24', '-nolisten', 'tcp', '-auth', auth, '-noreset'], {env, detached: true, stdio: ['ignore', 'ignore', xf]});
    fs.closeSync(xf);
    let session, cdp;
    const groups = [xvfb.pid];
    const known = new Map();
    const ownedProcesses = () => processes(groups, known, root);
    const close = async () => {
        const ownedBefore = ownedProcesses(); const beforeListeners = listeners(ownedBefore);
        if (cdp) {try {await cdp.send('Browser.close');} catch {} cdp.close();}
        for (const group of groups) if (processInfo(group)?.uid === process.getuid()) {try {process.kill(-group, 'SIGTERM');} catch {}}
        await delay(500);
        for (const item of ownedProcesses()) {try {process.kill(item.pid, 'SIGKILL');} catch {}}
        await delay(100);
        const remaining = ownedProcesses(), sockets = listeners(remaining);
        const rootNow = fs.statSync(root);
        assert.equal(rootNow.ino, identity.ino); assert.equal(rootNow.dev, identity.dev);
        assert.equal(fs.readFileSync(path.join(root, '.owner'), 'utf8'), token);
        write(path.join(evidenceDir, 'cleanup.json'), {ownedPidsBefore: ownedBefore.map(p => p.pid), listenersBefore: beforeListeners,
            remainingPids: remaining.map(p => p.pid), remainingOwnedListeners: sockets, xSocketExists: fs.existsSync(`/tmp/.X11-unix/X${number}`),
            profileRetainedForEvidence: true, profileRoot: root, noDailyBrowserClosed: true});
        assert.equal(remaining.length, 0); assert.equal(sockets.length, 0); assert.equal(fs.existsSync(`/tmp/.X11-unix/X${number}`), false);
    };
    try {
        await until(() => {if (xvfb.exitCode !== null) throw new Error('Owned Xvfb exited'); return fs.existsSync(`/tmp/.X11-unix/X${number}`);}, 15_000, 'Xvfb socket');
        const displayInfo = execFileSync('xdpyinfo', [], {env, encoding: 'utf8', timeout: 10_000});
        assert.match(displayInfo, /dimensions:\s+1440x1000 pixels/);
        fs.writeFileSync(path.join(evidenceDir, 'display-info.txt'), displayInfo);
        const net = await import('node:net'); const probe = net.createServer();
        await new Promise((resolve, reject) => {probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve);});
        const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
        const flags = ['--ozone-platform=x11', `--user-data-dir=${path.join(root, 'profile')}`, `--browseros-cdp-port=${port}`,
            '--disable-browseros-server', '--no-first-run', '--no-default-browser-check', `--load-extension=${fs.realpathSync(extensionDir)}`,
            '--window-size=1280,900', '--window-position=60,40', '--disable-background-networking', '--disable-component-update', '--disable-sync',
            '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', 'about:blank'];
        assert.ok(!flags.some(flag => /no-sandbox|disable.*sandbox|headless|remote-debugging-address/.test(flag)));
        const bf = fs.openSync(path.join(evidenceDir, 'neo.stderr.txt'), 'a');
        session = spawn('dbus-run-session', [`--config-file=${busConfig}`, '--', process.execPath, here, '--inner', root, JSON.stringify(flags)], {env, detached: true, stdio: ['ignore', bf, bf]});
        fs.closeSync(bf); groups.push(session.pid);
        const info = await until(() => fs.existsSync(path.join(root, 'browser.json')) && JSON.parse(fs.readFileSync(path.join(root, 'browser.json'), 'utf8')), 10_000, 'browser ownership metadata');
        assert.equal(info.display, display); assert.equal(info.home, env.HOME); assert.equal(info.waylandInherited, false);
        assert.ok(info.bus.startsWith('unix:')); assert.notEqual(info.bus, process.env.DBUS_SESSION_BUS_ADDRESS);
        await until(() => {if (session.exitCode !== null) throw new Error('Owned Neo session exited'); return listeners(ownedProcesses()).some(s => s.port === port);}, 45_000, 'owned loopback CDP listener');
        const owned = ownedProcesses(), bound = listeners(owned);
        assert.ok(owned.some(p => p.pid === info.pid && p.exe === '/usr/lib/browserclaw/browserclaw'));
        assert.ok(bound.length > 0 && bound.every(s => s.loopback && s.port === port), 'unexpected owned TCP listener');
        const desktop = desktopWindows(); assert.ok(desktop.every(w => !owned.some(p => p.pid === Number(w.pid))));
        write(path.join(evidenceDir, 'ownership-before-control.json'), {launchMode: 'linux-isolated-x11-browseros-loopback-cdp', headed: true,
            focusPolicy: 'separate authenticated Xvfb display; no test window on daily GNOME desktop', windowPlacement: 'normal 1280x900 at 60,40 on 1440x1000 display',
            applicationCommit: expectedApp, root, display, browser: info, ownedProcesses: owned, ownedListeners: bound,
            dailyDesktopWindows: desktop, windowTitlesRecorded: false, browserFlags: flags, sandboxDisabled: false,
            managedBrowserosServerDisabledForOwnedProcessOnly: true, nativeDesktopCuaTested: false, rtx5090WebGpuTested: false});
        const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        cdp = await Cdp.connect(version.webSocketDebuggerUrl);
        const browserVersion = await cdp.send('Browser.getVersion'); write(path.join(evidenceDir, 'browser-version.json'), {httpVersion: version, browserVersion});
        return {cdp, info, root, groups, port, env, close, owned: ownedProcesses, listeners: () => listeners(ownedProcesses())};
    } catch (error) {try {await close();} catch (cleanupError) {error.cleanupError = cleanupError.message;} throw error;}
}
