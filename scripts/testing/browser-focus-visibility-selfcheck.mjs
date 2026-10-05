#!/usr/bin/env node
/** Pure policy/geometry regressions. Never opens a window, browser or macOS API. */
import assert from 'node:assert/strict';
import {checkFocusSnapshot,visibilityPolicyFromArgs,STRICT_VISIBILITY_POLICY,PARTIAL_VISIBILITY_POLICY} from './browser-focus-guard.mjs';
import {validateFocusEvidence,validatePassEvidence} from './browser-acceptance-evidence.mjs';

const display={left:0,top:0,width:2560,height:1440};
// Geometry reported by the local macOS probe: a 40-coordinate-unit strip remains visible.
const clamped={left:2520,top:100,width:1200,height:900,windowState:'normal',windowId:1};
const base={browserPid:20,frontmostPid:30,windows:[clamped],displays:[display]};
let negativeChecks=0;
const rejects=action=>{assert.throws(action);negativeChecks++;};
assert.equal(visibilityPolicyFromArgs([]),STRICT_VISIBILITY_POLICY);
assert.equal(visibilityPolicyFromArgs(['--allow-partial-visibility']),PARTIAL_VISIBILITY_POLICY);
rejects(()=>checkFocusSnapshot(base));
const permitted={...base,visibilityPolicy:PARTIAL_VISIBILITY_POLICY};
assert.deepEqual(checkFocusSnapshot(permitted),[{windowId:1,windowArea:1080000,visibleArea:36000,classification:'partially-visible'}]);
assert.equal(checkFocusSnapshot({...permitted,windows:[{...clamped,left:2400} ]})[0].visibleArea,144000); // No invented 40-unit maximum.
assert.equal(checkFocusSnapshot({...permitted,windows:[{...clamped,left:2560}]})[0].classification,'offscreen');
assert.equal(checkFocusSnapshot({...base,windows:[{...clamped,left:2560}]})[0].classification,'offscreen');
for(const changed of [
  {frontmostPid:20},{windows:[{...clamped,left:100}]},{windows:[{...clamped,windowState:'minimized'}]},
  {windows:[{...clamped,windowState:'fullscreen'}]},{windows:[{...clamped,width:100}]},
  {displays:[]},{visibilityPolicy:'unknown'},
])rejects(()=>checkFocusSnapshot({...permitted,...changed}));
const spanning={...clamped,left:0,top:0};
rejects(()=>checkFocusSnapshot({...permitted,windows:[spanning],displays:[{left:0,top:0,width:600,height:900},{left:600,top:0,width:600,height:900}]}));
rejects(()=>checkFocusSnapshot({...permitted,windows:[spanning],displays:[{left:0,top:0,width:800,height:900},{left:400,top:0,width:800,height:900}]}));
assert.equal(checkFocusSnapshot({...permitted,windows:[spanning],displays:[{left:0,top:0,width:500,height:900},{left:700,top:0,width:500,height:900}]})[0].visibleArea,900000);
assert.equal(checkFocusSnapshot({...permitted,displays:[display,display]})[0].visibleArea,36000);

const observation=(at,snapshot=permitted)=>({event:'focus-window-observation',at,context:'synthetic-policy-contract',frontmostPidBefore:snapshot.frontmostPid,frontmostPidAfter:snapshot.frontmostPid,windows:snapshot.windows,displays:snapshot.displays,visibilityPolicy:snapshot.visibilityPolicy,visibility:checkFocusSnapshot(snapshot)});
const env={browserPid:20,profilePathSha256:'a'.repeat(64),visibilityPolicy:PARTIAL_VISIBILITY_POLICY};
const guard={status:'stopped',mode:'continuous',browserPid:20,profilePathSha256:env.profilePathSha256,visibilityPolicy:PARTIAL_VISIBILITY_POLICY,events:[observation('2026-10-05T00:00:00Z'),observation('2026-10-05T00:00:02Z')]};
const cases=[{id:'ENV-01',browserLogs:['browser.json']}];
const logs=()=>({events:[{event:'observed',at:'2026-10-05T00:00:01Z',context:'synthetic-policy-contract'}]});
validateFocusEvidence(env,guard,cases,logs);
for(const mutate of [
  e=>{delete e.visibilityPolicy;},e=>{e.visibilityPolicy=STRICT_VISIBILITY_POLICY;},e=>{e.visibilityPolicy='unknown';},
]){const wrong=structuredClone(env);mutate(wrong);rejects(()=>validateFocusEvidence(wrong,guard,cases,logs));}
for(const mutate of [
  g=>{delete g.visibilityPolicy;},g=>{g.events[0].visibilityPolicy=STRICT_VISIBILITY_POLICY;},
  g=>{delete g.events[0].visibility;},g=>{g.events[0].visibility[0].visibleArea=0;},
  g=>{g.events[0].frontmostPidAfter=20;},g=>{g.events[0].windows[0].left=100;},
  g=>{g.mode='once';},g=>{g.status='blocked';},g=>{g.events=g.events.slice(0,1);},
  g=>{g.events.push({event:'guard-violation'});},g=>{g.browserPid=21;},g=>{g.profilePathSha256='b'.repeat(64);},
]){const wrong=structuredClone(guard);mutate(wrong);rejects(()=>validateFocusEvidence(env,wrong,cases,logs));}
rejects(()=>validateFocusEvidence(env,guard,cases,()=>({events:[{at:'2026-10-05T00:00:03Z'}]})));
const strictSnapshot={...base,windows:[{...clamped,left:2560}],visibilityPolicy:STRICT_VISIBILITY_POLICY};
const strictGuard={...guard,visibilityPolicy:STRICT_VISIBILITY_POLICY,events:[observation('2026-10-05T00:00:00Z',strictSnapshot),observation('2026-10-05T00:00:02Z',strictSnapshot)]};
const strictEnv={...env,visibilityPolicy:STRICT_VISIBILITY_POLICY};validateFocusEvidence(strictEnv,strictGuard,cases,logs);
delete strictEnv.visibilityPolicy;delete strictGuard.visibilityPolicy;
for(const event of strictGuard.events){delete event.visibilityPolicy;delete event.visibility;}
validateFocusEvidence(strictEnv,strictGuard,cases,logs); // Old strict records stay strict, without rewriting them.
const blocked={cases:[{id:'ENV-01',status:'blocked'}],environment:{visibilityPolicy:STRICT_VISIBILITY_POLICY}};
const before=JSON.stringify(blocked);await validatePassEvidence(blocked,new Map(),'unused');assert.equal(JSON.stringify(blocked),before);
console.log(JSON.stringify({ok:true,node:process.version,negativeChecks,scope:'explicit visibility policy and evidence contracts only',macosRun:false,browserRun:false}));
