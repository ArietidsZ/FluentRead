<!--
 * @file src/features/settings/ui/VideoLocalModelSettings.vue
 * 文件职责：提供本地视频字幕模型选择与下载管理，向用户呈现模型是否可用。
 * 主要内容：渲染 Tiny/Base 选择、缓存读取、下载状态与错误反馈，并在组件卸载时移除存储监听。
 * 模块边界：通过视频 feature 公共配置和后台消息获取模型，不直接执行识别、下载模型权重或操作网页播放器。
 -->
<template>
  <SettingsItem label="视频原语言" description="X 视频字幕使用的原语言；自动检测适合大多数视频。">
    <el-select v-model="config.videoSourceLanguage" aria-label="视频原语言" :disabled="!config.videoTranslationEnabled" placeholder="请选择视频原语言">
      <el-option v-for="item in VIDEO_SOURCE_LANGUAGE_OPTIONS" :key="item.value" :label="item.label" :value="item.value" />
    </el-select>
  </SettingsItem>
  <SettingsItem label="本地 AI 字幕模型" description="X 没有原生字幕时使用；模型和音频都保留在浏览器本地。" :disabled="!config.videoTranslationEnabled || !browserCapabilities.offscreenDocument">
    <el-select v-model="config.videoLocalModel" aria-label="本地 AI 字幕模型" :disabled="!config.videoTranslationEnabled || !browserCapabilities.offscreenDocument" placeholder="请选择本地模型">
      <el-option v-for="item in modelOptions" :key="item.value" class="select-left" :label="item.label" :value="item.value" />
    </el-select>
  </SettingsItem>
  <p class="video-model-brief">识别在当前浏览器本地运行，速度取决于 CPU 和内存；音频不会上传。</p>
  <p class="video-model-status" role="status">{{ !modelStateLoaded ? '正在读取模型状态…' : downloaded.includes(config.videoLocalModel) ? '当前模型已下载，可直接生成。' : '当前模型尚未下载。' }}</p>
  <details class="video-model-management" :open="!downloaded.includes(config.videoLocalModel)">
    <summary>管理本地模型</summary>
    <div class="video-model-download-panel" aria-label="本地 Whisper 模型下载">
      <div class="video-model-download-heading">
        <div><strong>下载本地 Whisper 模型</strong><p>首次请求 X AI 字幕前下载并缓存模型。</p></div>
        <span class="video-model-local-badge">离线识别</span>
      </div>
      <p class="video-model-guidance">两个模型均在本机运行。首次下载需要联网；识别速度和效果取决于设备性能及音频质量。桌面 Chrome/Edge 支持本地识别，Firefox 可使用原生字幕翻译。</p>
      <p v-if="!browserCapabilities.offscreenDocument" class="capability-warning" role="status">当前浏览器不支持本地 AI 字幕，无法下载或运行本地模型。</p>
      <div class="video-model-list">
        <article v-for="item in modelOptions" :key="item.value" class="video-model-card" :class="{ selected: item.value === config.videoLocalModel }">
          <div class="video-model-icon">{{ item.value === 'tiny' ? 'T' : 'B' }}</div>
          <div class="video-model-copy"><strong>{{ item.label }}</strong><small>{{ item.description }}</small></div>
          <button type="button" class="video-model-download-button" :disabled="downloaded.includes(item.value) || downloading.includes(item.value) || !config.videoTranslationEnabled || !browserCapabilities.offscreenDocument" @click="config.videoLocalModel = item.value; download(item.value)">
            {{ downloaded.includes(item.value) ? '已下载' : downloading.includes(item.value) ? '下载中…' : '下载' }}
          </button>
        </article>
      </div>
      <p v-if="downloadError" class="video-model-error">{{ downloadError }}</p>
    </div>
  </details>
  <details class="video-ai-cache-panel" data-video-ai-cache>
    <summary>已识别视频缓存</summary>
    <p>完整识别字幕最多保留 32 个视频、7 天；只保存字幕文字和时间，不保存音频。</p>
    <p v-if="cacheError" class="video-model-error" role="status">{{ cacheError }}</p>
    <p v-else class="video-ai-cache-status" role="status">{{ cacheStats ? `${cacheStats.entries} 个视频` : '正在读取缓存状态…' }}</p>
    <button type="button" class="video-model-download-button" :disabled="clearingCache || !cacheStats || cacheStats.entries === 0" @click="clearVideoAiCache">
      {{ clearingCache ? '清除中…' : '清除已识别字幕' }}
    </button>
  </details>
</template>

<script lang="ts" setup>
import {onMounted, onUnmounted, ref} from 'vue';
import browser from 'webextension-polyfill';
import SettingsItem from './components/SettingsItem.vue';
import {
  VIDEO_LOCAL_TRANSCRIPTION_MODELS,
  VIDEO_LOCAL_TRANSCRIPTION_STATE_KEY,
  VIDEO_AI_SUBTITLE_CACHE_CLEAR_MESSAGE,
  VIDEO_AI_SUBTITLE_CACHE_STATS_MESSAGE,
  normalizeVideoLocalTranscriptionModels,
  type VideoLocalTranscriptionModel,
} from '@/src/features/video-subtitle/public';
import {VIDEO_SOURCE_LANGUAGE_OPTIONS} from '@/src/core/config/model';
import type {Config} from '@/src/core/config/model';
import {browserCapabilities} from '@/src/platform/browser/capabilities';

const props = defineProps<{config: Config}>();
const config = props.config;
const modelOptions = VIDEO_LOCAL_TRANSCRIPTION_MODELS;
const downloaded = ref<VideoLocalTranscriptionModel[]>([]);
const modelStateLoaded = ref(false);
const downloading = ref<VideoLocalTranscriptionModel[]>([]);
const downloadError = ref('');
const cacheStats = ref<{entries: number; bytes: number; maxEntries: number; ttlMs: number} | null>(null);
const cacheError = ref('');
const clearingCache = ref(false);

async function refresh(): Promise<void> {
  const stored = await browser.storage.local.get(VIDEO_LOCAL_TRANSCRIPTION_STATE_KEY);
  downloaded.value = normalizeVideoLocalTranscriptionModels(stored[VIDEO_LOCAL_TRANSCRIPTION_STATE_KEY]);
  modelStateLoaded.value = true;
}

async function download(model: VideoLocalTranscriptionModel): Promise<void> {
  if (!browserCapabilities.offscreenDocument) {
    downloadError.value = '当前浏览器不支持本地 AI 字幕。';
    return;
  }
  if (downloaded.value.includes(model) || downloading.value.includes(model)) return;
  downloadError.value = '';
  downloading.value = [...downloading.value, model];
  try {
    const response = await browser.runtime.sendMessage({type: 'fluentReadPrepareLocalVideoModel', model}) as {success?: boolean; models?: unknown; error?: string} | undefined;
    if (!response?.success) throw new Error(response?.error || '模型下载失败');
    downloaded.value = normalizeVideoLocalTranscriptionModels(response.models);
  } catch (error) {
    downloadError.value = error instanceof Error ? `${error.message}。请检查网络后重试。` : '模型下载失败，请检查网络后重试。';
  } finally {
    downloading.value = downloading.value.filter(item => item !== model);
  }
}

async function refreshCacheStats(): Promise<void> {
  const response = await browser.runtime.sendMessage({type: VIDEO_AI_SUBTITLE_CACHE_STATS_MESSAGE}) as {success?: boolean; stats?: typeof cacheStats.value} | undefined;
  if (!response?.success || !response.stats) throw new Error('无法读取已识别字幕缓存，请重试。');
  cacheStats.value = response.stats;
  cacheError.value = '';
}

async function clearVideoAiCache(): Promise<void> {
  if (clearingCache.value) return;
  clearingCache.value = true;
  cacheError.value = '';
  try {
    const response = await browser.runtime.sendMessage({type: VIDEO_AI_SUBTITLE_CACHE_CLEAR_MESSAGE}) as {success?: boolean; error?: string} | undefined;
    if (!response?.success) throw new Error(response?.error || '清除已识别字幕失败。');
    await refreshCacheStats();
  } catch (error) {
    cacheError.value = error instanceof Error ? error.message : '清除已识别字幕失败，请重试。';
  } finally {
    clearingCache.value = false;
  }
}

function handleStorageChange(changes: Record<string, browser.Storage.StorageChange>, areaName: string): void {
  if (areaName === 'local' && changes[VIDEO_LOCAL_TRANSCRIPTION_STATE_KEY]) void refresh().catch(() => { downloadError.value = '无法读取模型缓存，请重试。'; });
}

onMounted(() => {
  void refresh().catch(() => { modelStateLoaded.value = true; downloadError.value = '无法读取模型缓存，请重试。'; });
  void refreshCacheStats().catch((error) => { cacheError.value = error instanceof Error ? error.message : '无法读取已识别字幕缓存，请重试。'; });
  browser.storage.onChanged.addListener(handleStorageChange);
});
onUnmounted(() => browser.storage.onChanged.removeListener(handleStorageChange));
</script>

<style scoped>
.video-model-download-panel {
  display: grid;
  gap: 12px;
  margin: 4px 0 14px;
  padding: 14px;
  border: 1px solid #d7ecea;
  border-radius: 12px;
  background: #f8fcfc;
}
.video-model-brief { margin: 10px 16px 0; color: var(--muted); font-size: 11px; line-height: 1.45; }
.video-model-status { margin: 4px 16px 8px; color: var(--brand-strong); font-size: 11px; line-height: 1.45; }
.video-model-management { margin: 0 16px 12px; border-top: 1px solid var(--line); padding-top: 8px; }
.video-model-management summary { color: var(--ink); font-size: 12px; font-weight: 700; cursor: pointer; }

.video-model-download-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.video-model-download-heading strong { color: var(--ink); font-size: 14px; }
.video-model-download-heading p { margin: 4px 0 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
.video-model-guidance { margin: 8px 0 10px; color: var(--muted); font-size: 11px; line-height: 1.5; }
.video-model-local-badge { flex: none; padding: 6px 9px; border: 1px solid #bfe5de; border-radius: 999px; color: var(--brand-strong); background: #effbf8; font-size: 10px; font-weight: 750; }
.video-model-list { display: grid; gap: 8px; }
.video-model-card { display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 9px 10px; border: 1px solid #e6ebf0; border-radius: 10px; background: #fff; }
.video-model-card.selected { border-color: #58b8ad; background: #f0fbf9; }
.video-model-icon { display: grid; place-items: center; width: 30px; height: 30px; flex: none; border-radius: 8px; color: #087f80; background: #e5f7f3; font-size: 13px; font-weight: 850; }
.video-model-card:nth-child(2) .video-model-icon { color: #8b55c7; background: #f3ebff; }
.video-model-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; }
.video-model-copy strong { color: var(--ink); font-size: 13px; }
.video-model-copy small { color: var(--muted); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
.video-model-download-button { flex: none; min-height: 34px; padding: 7px 11px; border: 1px solid #bfe5de; border-radius: 7px; color: var(--brand-strong); background: #effbf8; font-size: 12px; font-weight: 700; cursor: pointer; }
.video-model-download-button:disabled { color: #97a2ad; border-color: #dfe5e8; background: #f4f6f7; cursor: default; }
.video-model-error { margin: 0; color: var(--el-color-danger); font-size: 10px; line-height: 1.4; }
.video-ai-cache-panel { display: grid; gap: 7px; margin: 4px 0 14px; padding: 12px 14px; border: 1px solid #e4e8ec; border-radius: 10px; background: rgba(247, 249, 250, .8); }
.video-ai-cache-panel summary { color: var(--ink); font-size: 12px; font-weight: 700; cursor: pointer; }
.video-ai-cache-panel p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.45; }
.video-ai-cache-status { color: var(--brand-strong) !important; }
.capability-warning { margin: 6px 0 0; color: var(--el-color-danger); font-size: 11px; line-height: 1.5; }

:global(:root.dark) .video-model-download-panel { border-color: #363a44; background: rgba(37, 40, 48, .9); }
:global(:root.dark) .video-model-download-heading strong,
:global(:root.dark) .video-model-copy strong { color: #f4f5f8; }
:global(:root.dark) .video-model-download-heading p,
:global(:root.dark) .video-model-copy small { color: #a7adba; }
:global(:root.dark) .video-model-card { border-color: #363a44; background: rgba(30, 33, 41, .9); }
:global(:root.dark) .video-model-card.selected { border-color: #4ba89d; background: rgba(14, 80, 78, .28); }
</style>
