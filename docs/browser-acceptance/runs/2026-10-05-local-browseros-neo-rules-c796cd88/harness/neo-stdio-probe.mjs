/**
 * @file neo-stdio-probe.mjs
 * 本文件是一次性本地探针：以 stdio 子进程方式启动任务专用的 BrowserOS Neo 控制面
 * （browseros-claw-server --config <本次运行目录内的一次性 JSON> --stdio），
 * 只执行 initialize / tools/list 这类只读握手，核对实际工具清单，然后结束子进程。
 * 它不写入任何持久 client 配置、不访问浏览器页面、不执行任何会改变状态的工具。
 * 输入：argv[2] = server 可执行文件路径；argv[3] = 一次性 sidecar 配置路径；
 *       argv[4] = 工作目录（BROWSERCLAW_DIR，本次运行目录内的独立状态目录）。
 * 输出：stdout 打印一行 JSON 结果。
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';

const [server,config,stateDir]=process.argv.slice(2);
if(!server||!config||!stateDir)throw new Error('Usage: neo-stdio-probe.mjs SERVER CONFIG STATE_DIR');

await fs.mkdir(stateDir,{recursive:true,mode:0o700});
const sidecar=JSON.parse(await fs.readFile(config,'utf8'));
const child=spawn(server,['--config',config,'--stdio'],{
  env:{...process.env,BROWSERCLAW_DIR:stateDir},
  stdio:['pipe','pipe','pipe'],
});

const stderr=[];
child.stderr.on('data',chunk=>stderr.push(chunk.toString()));

let buffer='';
const pending=new Map();
child.stdout.on('data',chunk=>{
  buffer+=chunk.toString();
  let index;
  while((index=buffer.indexOf('\n'))>=0){
    const line=buffer.slice(0,index).trim();buffer=buffer.slice(index+1);
    if(!line)continue;
    let message;try{message=JSON.parse(line);}catch{continue;}
    const call=pending.get(message.id);
    if(!call)continue;
    pending.delete(message.id);
    clearTimeout(call.timer);
    message.error?call.reject(new Error(JSON.stringify(message.error))):call.resolve(message.result);
  }
});

let nextId=0;
const request=(method,params={},timeoutMs=15000)=>new Promise((resolve,reject)=>{
  const id=++nextId;
  const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timeout waiting for ${method}`));},timeoutMs);
  pending.set(id,{resolve,reject,timer});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
});
const notify=(method,params={})=>child.stdin.write(JSON.stringify({jsonrpc:'2.0',method,params})+'\n');

const result={server,config,stateDir,cwd:process.cwd(),pid:null,initialized:false,tools:[],toolsCount:0,resources:[],errors:[],stderrHead:''};
try{
  result.pid=child.pid;
  const init=await request('initialize',{
    protocolVersion:'2025-06-18',
    capabilities:{},
    clientInfo:{name:'fluentread-acceptance-local-probe',version:'1.0.0'},
  });
  result.initialized=true;
  result.serverInfo=init.serverInfo||null;
  result.protocolVersion=init.protocolVersion||null;
  result.capabilities=init.capabilities||null;
  notify('notifications/initialized');
  const tools=await request('tools/list');
  result.tools=(tools.tools||[]).map(tool=>tool.name).sort();
  result.toolsCount=result.tools.length;
  try{
    const resources=await request('resources/list');
    result.resources=(resources.resources||[]).map(item=>item.uri);
  }catch(error){result.errors.push(`resources/list: ${error.message}`);}
}catch(error){
  result.errors.push(error.message);
}finally{
  child.stdin.end();
  await new Promise(resolve=>setTimeout(resolve,300));
  if(child.exitCode===null)child.kill('SIGTERM');
  await new Promise(resolve=>setTimeout(resolve,300));
  result.exitCode=child.exitCode;
  result.stderrHead=stderr.join('').slice(0,1200);
}
console.log(JSON.stringify(result,null,2));
