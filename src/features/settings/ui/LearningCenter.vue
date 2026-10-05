<!--
 * @file src/features/settings/ui/LearningCenter.vue
 * 文件职责：把单词与句子、最近 30 天的阅读记录和长期学习笔记组织成统一的学习中心。
 * 主要内容：明确各栏目的保存入口与保留期限，支持从保存结果直达对应列表，并保留已有分区标识和子组件导航事件。
 * 模块边界：只组合 vocabulary 和 reading-assistant 的公开 UI；各 feature 继续拥有数据、请求、复习和删除生命周期。
 -->
<template>
  <div id="settings-vocabulary" class="fr-learning-center">
    <header class="fr-learning-center-header">
      <SegmentedControl v-model="activeTab" :options="tabs" :label="t('learning.content')" />
      <p>{{ t('learning.retention') }}</p>
    </header>
    <p class="fr-learning-center-purpose">{{ t(`learning.${activeTab}Description`) }}</p>
    <VocabularyBook v-if="activeTab === 'saved'" @navigate="emit('navigate', $event)" />
    <HarnessReadingHistory v-else-if="activeTab === 'history'" />
    <LearningMemoryManager v-else :enabled="memoryEnabled" @navigate="emit('navigate', $event)" />
  </div>
</template>
<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue'
import {VocabularyBook} from '@/src/features/vocabulary/ui/public'
import {HarnessReadingHistory} from '@/src/features/reading-assistant/public'
import {useUiI18n} from '@/src/ui/i18n'
import SegmentedControl from './components/SegmentedControl.vue'
import LearningMemoryManager from './LearningMemoryManager.vue'
import {config, configReady, subscribeConfig} from '@/src/services/config/store'

const emit = defineEmits<{navigate: [section: string]}>()
const {t} = useUiI18n()
const props = defineProps<{initialTab?: string}>()
const activeTab = ref(['saved', 'history', 'memory'].includes(props.initialTab || '') ? props.initialTab! : 'saved')
watch(() => props.initialTab, tab => { if (tab && ['saved', 'history', 'memory'].includes(tab)) activeTab.value = tab })
const memoryEnabled = ref(config.harness.memoryEnabled)
let mounted = true
const unsubscribe = subscribeConfig(nextConfig => { memoryEnabled.value = nextConfig.harness.memoryEnabled })
void configReady.then(() => { if (mounted) memoryEnabled.value = config.harness.memoryEnabled }).catch(() => undefined)
onBeforeUnmount(() => { mounted = false; unsubscribe() })
const tabs = computed(() => [
  {value: 'saved', label: t('learning.saved')},
  {value: 'history', label: t('learning.history')},
  {value: 'memory', label: t('learning.memory')},
])
</script>
<style scoped>
.fr-learning-center { width:min(100%,1080px); margin-inline:auto; color:var(--ink); }
.fr-learning-center-header { display:flex; align-items:center; justify-content:space-between; gap:14px; margin-bottom:10px; }
.fr-learning-center-header :deep(.segmented-control) { width:440px; max-width:100%; }
.fr-learning-center-header p { margin:0; color:var(--muted); font-size:11px; line-height:1.6; }
.fr-learning-center-purpose { margin:0 0 20px; color:var(--muted); font-size:12px; line-height:1.7; }
@media (max-width:600px) {
  .fr-learning-center-header { flex-direction:column; align-items:stretch; gap:9px; }
  .fr-learning-center-header :deep(.segmented-control) { width:100%; }
}
</style>
