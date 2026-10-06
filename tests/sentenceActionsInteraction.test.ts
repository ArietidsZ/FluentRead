/**
 * @file tests/sentenceActionsInteraction.test.ts
 * 文件职责：执行真实句子操作组件，验证停留入口与原译文朗读的交互合同。
 * 主要内容：覆盖延迟、扫过取消、按需查询、双向语音与回退、迟到响应及卸载计时器清理。
 * 模块边界：编译真实 Vue setup 并注入消息与浏览器语音，视觉与真实鼠标由浏览器专项验证。
 */
import {readFileSync} from 'node:fs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {compileScript, compileTemplate, parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import * as Vue from 'vue';
import {Config} from '@/src/core/config/model';
import {createSelectionTtsContentController} from '@/src/features/selection-translation/content/selectionTtsContentController';
import {normalizeSpeechLanguage} from '@/src/features/selection-translation/core';
import type {HighlightedSentence} from '@/src/features/full-page-translation/highlight/public';
import {isSentenceActionsPointer, isSentenceActionsTransfer, placeSentenceActions} from '@/src/features/vocabulary/sentenceActionsPlacement';

const filename = 'src/features/vocabulary/ui/SentenceActions.vue';
const {descriptor} = parse(readFileSync(filename, 'utf8'), {filename});
const compiled = ts.transpileModule(compileScript(descriptor, {id:'sentence-actions-test'}).content, {
  compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, esModuleInterop:true},
}).outputText;
let app: Vue.App | undefined;
afterEach(() => {app?.unmount(); app = undefined; vi.unstubAllGlobals(); vi.useRealTimers();});

function mount() {
  vi.useFakeTimers();
  const config = Object.assign(new Config(), {from:'en', to:'zh-Hans', on:true, bilingualSentenceHighlightEnabled:true});
  let subscriber: {change:(current:HighlightedSentence|null)=>void};
  let configChanged: (config:Config)=>void;
  let requestId = 0;
  const unsubscribe = vi.fn(), unsubscribeConfig = vi.fn();
  const speak = vi.fn(), cancel = vi.fn(), writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('window', {innerWidth:1000, innerHeight:800, location:{href:'https://example.com/'},
    matchMedia:()=>({matches:false}), speechSynthesis:{speak,cancel}});
  vi.stubGlobal('document', {title:'Sentence fixture'});
  vi.stubGlobal('navigator', {clipboard:{writeText}});
  vi.stubGlobal('SpeechSynthesisUtterance', class {constructor(public text:string) {} lang = '';});
  const send = vi.fn().mockImplementation(async message => message.type === 'selectionTts' ? {success:false} : {success:true,data:null});
  const port = {addListener:vi.fn(),removeListener:vi.fn()};
  const modules: Record<string, unknown> = {
    vue:Vue, 'webextension-polyfill':{runtime:{sendMessage:send,onMessage:port},extension:{}},
    '@/src/services/config/store':{config,requestConfigPatch:vi.fn(),subscribeConfig:(callback:typeof configChanged)=>{configChanged=callback;return unsubscribeConfig;}},
    '@/src/core/language/detect':{detectlang:()=> 'en'},
    '@/src/features/full-page-translation/highlight/public':{subscribeHighlightedSentence:(_document:unknown,next:typeof subscriber)=>{subscriber=next;return unsubscribe;}},
    '@/src/features/selection-translation/speech/public':{createSelectionTtsContentController,normalizeSpeechLanguage,createSelectionTtsClientRequestId:()=>`sentence-${++requestId}`},
    '../learningModel':{VOCABULARY_BOOK_MESSAGE:'fluentReadVocabularyBook',normalizeLearningSourceText:(text:string)=>text},
    '../sentenceActionsPlacement':{isSentenceActionsPointer, isSentenceActionsTransfer, placeSentenceActions},
  };
  const exports: Record<string, any> = {};
  new Function('require','exports',compiled)((id:string)=>{if (!(id in modules)) throw new Error(`Unexpected import: ${id}`); return modules[id];},exports);
  exports.default.render = () => null;
  const renderer = Vue.createRenderer<Record<string,unknown>,Record<string,unknown>>({
    patchProp(){},insert(){},remove(){},createElement:()=>({}),createText:()=>({}),createComment:()=>({}),
    setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null,
  });
  app = renderer.createApp(exports.default);
  const vm = app.mount({}); const state = (vm.$ as any).setupState;
  const owner = {} as Element;
  const current = (side:HighlightedSentence['side']='source'):HighlightedSentence => ({owner,index:0,side,sourceText:'Good ideas deserve attention.',translationText:'好想法值得关注。',context:'Good ideas deserve attention. Practice makes progress.',rect:{left:20,right:200,top:side==='source'?30:60,bottom:side==='source'?50:80} as DOMRect,anchorRect:{left:20,right:300,top:30,bottom:80},pointer:{clientX:30,clientY:side==='source'?40:70}});
  const hover = (side:HighlightedSentence['side']='source') => subscriber.change(current(side));
  const reveal = async (side:HighlightedSentence['side']='source') => {hover(side);await vi.advanceTimersByTimeAsync(800);state.expand();await Vue.nextTick();};
  return {state,send,speak,cancel,writeText,port,unsubscribe,unsubscribeConfig,config,
    hover,reveal,change:(next:HighlightedSentence)=>subscriber.change(next),leave:()=>subscriber.change(null),disable:()=>configChanged({...config,on:false}),current};
}

describe('sentence actions dwell and playback', () => {
  it('waits for pointer rest, only reveals a small entry and queries saving after explicit expansion', async () => {
    const f=mount(); f.hover(); await vi.advanceTimersByTimeAsync(700);
    expect(f.state.sentence).toBeNull(); f.hover(); await vi.advanceTimersByTimeAsync(799);
    expect(f.state.sentence).toBeNull(); await vi.advanceTimersByTimeAsync(1);
    expect(f.state.sentence.sourceText).toBe(f.current().sourceText); expect(f.state.expanded).toBe(false);
    expect(f.send).not.toHaveBeenCalled(); f.state.expand(); await Vue.nextTick();
    expect(f.state.expanded).toBe(true); expect(f.send).toHaveBeenCalledOnce();
    f.state.expand(); expect(f.send).toHaveBeenCalledOnce();
  });
  it.each(['leave','disable','unmount'] as const)('cancels a pending reveal on %s', async action => {
    const f=mount(); f.hover(); await vi.advanceTimersByTimeAsync(400);
    if(action==='unmount') {app!.unmount();app=undefined;} else f[action]();
    await vi.advanceTimersByTimeAsync(1000); expect(f.state.sentence).toBeNull(); expect(f.send).not.toHaveBeenCalled();
    if(action==='unmount') {expect(f.unsubscribe).toHaveBeenCalledOnce();expect(f.unsubscribeConfig).toHaveBeenCalledOnce();expect(f.port.removeListener).toHaveBeenCalledOnce();}
  });
  it.each(['source','translation'] as const)('uses %s text and language in both remote speech and browser fallback', async side => {
    const f=mount(); await f.reveal(side); await f.state.play();
    const expected={text:side==='source'?f.current().sourceText:f.current().translationText,language:side==='source'?'en-US':'zh-CN'};
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({type:'selectionTts',...expected}));
    expect(f.speak).toHaveBeenCalledWith(expect.objectContaining({text:expected.text,lang:expected.language}));
    await f.state.copy();expect(f.writeText).toHaveBeenCalledWith(expected.text);
    await f.state.play();expect(f.cancel).toHaveBeenCalledOnce();expect(f.state.playing).toBe(false);
  });
  it('changes side within one pair, stops speech, and waits again without auto expansion', async () => {
    const f=mount(); await f.reveal(); await f.state.play();
    f.hover('translation');expect(f.cancel).toHaveBeenCalledOnce();expect(f.state.sentence).toBeNull();
    await vi.advanceTimersByTimeAsync(800);expect(f.state.sentence.side).toBe('translation');expect(f.state.expanded).toBe(false);
  });
  it('keeps the revealed position, expanded controls and playback across line changes in the same sentence', async () => {
    const f=mount();await f.reveal();await f.state.play();
    const position=f.state.position;
    f.change({...f.current(),rect:{left:40,right:250,top:90,bottom:110} as DOMRect});
    expect(f.state.expanded).toBe(true);expect(f.state.playing).toBe(true);expect(f.cancel).not.toHaveBeenCalled();
    expect(f.state.position).toEqual(position);expect(f.send.mock.calls.filter(([message])=>message.action==='getByTerm')).toHaveLength(1);
  });
  it('distinguishes repeated identical text in another sentence or paragraph', async () => {
    const f=mount();await f.reveal();
    f.change({...f.current(),index:1});expect(f.state.sentence).toBeNull();
    await vi.advanceTimersByTimeAsync(800);f.state.expand();
    f.change({...f.current(),owner:{} as Element});expect(f.state.sentence).toBeNull();
  });
  it('keeps the translated language on an offscreen playback failure', async () => {
    const f=mount();await f.reveal('translation');
    f.send.mockResolvedValueOnce({success:true,transport:'offscreen'});await f.state.play();
    f.port.addListener.mock.calls[0][0]({type:'selectionTtsState',clientRequestId:'sentence-1',state:'error'});
    expect(f.speak).toHaveBeenCalledWith(expect.objectContaining({text:f.current().translationText,lang:'zh-CN'}));
  });
  it('does not speak a late response after the hovered side changes', async () => {
    const f=mount();await f.reveal();let resolve!: (value:unknown)=>void;
    f.send.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));const pending=f.state.play();
    f.hover('translation');resolve({success:false});await pending;expect(f.speak).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(800);f.state.expand();await f.state.play();
    expect(f.speak).toHaveBeenCalledWith(expect.objectContaining({text:f.current().translationText}));
  });
});

describe('sentence actions placement and pointer transfer', () => {
  const anchor={left:40,right:655,top:18,bottom:126};
  const line={left:40,right:655,top:18,bottom:50};
  it('places the labelled entry beside the entire bilingual heading and measures expanded controls', () => {
    expect(placeSentenceActions(anchor,line,{width:100,height:34},{width:1200,height:800}))
      .toEqual({left:663,top:18,docked:false});
    expect(placeSentenceActions({left:440,right:990,top:20,bottom:180},line,{width:350,height:90},{width:1000,height:800}))
      .toEqual({left:82,top:18,docked:false});
  });
  it('docks narrow layouts opposite the hovered line, keeping measured controls inside the viewport', () => {
    const full={left:8,right:382,top:50,bottom:300};
    expect(placeSentenceActions(full,{...line,top:50,bottom:80},{width:500,height:120},{width:390,height:844}))
      .toEqual({left:8,top:716,docked:true});
    expect(placeSentenceActions({...full,top:500,bottom:800},{...line,top:700,bottom:730},{width:120,height:34},{width:390,height:844}))
      .toEqual({left:262,top:8,docked:true});
  });
  it('retains pointer movement through the side gap and the toolbar without freezing other sentence text', () => {
    const panel={left:663,right:763,top:18,bottom:52};
    expect(isSentenceActionsPointer(anchor,panel,{clientX:660,clientY:35})).toBe(true);
    expect(isSentenceActionsPointer(anchor,panel,{clientX:730,clientY:40})).toBe(true);
    expect(isSentenceActionsPointer(anchor,panel,{clientX:300,clientY:35})).toBe(false);
    expect(isSentenceActionsPointer(anchor,panel,{clientX:660,clientY:100})).toBe(false);
    expect(isSentenceActionsPointer({left:200,right:600,top:0,bottom:100},{left:50,right:190,top:20,bottom:60},{clientX:195,clientY:40})).toBe(true);
  });
  it('recognizes the direct transfer corridor on either side and at a narrow-screen dock', () => {
    const origin={clientX:80,clientY:100};
    expect(isSentenceActionsTransfer(origin,{left:500,right:600,top:90,bottom:124},{clientX:250,clientY:103})).toBe(true);
    expect(isSentenceActionsTransfer(origin,{left:500,right:600,top:90,bottom:124},{clientX:250,clientY:20})).toBe(false);
    expect(isSentenceActionsTransfer({clientX:500,clientY:100},{left:20,right:120,top:90,bottom:124},{clientX:250,clientY:100})).toBe(true);
    expect(isSentenceActionsTransfer(origin,{left:60,right:160,top:700,bottom:734},{clientX:90,clientY:350})).toBe(true);
    expect(isSentenceActionsTransfer(origin,{left:60,right:160,top:700,bottom:734},{clientX:500,clientY:350})).toBe(false);
  });
});

describe('sentence actions rendered states', () => {
  it.each([false,true])('renders only the compact entry or expanded actions when expanded=%s', expanded => {
    const output=compileTemplate({source:descriptor.template!.content,filename,id:'sentence-actions-template'});
    const code=ts.transpileModule(output.code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const exports:Record<string,any>={};new Function('require','exports',code)(()=>Vue,exports);
    type Node={tag?:string;text?:string;props:Record<string,unknown>;children:Node[]};
    const nodes:Node[]=[];
    const renderer=Vue.createRenderer<Node,Node>({
      patchProp(node,key,_previous,value){node.props[key]=value;},insert(node,parent){parent.children.push(node);},remove(){},
      createElement(tag){const node={tag,props:{},children:[]};nodes.push(node);return node;},
      createText:text=>({text,props:{},children:[]}),createComment:()=>({props:{},children:[]}),
      setText(node,text){node.text=text;},setElementText(node,text){node.text=text;},parentNode:()=>null,nextSibling:()=>null,
    });
    app=renderer.createApp({render:exports.render,setup:()=>({sentence:{side:'translation'},expanded,dark:false,position:{},notice:'',privateContext:false,
      playing:false,saving:false,savedId:'',expand(){},close(){},play(){},save(){},copy(){},openBook(){}})});
    app.mount({props:{},children:[]});
    const text=(node:Node):string=>(node.text||'')+node.children.map(text).join('');
    const buttons=nodes.filter(node=>node.tag==='button');
    if(expanded){
      expect(buttons.map(text)).toEqual(['×','播放译文','收藏句子','复制译文','收藏列表 ↗']);
      expect(nodes.find(node=>node.props.role==='toolbar')).toBeDefined();
      expect(buttons.some(node=>node.props['aria-label']==='句子操作')).toBe(false);
    }else{
      expect(buttons).toHaveLength(1);expect(text(buttons[0])).toBe('句子操作 ⌄');
      expect(nodes.some(node=>node.props.role==='toolbar')).toBe(false);
    }
  });
});
