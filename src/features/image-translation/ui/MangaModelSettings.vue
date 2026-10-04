<!--
 * @file src/features/image-translation/ui/MangaModelSettings.vue
 * 文件职责：提供漫画本地模型的下载说明、来源选择、真实进度、离线导入和缓存清理。
 * 主要内容：从后台读取模型缓存和下载快照，设置首选来源并说明失败后的自动切换；定时刷新可见设置页，离线文件经过本功能资源服务校验才入库，保留部分成功并显示错误反馈。
 * 模块边界：不运行 OCR/修补、不下载远程代码、不上传选中文件；页面关闭只清理状态订阅，正在处理漫画的任务仍由 Offscreen 和页面取消入口管理。
 -->
<template>
  <section class="manga-model-settings" data-testid="manga-model-manager">
    <header><h2>{{ translateLegacy('阅读资源') }}</h2><span>{{ translateLegacy('首次使用时自动准备') }}</span></header>
    <p>{{ translateLegacy('资源下载后可重复使用，图片在当前浏览器中处理') }}</p>
    <div class="manga-resource-list">
      <div class="manga-resource"><div><strong>{{ translateLegacy('漫画文字识别') }}</strong><small>{{ translateLegacy('识别对白与旁白') }} · {{ translateLegacy('约 30 MB') }}</small></div><span :class="{ready: status?.ready}">{{ translateLegacy(!status ? '正在检查' : status.ready ? '已就绪' : '首次使用时下载') }}</span></div>
      <div class="manga-resource"><div><strong>{{ translateLegacy('背景文字清除') }}</strong><small>{{ translateLegacy('清除复杂画面中的原文字') }} · {{ translateLegacy('约 197 MB') }}</small></div><span :class="{ready: status?.inpaintingReady}">{{ translateLegacy(!status ? '正在检查' : status.inpaintingReady ? '已就绪' : '需要时下载') }}</span></div>
    </div>
    <div v-if="status?.download" class="manga-model-progress" role="status" data-i18n-ignore>
      <strong>{{ translateLegacy(phaseLabel) }}</strong><span>{{ status.download.source }} · {{ Math.round(status.download.loaded / 1048576) }} / {{ Math.round(status.download.total / 1048576) }} MB</span>
      <progress v-if="downloading" :value="status.download.loaded" :max="status.download.total" />
    </div>
    <small v-if="error || statusError" class="manga-model-error" role="alert" data-i18n-ignore>{{ error || statusError }}</small>
    <details class="manga-download-settings" :open="!!error || !!statusError || status?.download?.phase === 'error'">
      <summary>{{ translateLegacy('下载设置与离线导入') }}</summary>
      <div class="manga-model-controls"><label>{{ translateLegacy('下载来源') }}
        <select :aria-label="translateLegacy('模型下载来源')" :value="source" :disabled="busy || downloading" @change="changeSource(($event.target as HTMLSelectElement).value)"><option value="auto">{{ translateLegacy('自动选择') }}</option><option value="official">{{ translateLegacy('官方源优先') }}</option><option value="mirror">{{ translateLegacy('备用镜像优先') }}</option></select>
      </label><button type="button" :disabled="busy || downloading" @click="input?.click()">{{ translateLegacy('导入已下载文件') }}</button><input ref="input" hidden type="file" multiple accept=".onnx,.txt" @change="importFiles" /></div>
      <p>{{ translateLegacy('下载失败时自动尝试备用来源并保留已完成的文件，也可导入离线文件') }}</p>
      <details><summary>{{ translateLegacy('获取离线文件') }}</summary><p>{{ translateLegacy('下载以下文件后，可一次选择多个文件导入；只接受完整且经过校验的配套模型') }}</p><ul><li v-for="asset in offlineAssets" :key="asset.name"><a :href="source === 'mirror' ? asset.url.replace('huggingface.co','hf-mirror.net') : asset.url" target="_blank" rel="noopener noreferrer" data-i18n-ignore>{{ asset.name }}</a></li></ul></details>
      <div class="manga-model-storage"><small>{{ translateLegacy('已占用空间') }} · {{ Math.round((status?.bytes || 0) / 1048576) }} MB</small><button type="button" :disabled="busy || downloading || !status?.bytes" @click="remove">{{ translateLegacy('清除已下载资源') }}</button></div>
    </details>
  </section>
</template>
<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref} from 'vue';
import browser from 'webextension-polyfill';
import {useUiI18n} from '@/src/ui/i18n';
import {getMangaModelSource,setMangaModelSource,importMangaModel,MANGA_OCR_ASSETS,MANGA_INPAINT_ASSET,type MangaModelSource,type MangaDownloadState} from '../services/mangaOcrAssets';
const {translateLegacy}=useUiI18n();
const status=ref<{ready:boolean;inpaintingReady?:boolean;bytes:number;download?:MangaDownloadState}|null>(null);
const source=ref<MangaModelSource>('auto'),busy=ref(false),error=ref(''),statusError=ref(''),input=ref<HTMLInputElement>();
const downloading=computed(()=>['downloading','verifying'].includes(status.value?.download?.phase??''));
const phaseLabel=computed(()=>({downloading:'正在下载漫画模型',verifying:'正在校验漫画模型',paused:'漫画模型下载已暂停',error:'漫画模型下载未完成'}[status.value?.download?.phase??'downloading']));
const root='https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/bf1d5edb0335d3262be7caf13f766ba274b4cadd/';
const offlineAssets=[...MANGA_OCR_ASSETS.map(asset=>({name:asset.path.split('/').pop()!,url:root+asset.path})),{name:'lama-manga-dynamic.onnx',url:MANGA_INPAINT_ASSET.url}];
let disposed=false,timer:ReturnType<typeof setTimeout>|undefined;
async function load(){
  const response=await browser.runtime.sendMessage({type:'fluentReadMangaModelStatus'}) as {success?:boolean;error?:string;ready:boolean;inpaintingReady?:boolean;bytes:number;download?:MangaDownloadState};
  if(!response?.success)throw new Error(response?.error||'漫画识别模型状态读取失败');
  if(!disposed){status.value=response;statusError.value='';}
}
async function refresh(){
  if(document.visibilityState==='hidden'){timer=setTimeout(()=>void refresh(),1500);return;}
  try {await load();}catch{if(!disposed)statusError.value=translateLegacy('漫画识别模型状态读取失败');}
  finally {if(!disposed)timer=setTimeout(()=>void refresh(),1500);}
}
async function changeSource(value:string){
  busy.value=true;error.value='';
  try {await setMangaModelSource(value as MangaModelSource);source.value=value as MangaModelSource;}
  catch(cause){error.value=translateLegacy(cause instanceof Error?cause.message:String(cause));}
  finally{busy.value=false;}
}
async function importFiles(event:Event){
  const files=Array.from((event.target as HTMLInputElement).files??[]);busy.value=true;error.value='';
  try{for(const file of files)await importMangaModel(file);}
  catch(cause){error.value=translateLegacy(cause instanceof Error?cause.message:String(cause));}
  finally{busy.value=false;if(input.value)input.value.value='';await load().catch(()=>{error.value=translateLegacy('漫画识别模型状态读取失败');});}
}
async function remove(){
  busy.value=true;error.value='';
  try{const response=await browser.runtime.sendMessage({type:'fluentReadMangaModelRemove'}) as {success?:boolean;error?:string};
    if(!response?.success)throw new Error(response?.error||'漫画识别模型清除失败');await load();
  }catch(cause){error.value=translateLegacy(cause instanceof Error?cause.message:String(cause));}
  finally{busy.value=false;}
}
onMounted(()=>{void getMangaModelSource().then(value=>{if(!disposed)source.value=value;}).catch(()=>undefined);void refresh();});
onBeforeUnmount(()=>{disposed=true;clearTimeout(timer);});
</script>
<style scoped>
.manga-model-settings{padding:20px;border:1px solid var(--el-border-color-light);border-radius:12px;background:var(--el-fill-color-blank);color:var(--el-text-color-primary)}
.manga-model-settings header{display:flex;align-items:center;justify-content:space-between;gap:12px}.manga-model-settings h2{margin:0;font-size:16px}.manga-model-settings header>span{font-size:12px;color:var(--el-text-color-secondary)}.manga-model-settings p{margin:6px 0;font-size:13px;line-height:1.6;color:var(--el-text-color-secondary)}.manga-model-settings small{display:block;font-size:12px;color:var(--el-text-color-secondary)}
.manga-resource-list{margin-top:12px}.manga-resource{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--el-border-color-lighter)}.manga-resource strong{font-size:14px}.manga-resource>span{font-size:12px;color:var(--el-text-color-secondary);flex-shrink:0}.manga-resource>span.ready{color:var(--el-color-success)}.manga-resource small{margin-top:3px}
.manga-model-controls{display:flex;align-items:end;gap:12px;flex-wrap:wrap;margin:12px 0 6px}.manga-model-controls label{font-size:13px;display:grid;gap:6px}.manga-model-settings button,.manga-model-settings select{border:1px solid var(--el-border-color);border-radius:7px;padding:7px 10px;font:inherit;font-size:13px;background:var(--el-fill-color-blank);color:var(--el-text-color-primary)}.manga-model-settings button{cursor:pointer;flex-shrink:0}.manga-model-settings button:disabled{opacity:.5;cursor:default}.manga-model-settings :is(button,select,summary):focus-visible{outline:2px solid var(--el-color-primary);outline-offset:2px}
.manga-model-progress{display:grid;gap:6px;margin-top:12px;padding:12px;border-radius:8px;background:var(--el-color-primary-light-9);font-size:13px}.manga-model-progress progress{width:100%;accent-color:var(--el-color-primary)}.manga-model-settings .manga-model-error{color:var(--el-color-danger);margin-top:8px}.manga-model-settings details{font-size:13px;margin-top:14px}.manga-model-settings summary{cursor:pointer}.manga-model-settings ul{padding-left:18px;margin:8px 0}.manga-model-settings a{color:var(--el-color-primary);overflow-wrap:anywhere}.manga-model-storage{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px}.manga-download-settings>summary{font-weight:600}
@media(max-width:600px){.manga-model-settings{padding:16px}.manga-model-settings header{align-items:flex-start;flex-direction:column}.manga-resource{gap:8px}.manga-model-storage{align-items:flex-start;flex-direction:column}}
</style>
