#!/usr/bin/env node
/** CLI identity regression only: no macOS commands, browser, profile or window operations. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const guard=fileURLToPath(new URL('./browser-focus-guard.mjs',import.meta.url));
const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'fluentread-guard-entry-'));
const run=(args,input)=>{
  const result=spawnSync(process.execPath,args,{encoding:'utf8',timeout:10000,input});
  assert.ifError(result.error);return result;
};
const expectSelfCheck=args=>{
  const result=run(args);assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{ok:true,scope:'pure guard contract checks only',macosRun:false,browserRun:false});
};
try {
  const fileAlias=path.join(scratch,'guard-link.mjs'),directoryAlias=path.join(scratch,'directory-link');
  await fs.symlink(guard,fileAlias,'file');await fs.symlink(path.dirname(guard),directoryAlias,process.platform==='win32'?'junction':'dir');
  const directoryEntry=path.join(directoryAlias,path.basename(guard));
  expectSelfCheck([guard,'--self-check']);
  expectSelfCheck([fileAlias,'--self-check']);
  expectSelfCheck([directoryEntry,'--self-check']);
  expectSelfCheck(['--preserve-symlinks-main',fileAlias,'--self-check']);
  for(const entry of [guard,fileAlias,directoryEntry]) {
    const result=run([entry]);assert.notEqual(result.status,0);
    assert.match(result.stderr,process.platform==='darwin'?/Missing --profile/u:/requires macOS/u);
  }
  const importer=path.join(scratch,'importer.mjs');
  await fs.writeFile(importer,"await import(process.argv[2]);console.log('import-only');\n");
  for(const target of [guard,directoryEntry]) {
    const result=run([importer,pathToFileURL(target).href,'--self-check']);
    assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'import-only\n');
  }
  const expression=`await import(${JSON.stringify(pathToFileURL(guard).href)});console.log('import-only');`;
  const noEntry=run(['--input-type=module','--eval',expression]);
  assert.equal(noEntry.status,0,noEntry.stderr);assert.equal(noEntry.stdout,'import-only\n');
  const stdin=run(['--input-type=module','-'],expression);
  assert.equal(stdin.status,0,stdin.stderr);assert.equal(stdin.stdout,'import-only\n');
  const unresolved=path.join(scratch,'unresolved-entry.mjs');
  await fs.writeFile(unresolved,"process.argv[1]=process.argv[2];await import(process.argv[3]);\n");
  const failed=run([unresolved,path.join(scratch,'missing-entry.mjs'),pathToFileURL(guard).href]);
  assert.notEqual(failed.status,0);assert.match(failed.stderr,/ENOENT/u);
  console.log(JSON.stringify({ok:true,node:process.version,checks:['direct CLI','file symlink CLI','ancestor-directory symlink CLI','preserved symlink main','ordinary direct/alias invocation rejects unmet prerequisites','direct import without CLI execution','aliased import without CLI execution','eval import without entry argument','stdin import with dash entry argument','unresolvable entry fails nonzero'],macosRun:false,browserRun:false}));
} finally {await fs.rm(scratch,{recursive:true,force:true});}
