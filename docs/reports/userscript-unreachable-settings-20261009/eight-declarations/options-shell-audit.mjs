import fs from 'node:fs';
import {resolve, basename, dirname} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root = process.cwd(), directory = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(root, 'package.json'));
const runtime = require('vue'), ts = require('typescript'), {parseHTML} = require('linkedom');
const {parse, compileScript, compileTemplate} = require('vue/compiler-sfc');
const pluginVue = require('@vitejs/plugin-vue'), vue = pluginVue.default ?? pluginVue;
const {createServer} = await import(pathToFileURL(resolve(root, 'node_modules/vite/dist/node/index.js')).href);
const key = '__frActualOptionsGuardAudit';
const sectionIds = ['settings-image-translation','settings-area-translation','settings-video','settings-writing','settings-translation-stats','settings-model-usage'];
const actual = new Set(['/src/app/options/OptionsApp.vue','/src/features/settings/ui/SettingsSections.vue']);
const allResults = [];
async function runPhase(phase) {
 const {document, window} = parseHTML('<html><body><div id="app"></div></body></html>');
 const location = {hash:'#settings-general',search:'',href:'https://fixture.test/#settings-general',protocol:'https:'};
 const frames = new Map(); let nextFrame = 0, externalCalls = 0;
 Object.assign(window, {location, matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),
  requestAnimationFrame(fn){frames.set(++nextFrame,fn);return nextFrame},cancelAnimationFrame(id){frames.delete(id)}});
 const history = {replaceState(_a,_b,url){location.hash=String(url)}};
 Object.assign(globalThis,{window,document,history,HTMLElement:window.HTMLElement,Node:window.Node,Event:window.Event,MutationObserver:window.MutationObserver,ResizeObserver:class {observe(){}unobserve(){}disconnect(){}},
  getComputedStyle:el=>({display:el.style.display||'block',visibility:'visible'}),
  requestAnimationFrame:window.requestAnimationFrame,cancelAnimationFrame:window.cancelAnimationFrame,
  fetch(){externalCalls++;throw Error('External network prohibited')}});
 window.HTMLElement.prototype.scrollTo=function(){};
 window.HTMLElement.prototype.scrollIntoView=function(){};
 window.HTMLElement.prototype.getBoundingClientRect=()=>({top:0,left:0,right:800,bottom:700,width:800,height:700});
 window.HTMLElement.prototype.getClientRects=()=>[{top:0}];
 const childMounts=[], patches=[], errors=[];
 const data = {config:{},configReady:Promise.resolve(),
  subscribeConfig(listener){listener({...this.config});return ()=>{}},
  requestConfigPatch:async value=>{patches.push(Object.keys(value))}, handoffPendingConfigPatches:async()=>{},
  childMount:name=>childMounts.push(name),
  browser:{runtime:{sendMessage:async()=>{}},tabs:{query:async()=>[],sendMessage:async()=>{}}}};
 // Method bindings stay stable when exported as independent config ports.
 data.subscribeConfig=listener=>{listener({...data.config});return ()=>{}};
 globalThis[key]=data;
 const sourceFor = filename => filename.endsWith('/SettingsSections.vue')
  ? fs.readFileSync(resolve(directory,phase==='before'?'SettingsSections.before.vue.txt':'SettingsSections.candidate.vue.txt'),'utf8') : fs.readFileSync(filename,'utf8');
 const ports={name:'cw-actual-options-external-ports',enforce:'pre',resolveId(id){
  if(id.endsWith('.vue') && ![...actual].some(file=>id.endsWith(file)))return '\0guard-child:'+basename(id);
  if(id.endsWith('/src/services/config/store'))return '\0guard-store';
  if(id.endsWith('/src/ui/i18n'))return '\0guard-i18n';
  if(id.endsWith('/src/ui/interfaceAppearance'))return '\0guard-appearance';
  if(id.endsWith('/src/platform/browser/capabilities'))return '\0guard-capabilities';
  if(id==='webextension-polyfill')return '\0guard-browser';
  if(id==='element-plus')return '\0guard-element';
  if(id==='@element-plus/icons-vue')return '\0guard-icons';
  return null;
 },load(id){
  if(id.endsWith('/SettingsSections.vue'))return sourceFor(id);
  if(id.startsWith('\0guard-child:'))return `import {h,onMounted} from 'vue';export default {name:${JSON.stringify(id.slice(13))},inheritAttrs:false,setup(_, {attrs,slots,expose}) {expose({cancelPendingAnchor(){},highlightAnchor(){}});onMounted(()=>globalThis.${key}.childMount(${JSON.stringify(id.slice(13))}));return()=>h('div',attrs,Object.values(slots).flatMap(slot=>slot?.({connectionActionTarget:'fixture'})||[]));}}`;
  if(id==='\0guard-store')return `export const {config,configReady,subscribeConfig,requestConfigPatch,handoffPendingConfigPatches}=globalThis.${key};`;
  if(id==='\0guard-i18n')return "import {ref} from 'vue';export const useUiI18n=()=>({language:ref('zh-CN'),t:k=>k,translateLegacy:v=>v});export const localizeServiceOptions=options=>options;";
  if(id==='\0guard-appearance')return 'export const applyInterfaceFont=()=>{},applyInterfaceSkin=()=>{},applyInterfaceTheme=()=>{},registerInterfaceAppearanceRoot=()=>()=>{};';
  if(id==='\0guard-capabilities')return "export const browserCapabilities={browser:'userscript',imageTranslation:false,areaTranslation:false,videoSubtitles:false};";
  if(id==='\0guard-browser')return `export default globalThis.${key}.browser;`;
  if(id==='\0guard-element')return 'export const ElMessage=Object.assign(()=>{},{warning(){},success(){},error(){}});export const ElMessageBox={confirm:async()=>{}};';
  if(id==='\0guard-icons')return 'export const ArrowRight={render:()=>null};export const InfoFilled=ArrowRight;export const Edit=ArrowRight;';
  return null;
 }};
 const server=await createServer({configFile:false,publicDir:false,appType:'custom',logLevel:'silent',root,
  plugins:[ports,vue()],resolve:{alias:{'@':root}},define:{'import.meta.env.BROWSER':JSON.stringify('userscript')},
  optimizeDeps:{noDiscovery:true,include:[]},ssr:{noExternal:['element-plus','@element-plus/icons-vue','webextension-polyfill']},
  server:{host:'127.0.0.1',ws:false,hmr:false,middlewareMode:true,watch:null}});
 let app;
 try {
  const model=await server.ssrLoadModule('/src/core/config/model.ts');Object.assign(data.config,model.normalizeConfig({uiLanguage:'zh-CN'}));
  async function loadClient(relative){
   const filename=resolve(root,relative), source=sourceFor(filename),{descriptor}=parse(source,{filename});
   const script=compileScript(descriptor,{id:'actual-options-guard-audit'});
   const component=(await server.ssrLoadModule('/'+relative)).default;
   const template=compileTemplate({source:descriptor.template.content,filename,id:'actual-options-guard-audit',compilerOptions:{mode:'function',cacheHandlers:true,bindingMetadata:script.bindings,expressionPlugins:['typescript']}});
   assert.equal(template.errors.length,0);component.ssrRender=undefined;
   component.render=new Function('Vue',ts.transpileModule(template.code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(runtime);
   return component;
  }
  const settings=await loadClient('src/features/settings/ui/SettingsSections.vue');
  const options=await loadClient('src/app/options/OptionsApp.vue');
  const renderer=runtime.createRenderer({patchProp(el,name,before,next){
   if(/^on[A-Z]/u.test(name)){const event=name.slice(2).toLowerCase();el.__events??={};if(el.__events[name])el.removeEventListener(event,el.__events[name]);if(next){const fn=e=>(Array.isArray(next)?next:[next]).forEach(f=>f?.(e));el.__events[name]=fn;el.addEventListener(event,fn)}return}
   if(name==='class'){el.className=String(next??'');return}if(name==='style'&&next&&typeof next==='object'){Object.assign(el.style,next);return}
   if(next===undefined||next===null||next===false)el.removeAttribute(name);else el.setAttribute(name,String(next));
  },insert:(node,owner,anchor=null)=>owner.insertBefore(node,anchor),remove:node=>node.parentNode?.removeChild(node),
   createElement:tag=>runtime.markRaw(document.createElement(tag)),createText:text=>document.createTextNode(text),createComment:text=>document.createComment(text),
   setText:(node,text)=>node.nodeValue=text,setElementText:(el,text)=>el.textContent=text,parentNode:node=>node.parentNode,nextSibling:node=>node.nextSibling,
   querySelector:q=>document.querySelector(q),setScopeId(){},cloneNode:node=>node.cloneNode(true),
   insertStaticContent(html,owner,anchor){const el=document.createElement('template');el.innerHTML=html;const first=el.content.firstChild,last=el.content.lastChild;owner.insertBefore(el.content,anchor);return[first,last]}});
  let optionVm;
  function mountRoot(){
   app=renderer.createApp({render:()=>runtime.h(options,{ref:vm=>optionVm=vm})});
   app.provide(runtime.ssrContextKey,{modules:new Set()});app.config.warnHandler=()=>{};app.config.errorHandler=e=>errors.push(String(e?.stack??e));
   app.mount(document.getElementById('app'));
  }
  mountRoot();
  async function settle(){for(let i=0;i<8;i++){await runtime.nextTick();await new Promise(resolve=>setImmediate(resolve))}assert.deepEqual(errors,[])}
  await settle();const rootState=optionVm.$.setupState;
  function settingsInstance(){let found;const walk=node=>{if(!node||found)return;if(node.component){if(node.component.type===settings){found=node.component;return}walk(node.component.subTree)}if(Array.isArray(node.children))node.children.forEach(walk)};walk(app._instance.subTree);return found}
  assert(document.querySelector('#settings-general'));const first=settingsInstance();assert(first);first.setupState.config.to='fr';await settle();
  const trace=[];
  for(const requested of sectionIds){
   // Both route entry points execute the actual Options shell methods/listeners.
   rootState.selectSection(requested);await settle();const nav=document.querySelector('.userscript-unavailable');assert(nav);assert(nav.textContent.includes('options.userscriptUnavailableTitle'));assert(!settingsInstance());
   const navRecord={requested,resolved:rootState.activeSection,notice:nav.textContent};
   rootState.selectSection('settings-general');await settle();assert.equal(settingsInstance().uid,first.uid);assert.equal(settingsInstance().setupState.config.to,'fr');
   location.hash='#'+requested;window.dispatchEvent(new window.Event('hashchange'));await settle();assert(document.querySelector('.userscript-unavailable'));assert(!settingsInstance());
   navRecord.deepLinkResolved=rootState.activeSection;
   rootState.selectSection('settings-general');await settle();assert.equal(settingsInstance().uid,first.uid);assert.equal(settingsInstance().setupState.config.to,'fr');
   trace.push(navRecord);
  }
  rootState.selectSection('settings-selection');await settle();assert(document.querySelector('#settings-selection'));assert.equal(settingsInstance().uid,first.uid);
  for(let i=0;i<100&&!childMounts.some(name=>name.includes('LocalTtsSettings'));i++){await new Promise(resolve=>setTimeout(resolve,10));await settle()}
  const ttsMounted=childMounts.some(name=>name.includes('LocalTtsSettings'));
  fs.writeFileSync(resolve(directory,'options-child-mounts-'+phase+'.json'),JSON.stringify({childMounts,section:rootState.activeSection,errors},null,2)+'\n');
  assert(ttsMounted,'supported selection must still mount LocalTtsSettings');
  const prohibited=['WritingSettings','ImageOcrSettings','MangaSettings','VideoLocalModelSettings','VideoSubtitleAppearanceSettings','ModelUsageDashboard','TranslationStatsDashboard','AreaTranslationSettings'];
  assert(!childMounts.some(name=>prohibited.some(p=>name.includes(p))));assert.equal(externalCalls,0);
  const initialDeepLinks=[];
  for(const requested of sectionIds){
   app.unmount();location.hash='#'+requested;mountRoot();await settle();
   const fresh=optionVm.$.setupState;const notice=document.querySelector('.userscript-unavailable');
   assert(notice);assert(notice.textContent.includes('options.userscriptUnavailableTitle'));assert(!settingsInstance());
   initialDeepLinks.push({requested,resolved:fresh.activeSection,notice:notice.textContent});
   fresh.selectSection('settings-general');await settle();assert(document.querySelector('#settings-general'));assert(settingsInstance());
  }
  const result={phase,source:'actual OptionsApp and SettingsSections setup + client templates; real Vue KeepAlive and navigation resolver',ports:'config/browser/appearance and unrelated UI leaves; neither root, availability decision, routes, template, nor KeepAlive replaced',trace,initialDeepLinks,keepAliveSameInstance:true,draftPreserved:'fr',localTtsMounted:ttsMounted,prohibitedChildMounts:[],externalCalls,errors};
  allResults.push(result);
 } finally {app?.unmount();await server.close();delete globalThis[key]}
}
try {for(const phase of ['before','after'])await runPhase(phase);assert.deepEqual(allResults[0].trace,allResults[1].trace);assert.deepEqual(allResults[0].initialDeepLinks,allResults[1].initialDeepLinks);fs.writeFileSync(resolve(directory,'actual-options-shell-before-after.json'),JSON.stringify({passed:true,results:allResults},null,2)+'\n');console.log(JSON.stringify({passed:true,phases:2,restrictedSections:6,routeCases:24,initialDeepLinkCases:12,keepAlive:true,localTts:true,externalCalls:0}));}
catch(error){fs.writeFileSync(resolve(directory,'actual-options-shell-failure.txt'),String(error.stack??error));console.error(String(error.stack??error));process.exitCode=1}
