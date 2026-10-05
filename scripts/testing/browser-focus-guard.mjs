#!/usr/bin/env node
/** Local-Agent-only macOS observer for an already owned temporary browser. Never launches, focuses, moves or closes a browser. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),hash=value=>createHash('sha256').update(value).digest('hex');
const intersects=(a,b)=>a.left<b.left+b.width&&a.left+a.width>b.left&&a.top<b.top+b.height&&a.top+a.height>b.top;

export function checkFocusSnapshot({browserPid,frontmostPid,windows,displays}) {
  assert(Number.isSafeInteger(browserPid)&&browserPid>0&&Number.isSafeInteger(frontmostPid)&&frontmostPid>0,'Unknown foreground/browser PID');
  assert.notEqual(frontmostPid,browserPid,'Owned browser became foreground; stop test operations');
  assert(Array.isArray(displays)&&displays.length>0&&Array.isArray(windows)&&windows.length>0,'Unknown windows or displays');
  for(const rect of [...windows,...displays])for(const field of ['left','top','width','height'])assert(Number.isFinite(rect[field]),'Unknown window/display bounds');
  for(const rect of displays)assert(rect.width>0&&rect.height>0,'Active display dimensions must be positive');
  for(const window of windows) {
    assert(window.windowState==='normal'&&window.width>=800&&window.height>=600,'Test window must be normal-sized and not minimized/fullscreen');
    assert(displays.every(display=>!intersects(window,display)),'Test window intersects an active display; stop and restore approved offscreen placement');
  }
}

export function verifyListener(text,pid,port) {
  const pids=text.split('\n').filter(line=>line.startsWith('p')).map(line=>Number(line.slice(1)));
  const names=text.split('\n').filter(line=>line.startsWith('n')).map(line=>line.slice(1));
  assert(pids.length>0&&pids.every(value=>value===pid),'CDP listener is not owned by the supplied browser PID');
  assert(names.length>0&&names.every(name=>name===`127.0.0.1:${port}`||name===`[::1]:${port}`||name===`::1:${port}`),'CDP listener is not loopback-only');
}

function exactArgument(command,flag) {
  const matches=[...command.matchAll(new RegExp(`(?:^|\\s)${flag}(?:=|\\s)(\\S+)`,'gu'))];
  assert.equal(matches.length,1,`Missing or ambiguous ${flag} in process command`);
  assert(path.isAbsolute(matches[0][1])&&!/["']/u.test(matches[0][1]),`Unsupported ${flag} spelling; use an unquoted absolute temporary path without spaces`);
  return matches[0][1];
}

export async function verifyProfileArgument(command,expectedProfile,canonicalize=fs.realpath) {
  assert.equal(await canonicalize(exactArgument(command,'--user-data-dir')),expectedProfile,'PID command does not identify the exact temporary profile');
}

const osProbe="ObjC.import('AppKit');const f=$.NSWorkspace.sharedWorkspace.frontmostApplication;const screens=$.NSScreen.screens;const first=screens.objectAtIndex(0).frame;const top=Number(first.origin.y)+Number(first.size.height);const displays=[];for(let i=0;i<screens.count;i++){const r=screens.objectAtIndex(i).frame;displays.push({left:Number(r.origin.x),top:top-Number(r.origin.y)-Number(r.size.height),width:Number(r.size.width),height:Number(r.size.height)});}JSON.stringify({frontmostPid:Number(f.processIdentifier),displays});";

async function connectCdp(port) {
  const response=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(3000)});
  assert(response.ok,'Existing CDP discovery failed');const version=await response.json();
  const url=new URL(version.webSocketDebuggerUrl);
  assert(url.protocol==='ws:'&&url.hostname==='127.0.0.1'&&Number(url.port)===port&&url.pathname.startsWith('/devtools/browser/'),'Unverified CDP websocket destination');
  const socket=new WebSocket(url),pending=new Map();let id=0;
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('CDP connection timeout')),3000);socket.addEventListener('open',()=>{clearTimeout(timeout);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timeout);reject(new Error('CDP connection failed'));},{once:true});});
  socket.addEventListener('message',event=>{let message;try{message=JSON.parse(event.data);}catch{return;}const call=pending.get(message.id);if(!call)return;pending.delete(message.id);clearTimeout(call.timer);message.error?call.reject(new Error(`CDP read denied: ${message.error.message}`)):call.resolve(message.result);});
  socket.addEventListener('close',()=>{for(const call of pending.values()){clearTimeout(call.timer);call.reject(new Error('CDP disconnected'));}pending.clear();});
  return {close:()=>socket.close(),request:(method,params={})=>new Promise((resolve,reject)=>{
    assert(['Target.getTargets','Browser.getWindowForTarget','Browser.getWindowBounds'].includes(method),'Guard only permits window inventory reads');
    const current=++id,timer=setTimeout(()=>{pending.delete(current);reject(new Error(`CDP read timeout: ${method}`));},3000);pending.set(current,{resolve,reject,timer});socket.send(JSON.stringify({id:current,method,params}));
  })};
}

async function runGuard(args) {
  assert.equal(process.platform,'darwin','This observer requires macOS; it has not been browser-certified here');
  const value=name=>{const i=args.indexOf(name);assert(i>=0&&args[i+1],`Missing ${name}`);return args[i+1];};
  const profile=await fs.realpath(value('--profile')),pid=Number(value('--pid')),port=Number(value('--port')),output=path.resolve(value('--output'));
  assert(Number.isSafeInteger(pid)&&pid>1&&Number.isSafeInteger(port)&&port>1023&&port<65536,'Invalid owned PID/CDP port');
  const temporaryRoots=await Promise.all([os.tmpdir(),'/tmp'].map(dir=>fs.realpath(dir)));
  assert(temporaryRoots.some(dir=>profile.startsWith(dir+path.sep))&&path.basename(profile).startsWith('fluentread-'),'Only explicitly owned FluentRead temporary profiles are supported');
  const report={status:'starting',mode:args.includes('--once')?'once':'continuous',browserPid:pid,cdpPort:port,profilePathSha256:hash(profile),samplePolicy:'serial read-only polling; inspect observed gaps; stop operations when guard is not running',events:[]};
  const write=async()=>{await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output+'.tmp',JSON.stringify(report,null,2)+'\n',{mode:0o600});await fs.rename(output+'.tmp',output);};
  let cdp,stopping=false,ownedServer;
  const processIdentity=async ownedPid=>{
    const uid=Number((await exec('/bin/ps',['-p',String(ownedPid),'-o','uid='],{timeout:3000})).stdout.trim());assert.equal(uid,process.getuid(),'Process is not owned by this user');
    const command=(await exec('/bin/ps',['-ww','-p',String(ownedPid),'-o','command='],{timeout:3000})).stdout.trim();
    const started=(await exec('/bin/ps',['-p',String(ownedPid),'-o','lstart='],{timeout:3000})).stdout.trim();assert(started&&command,'Process disappeared');
    return {uid,command,signature:hash(`${command}\n${started}`)};
  };
  const stop=()=>{stopping=true;};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try {
    const profileStat=await fs.stat(profile);assert(profileStat.isDirectory()&&profileStat.uid===process.getuid()&&(profileStat.mode&0o077)===0,'Temporary profile must be owned by this user with private permissions; guard will not chmod it');
    const identity=await processIdentity(pid),owner=identity.uid,command=identity.command;
    await verifyProfileArgument(command,profile);
    assert(command.includes(`--remote-debugging-port=${port}`)||command.includes('--remote-debugging-port=0'),'PID command lacks the observed CDP listener');
    verifyListener((await exec('/usr/sbin/lsof',['-nP',`-iTCP:${port}`,'-sTCP:LISTEN','-FpFn'],{timeout:3000})).stdout,pid,port);
    const marker=path.join(profile,'.fluentread-acceptance-owner.json'),ownership={pid,port,uid:owner,profilePathSha256:hash(profile)};
    try{await fs.writeFile(marker,JSON.stringify(ownership)+'\n',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;assert.deepEqual(JSON.parse(await fs.readFile(marker,'utf8')),ownership,'Existing profile marker differs; do not overwrite it');}
    if(args.includes('--server-pid')) {
      const serverPid=Number(value('--server-pid')),config=await fs.realpath(value('--server-config'));
      assert(Number.isSafeInteger(serverPid)&&serverPid>1&&serverPid!==pid,'Invalid task-scoped server PID');
      assert(config.startsWith((await fs.realpath(path.dirname(output)))+path.sep),'Server config must be inside this run directory');
      const server=await processIdentity(serverPid);
      assert(/(?:^|\s)--stdio(?:\s|$)/u.test(server.command),'Server is not explicitly task-scoped stdio');
      assert.equal(await fs.realpath(exactArgument(server.command,'--config')),config,'Server config mismatch');
      ownedServer={pid:serverPid,signature:server.signature};
      const configBytes=await fs.readFile(config);assert.equal(JSON.parse(configBytes).ports?.cdp,port,'Task-scoped server points at another browser CDP port');
      ownedServer.config=config;ownedServer.configSha256=hash(configBytes);report.serverConfigSha256=ownedServer.configSha256;
    }
    cdp=await connectCdp(port);
    while(!stopping) {
      const started=Date.now();
      const currentIdentity=await processIdentity(pid);assert.equal(currentIdentity.signature,identity.signature,'Browser process identity changed');
      await verifyProfileArgument(currentIdentity.command,profile);
      const currentProfile=await fs.stat(profile);assert(currentProfile.uid===owner&&(currentProfile.mode&0o077)===0,'Temporary profile ownership/permissions changed');
      verifyListener((await exec('/usr/sbin/lsof',['-nP',`-iTCP:${port}`,'-sTCP:LISTEN','-FpFn'],{timeout:3000})).stdout,pid,port);
      if(ownedServer){assert.equal((await processIdentity(ownedServer.pid)).signature,ownedServer.signature,'Task-scoped server identity changed');assert.equal(hash(await fs.readFile(ownedServer.config)),ownedServer.configSha256,'Task-scoped server config changed');}
      const observed=JSON.parse((await exec('/usr/bin/osascript',['-l','JavaScript','-e',osProbe],{timeout:3000})).stdout);
      const {targetInfos}=await cdp.request('Target.getTargets'),windows=[],seen=new Set();
      for(const target of targetInfos.filter(target=>target.type==='page')) {
        const result=await cdp.request('Browser.getWindowForTarget',{targetId:target.targetId});
        if(seen.has(result.windowId))continue;seen.add(result.windowId);
        const {bounds}=await cdp.request('Browser.getWindowBounds',{windowId:result.windowId});windows.push({...bounds,windowId:result.windowId});
      }
      // Sample again after window reads; no permission acceptance, focus or placement operation is attempted.
      const after=JSON.parse((await exec('/usr/bin/osascript',['-l','JavaScript','-e',osProbe],{timeout:3000})).stdout);
      checkFocusSnapshot({browserPid:pid,...observed,windows});checkFocusSnapshot({browserPid:pid,...after,windows});
      report.status='running';report.lastObservedAt=new Date().toISOString();
      report.events.push({event:'focus-window-observation',at:report.lastObservedAt,context:'owned-temporary-browser',frontmostPidBefore:observed.frontmostPid,frontmostPidAfter:after.frontmostPid,windows,displays:after.displays,observationMs:Date.now()-started});await write();
      if(args.includes('--once'))break;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    report.status='stopped';report.events.push({event:'guard-stopped',at:new Date().toISOString(),context:'owned-temporary-browser'});await write();
  } catch(error) {
    report.status='blocked';report.events.push({event:'guard-violation',at:new Date().toISOString(),context:'owned-temporary-browser',error:error.message});await write();throw error;
  } finally {
    if(ownedServer)try{if((await processIdentity(ownedServer.pid)).signature===ownedServer.signature)process.kill(ownedServer.pid,'SIGTERM');}catch{/* Never signal a missing or re-used PID. */}
    cdp?.close();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  }
}

async function selfCheck() {
  const good={browserPid:20,frontmostPid:30,windows:[{left:2500,top:0,width:1200,height:900,windowState:'normal'}],displays:[{left:0,top:0,width:1920,height:1080}]};
  checkFocusSnapshot(good);verifyListener('p20\nn127.0.0.1:9111\n',20,9111);
  for(const bad of [{...good,frontmostPid:20},{...good,windows:[]},{...good,displays:[]},{...good,windows:[{...good.windows[0],left:1800}]},{...good,windows:[{...good.windows[0],windowState:'minimized'}]},{...good,windows:[{...good.windows[0],width:100}]}])assert.throws(()=>checkFocusSnapshot(bad));
  assert.throws(()=>checkFocusSnapshot({...good,displays:[{...good.displays[0],width:0}]}));
  assert.throws(()=>verifyListener('p21\nn127.0.0.1:9111\n',20,9111));assert.throws(()=>verifyListener('p20\nn*:9111\n',20,9111));
  const aliases=async value=>value.replace(/^\/tmp\//u,'/private/tmp/');
  await verifyProfileArgument('BrowserOS --user-data-dir=/tmp/fluentread-owned --remote-debugging-port=9111','/private/tmp/fluentread-owned',aliases);
  await assert.rejects(()=>verifyProfileArgument('BrowserOS --user-data-dir=/tmp/fluentread-owned-other --remote-debugging-port=9111','/private/tmp/fluentread-owned',aliases));
  await assert.rejects(()=>verifyProfileArgument('BrowserOS --user-data-dir=/tmp/fluentread-owned --user-data-dir=/tmp/fluentread-other','/private/tmp/fluentread-owned',aliases));
  console.log(JSON.stringify({ok:true,scope:'pure guard contract checks only',macosRun:false,browserRun:false}));
}
try {
  if(process.argv[1]&&process.argv[1]!=='-'&&await fs.realpath(process.argv[1])===await fs.realpath(fileURLToPath(import.meta.url))) {
    if(process.argv.includes('--self-check'))await selfCheck();else await runGuard(process.argv.slice(2));
  }
} catch(error){console.error(error.message);process.exitCode=1;}
