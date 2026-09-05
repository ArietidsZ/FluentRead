<!--
 * @file src/features/settings/ui/VideoLocalModelSettings.vue
 * 文件职责：提供本地视频字幕模型选择与下载管理，向用户呈现模型是否可用。
 * 主要内容：渲染 Tiny/Base 选择、缓存读取、下载状态与错误反馈，并在组件卸载时移除存储监听。
 * 模块边界：通过视频 feature 公共配置和后台消息获取模型，不直接执行识别、下载模型权重或操作网页播放器。
 -->
<template>
  <SettingsItem label="本地 AI 字幕模型" description="X 没有原生字幕时使用；模型和音频都保留在浏览器本地。" :disabled="!config.videoTranslationEnabled || !browserCapabilities.offscreenDocument">
    <el-select v-model="config.videoLocalModel" aria-label="本地 AI 字幕模型" :disabled="!config.videoTranslationEnabled || !browserCapabilities.offscreenDocument" placeholder="请选择本地模型">
      <el-option v-for="item in modelOptions" :key="item.value" class="select-left" :label="item.label" :value="item.value" />
    </el-select>
  </SettingsItem>
  <div class="video-model-download-panel" aria-label="本地 Whisper 模型下载">
    <div class="video-model-download-heading">
      <div><strong>下载本地 Whisper 模型</strong><p>首次请求 X AI 字幕前下载并缓存模型。</p></div>
      <span class="video-model-local-badge">离线识别</span>
    </div>
    <p v-if="!browserCapabilities.offscreenDocument" class="capability-warning" role="status">当前浏览器不支持本地 AI 字幕，无法下载或运行本地模型。</p>
    <div class="video-model-list">
      <article v-for="item in modelOptions" :key="item.value" class="video-model-card" :class="{ selected: item.value === config.videoLocalModel }">
        <div class="video-model-icon">{{ item.value === 'tiny' ? 'T' : 'B' }}</div>
        <div class="video-model-copy"><strong>{{ item.value === 'tiny' ? 'Whisper Tiny' : 'Whisper Base' }}</strong><small>{{ item.description }}</small></div>
        <button type="button" class="video-model-download-button" :disabled="downloaded.includes(item.value) || downloading.includes(item.value) || !config.videoTranslationEnabled || !browserCapabilities.offscreenDocument" @click="config.videoLocalModel = item.value; download(item.value)">
          {{ downloaded.includes(item.value) ? '已下载' : downloading.includes(item.value) ? '下载中…' : '下载' }}
        </button>
      </article>
    </div>
    <p v-if="downloadError" class="video-model-error">{{ downloadError }}</p>
  </div>
</template>

<script lang="ts" setup>
import {onMounted, onUnmounted, ref} from 'vue';
import browser from 'webextension-polyfill';
import SettingsItem from './components/SettingsItem.vue';
import {
  VIDEO_LOCAL_TRANSCRIPTION_MODELS,
  VIDEO_LOCAL_TRANSCRIPTION_STATE_KEY,
  normalizeVideoLocalTranscriptionModels,
  type VideoLocalTranscriptionModel,
} from '@/src/features/video-subtitle/public';
import type {Config} from '@/src/core/config/model';
import {browserCapabilities} from '@/src/platform/browser/capabilities';

const props = defineProps<{config: Config}>();
const config = props.config;
const modelOptions = VIDEO_LOCAL_TRANSCRIPTION_MODELS;
const downloaded = ref<VideoLocalTranscriptionModel[]>([]);
const downloading = ref<VideoLocalTranscriptionModel[]>([]);
const downloadError = ref('');

async function refresh(): Promise<void> {
  const stored = await browser.storage.local.get(VIDEO_LOCAL_TRANSCRIPTION_STATE_KEY);
  downloaded.value = normalizeVideoLocalTranscriptionModels(stored[VIDEO_LOCAL_TRANSCRIPTION_STATE_KEY]);
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

function handleStorageChange(changes: Record<string, browser.Storage.StorageChange>, areaName: string): void {
  if (areaName === 'local' && changes[VIDEO_LOCAL_TRANSCRIPTION_STATE_KEY]) void refresh().catch(() => { downloadError.value = '无法读取模型缓存，请重试。'; });
}

onMounted(() => {
  void refresh().catch(() => { downloadError.value = '无法读取模型缓存，请重试。'; });
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

.video-model-download-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.video-model-download-heading strong { color: var(--ink); font-size: 14px; }
.video-model-download-heading p { margin: 4px 0 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
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
.capability-warning { margin: 6px 0 0; color: var(--el-color-danger); font-size: 11px; line-height: 1.5; }

:global(:root.dark) .video-model-download-panel { border-color: #363a44; background: rgba(37, 40, 48, .9); }
:global(:root.dark) .video-model-download-heading strong,
:global(:root.dark) .video-model-copy strong { color: #f4f5f8; }
:global(:root.dark) .video-model-download-heading p,
:global(:root.dark) .video-model-copy small { color: #a7adba; }
:global(:root.dark) .video-model-card { border-color: #363a44; background: rgba(30, 33, 41, .9); }
:global(:root.dark) .video-model-card.selected { border-color: #4ba89d; background: rgba(14, 80, 78, .28); }
</style>
