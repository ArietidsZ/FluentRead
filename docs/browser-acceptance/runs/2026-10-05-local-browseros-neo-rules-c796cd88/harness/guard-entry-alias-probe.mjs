/**
 * @file guard-entry-alias-probe.mjs
 * 本文件复现并复核 DEFECT-07：把「焦点守卫」放到 /tmp 符号链接路径下调用，
 * 比较修复前后（cf541253 的旧版本 vs c796cd88 的新版本）的实际行为。
 * 它只启动子进程跑 --self-check，不碰 macOS 窗口、不启动浏览器、不动 profile。
 * 输入：argv[2] = 旧版守卫文件路径；argv[3] = 新版守卫文件路径；argv[4] = 输出 JSON 路径。
 * 输出：打印一行 JSON 结果。
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const [oldGuard,newGuard,output]=process.argv.slice(2);
if(!oldGuard||!newGuard||!output)throw new Error('Usage: guard-entry-alias-probe.mjs OLD_GUARD NEW_GUARD OUTPUT_JSON');

const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'fluentread-guard-alias-'));
const run=file=>{
  const result=spawnSync(process.execPath,[file,'--self-check'],{encoding:'utf8',timeout:15000});
  const stdout=result.stdout.trim();
  let parsed=null;
  try{parsed=JSON.parse(stdout);}catch{/* silent or non-JSON output is the interesting case */}
  return {exitStatus:result.status,signal:result.signal,stdout,stderr:result.stderr.trim(),parsedOk:parsed?.ok===true,silentNoOp:stdout===''&&result.status===0};
};

/** 关键：/tmp 是指向 /private/tmp 的符号链接，因此这个路径同时触发「祖先目录符号链接」这一形状。 */
const aliasDirectory=path.join('/tmp',path.basename(scratch));
await fs.symlink(scratch,aliasDirectory,'dir');
const aliasFile=path.join(aliasDirectory,'guard-alias.mjs');
const results={scratch,aliasDirectory};
try {
  for(const [label,source] of [['old-cf541253',oldGuard],['new-c796cd88',newGuard]]) {
    const real=path.join(scratch,`${label}.mjs`);
    await fs.copyFile(source,real);
    await fs.symlink(real,aliasFile);
    results[label]={
      canonicalPath:run(real),
      tmpAliasPath:run(aliasFile),
      argv1UsedForAlias:aliasFile,
      realpathOfAlias:await fs.realpath(aliasFile),
    };
    await fs.unlink(aliasFile);
  }
} finally {
  await fs.unlink(aliasDirectory).catch(()=>{});
  await fs.rm(scratch,{recursive:true,force:true});
}
results.interpretation={
  before:'old guard invoked through a /tmp alias printed nothing and exited 0 — the entry check compared import.meta.url (already /private/tmp/...) with path.resolve(argv[1]) (/tmp/...), so the guard silently did nothing (DEFECT-07).',
  after:'new guard resolves both sides with fs.realpath, so the same alias invocation runs the real --self-check and prints its JSON.',
};
results.defect07Resolved=results['new-c796cd88'].tmpAliasPath.parsedOk===true&&results['new-c796cd88'].tmpAliasPath.silentNoOp===false;
await fs.writeFile(output,JSON.stringify(results,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({output,oldAlias:results['old-cf541253'].tmpAliasPath,newAlias:results['new-c796cd88'].tmpAliasPath,defect07Resolved:results.defect07Resolved},null,2));
