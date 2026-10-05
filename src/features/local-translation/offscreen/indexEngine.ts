/**
 * @file src/features/local-translation/offscreen/indexEngine.ts
 * 文件职责：加载固定 Index Q6 模型并执行有界、不可回退到 CPU 的翻译。
 * 主要内容：复用 wllama 原生聊天模板、贪心生成及会话；分词仅用于完整提示词预算，保留占位符并核对原生全层卸载记录。
 * 模块边界：只读取已校验缓存，不下载、不读取页面配置；失败即释放模型，取消由外层 Worker 终止兜底。
 */
import {Wllama} from '@wllama/wllama/esm/index.js';
import {Tokenizer} from '@huggingface/tokenizers';
import {getTranslationArtifacts, translationArtifactBlob} from './artifactStore';
import {createGpuOffloadProof, requireIndexGpu} from './indexGpu';
import {assertLocalTranslationPlaceholders, indexTranslationPrompt, packIndexTranslationText, type LocalTranslationHints} from '@/src/core/translation/indexInference';
import {assertLocalTranslationOutput} from '@/src/core/translation/localInference';

export async function createIndexTranslator(model:string, wasmUrl:string) {
    await requireIndexGpu();
    const artifacts=getTranslationArtifacts(model);
    const read=async(path:string)=>{
        const file=artifacts.find(file=>file.path===path);
        if(!file)throw new Error('LOCAL_TRANSLATION_INVALID_MODEL');
        return translationArtifactBlob(file);
    };
    const tokenizer=new Tokenizer(JSON.parse(await (await read('tokenizer.json')).text()),JSON.parse(await (await read('tokenizer_config.json')).text()));
    const proof=createGpuOffloadProof();
    const engine=new Wllama({default:wasmUrl},{suppressNativeLog:false,logger:proof.logger});
    engine.setCompat(null);
    let disposed=false;
    const dispose=async()=>{if(disposed)return;disposed=true;await engine.exit();};
    try {
        await engine.loadModel([await read('Index-Translate-2B.Q6_K.gguf')],{
            n_ctx:2048,n_batch:128,n_ubatch:64,n_threads:1,n_parallel:1,n_gpu_layers:99,
            warmup:false,jinja:true,ctx_shift:false,cache_idle_slots:false,
            default_template_kwargs:{enable_thinking:false},
        });
        proof.assert();
    } catch(error){await dispose().catch(()=>undefined);throw error;}
    return {
        dispose,
        async translate(text:string,target:string,hints:LocalTranslationHints,signal:AbortSignal):Promise<string>{
            if(disposed)throw new Error('LOCAL_TRANSLATION_GPU_UNVERIFIED');
            const count=(text:string)=>tokenizer.encode(text,{add_special_tokens:false}).ids.length;
            try {
                const chunks=packIndexTranslationText(text,count,target,hints),results:string[]=[];
                for(const chunk of chunks){
                    if(!chunk.trim()){results.push(chunk);continue;}
                    if(signal.aborted)throw new DOMException('Translation cancelled','AbortError');
                    proof.assert();
                    const response=await engine.createChatCompletion({
                        messages:[{role:'user',content:indexTranslationPrompt(chunk.trim(),target,hints)}],
                        chat_template_kwargs:{enable_thinking:false},temperature:0,max_tokens:768,
                        cache_prompt:true,seed:42,abortSignal:signal,
                    });
                    proof.assert();
                    if(signal.aborted)throw new DOMException('Translation cancelled','AbortError');
                    if(response.choices[0]?.finish_reason==='length')throw new Error('LOCAL_TRANSLATION_OUTPUT_LIMIT');
                    // 预留256个模板 token；原生计数超出预算则不接受可能截断的结果。
                    if(response.usage.prompt_tokens>1280)throw new Error('LOCAL_TRANSLATION_INPUT_LIMIT');
                    const output=response.choices[0]?.message.content||'';
                    assertLocalTranslationOutput(output,chunk);
                    assertLocalTranslationPlaceholders(chunk,output);
                    results.push((chunk.match(/^\s*/u)?.[0]||'')+output.trim()+(chunk.match(/\s*$/u)?.[0]||''));
                }
                return results.join('');
            }catch(error){await dispose().catch(()=>undefined);throw error;}
        },
    };
}
