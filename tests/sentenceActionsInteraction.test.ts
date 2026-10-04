/**
 * @file tests/sentenceActionsInteraction.test.ts
 * 文件职责：执行真实句子操作组件，验证停留入口与原译文朗读的交互合同。
 * 主要内容：覆盖延迟、扫过取消、按需查询、双向语音与回退、迟到响应及卸载计时器清理。
 * 模块边界：编译真实 Vue setup 并注入消息与浏览器语音，视觉与真实鼠标由浏览器专项验证。
 */
import {readFileSync} from 'node:fs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {compileScript, parse} from 'vue/compiler-sfc';
import ts from 'typescript';
import * as Vue from 'vue';
import {Config} from '@/src/core/config/model';
import {createSelectionTtsContentController} from '@/src/features/selection-translation/content/selectionTtsContentController';
import {normalizeSpeechLanguage} from '@/src/features/selection-translation/core';
import type {HighlightedSentence} from '@/src/features/full-page-translation/highlight/public';

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
  const current = (side:HighlightedSentence['side']='source'):HighlightedSentence => ({side,sourceText:'Good ideas deserve attention.',translationText:'好想法值得关注。',context:'Good ideas deserve attention. Practice makes progress.',rect:{left:20,top:side==='source'?30:60,bottom:side==='source'?50:80} as DOMRect});
  const hover = (side:HighlightedSentence['side']='source') => subscriber.change(current(side));
  const reveal = async (side:HighlightedSentence['side']='source') => {hover(side);await vi.advanceTimersByTimeAsync(800);state.expand();await Vue.nextTick();};
  return {state,send,speak,cancel,writeText,port,unsubscribe,unsubscribeConfig,config,
    hover,reveal,leave:()=>subscriber.change(null),disable:()=>configChanged({...config,on:false}),current};
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
