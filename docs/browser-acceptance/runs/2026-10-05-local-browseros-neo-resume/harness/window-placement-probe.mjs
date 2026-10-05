/**
 * @file window-placement-probe.mjs
 * 本文件是本地只读/可控窗口摆放探针：对已核对的临时浏览器实例，尝试若干
 * 「完全离开所有活动屏幕」的窗口位置，记录请求值与 WindowServer 实际生效值，
 * 用来判定 browser-focus-guard.mjs 的 offscreen 断言在本机是否可达。
 * 它只调用 Browser.getWindowBounds / Browser.setWindowBounds 与 AX 位置读取，
 * 不最小化窗口、不抢焦点、不调用 Page.bringToFront()、不改动显示配置。
 * 输入：argv[2] = 已验证的 CDP 回环端口；argv[3] = 该临时浏览器的主进程 PID。
 * 输出：stdout 打印一行 JSON 结果。
 */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);

const port=Number(process.argv[2]),pid=Number(process.argv[3]);
if(!Number.isSafeInteger(port)||port<1024||!Number.isSafeInteger(pid)||pid<2)throw new Error('Usage: window-placement-probe.mjs CDP_PORT BROWSER_PID');

const version=await (await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(3000)})).json();
const url=new URL(version.webSocketDebuggerUrl);
if(url.protocol!=='ws:'||url.hostname!=='127.0.0.1'||Number(url.port)!==port)throw new Error('Refusing unverified CDP destination');
const socket=new WebSocket(url);
const pending=new Map();
let id=0;
await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('CDP connect timeout')),3000);
  socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
  socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('CDP connect failed'));},{once:true});
});
socket.addEventListener('message',event=>{
  const message=JSON.parse(event.data);const call=pending.get(message.id);
  if(!call)return;pending.delete(message.id);
  message.error?call.reject(new Error(JSON.stringify(message.error))):call.resolve(message.result);
});
const send=(method,params={})=>new Promise((resolve,reject)=>{
  const current=++id;pending.set(current,{resolve,reject});socket.send(JSON.stringify({id:current,method,params}));
});

const osProbe="ObjC.import('AppKit');const screens=$.NSScreen.screens;const first=screens.objectAtIndex(0).frame;const top=Number(first.origin.y)+Number(first.size.height);const displays=[];for(let i=0;i<screens.count;i++){const r=screens.objectAtIndex(i).frame;displays.push({left:Number(r.origin.x),top:top-Number(r.origin.y)-Number(r.size.height),width:Number(r.size.width),height:Number(r.size.height)});}const f=$.NSWorkspace.sharedWorkspace.frontmostApplication;JSON.stringify({frontmostPid:Number(f.processIdentifier),displays});";
const osProfile=JSON.parse((await exec('/usr/bin/osascript',['-l','JavaScript','-e',osProbe],{timeout:5000})).stdout);

const {targetInfos}=await send('Target.getTargets');
const page=targetInfos.find(target=>target.type==='page');
if(!page)throw new Error('No page target in the temporary instance');
const {windowId}=await send('Browser.getWindowForTarget',{targetId:page.targetId});
const intersects=(a,b)=>a.left<b.left+b.width&&a.left+a.width>b.left&&a.top<b.top+b.height&&a.top+a.height>b.top;
const fullyOffscreen=bounds=>osProfile.displays.every(display=>!intersects(bounds,display));

const attempts=[];
for(const request of [
  {left:2560,top:100,width:1200,height:900},
  {left:4000,top:100,width:1200,height:900},
  {left:-1200,top:100,width:1200,height:900},
  {left:-9000,top:100,width:1200,height:900},
  {left:100,top:1440,width:1200,height:900},
  {left:100,top:-900,width:1200,height:900},
  {left:100,top:-9000,width:1200,height:900},
]){
  let error=null;
  await send('Browser.setWindowBounds',{windowId,bounds:{...request,windowState:'normal'}}).catch(reason=>{error=reason.message;});
  const {bounds}=await send('Browser.getWindowBounds',{windowId});
  attempts.push({method:'CDP Browser.setWindowBounds',request,error,achieved:bounds,fullyOffscreen:fullyOffscreen(bounds)});
}

// AX 位置写入是同机已验证可用的第二条路径，同样只记录实际生效值。
const axProbe=async(x,y)=>{
  try{
    await exec('/usr/bin/osascript',['-e',`tell application "System Events" to tell (first process whose unix id is ${pid}) to set position of window 1 to {${x}, ${y}}`],{timeout:8000});
  }catch(error){return {error:String(error.message).slice(0,200)};}
  const read=await exec('/usr/bin/osascript',['-e',`tell application "System Events" to tell (first process whose unix id is ${pid}) to get position of window 1`],{timeout:8000});
  const [left,top]=read.stdout.trim().split(',').map(Number);
  const {bounds}=await send('Browser.getWindowBounds',{windowId});
  return {achieved:{left,top},cdpBounds:bounds,fullyOffscreen:fullyOffscreen({...bounds,left,top})};
};
for(const [x,y] of [[2700,100],[6000,100],[-3000,100],[100,3000],[100,-3000]]){
  attempts.push({method:'AX System Events set position',request:{left:x,top:y},...(await axProbe(x,y))});
}

const reachable=attempts.some(attempt=>attempt.fullyOffscreen===true);
console.log(JSON.stringify({
  cdpPort:port,browserPid:pid,
  displays:osProfile.displays,
  frontmostPidDuringProbe:osProfile.frontmostPid,
  browserIsFrontmost:osProfile.frontmostPid===pid,
  attempts,
  fullyOffscreenReachable:reachable,
  conclusion:reachable
    ?'At least one placement left every active display; the guard offscreen assertion is reachable.'
    :'No requested placement produced a window outside every active display: the macOS WindowServer clamps normal windows so part of the window stays on a display, so browser-focus-guard.mjs cannot report running on this single-display arrangement.',
},null,2));
socket.close();
