<!--
 * @file src/features/settings/ui/HarnessSettings.vue
 * 文件职责：提供 Harness 的开关、服务与模型覆盖、上下文和学习偏好设置。
 * 主要内容：用可切换的英文例句演示学习动作，将服务选择和上下文放在主区，动作与回答偏好按需展开。
 * 模块边界：本组件只编辑传入 Config 的 harness 字段；请求触发、选区生命周期和 AI 提示词由其他 feature 负责。
 -->
<template>
  <SettingsGroup description="选中网页上的文字，点“理解”，就地读懂、拆句或练习。">
    <SettingsItem label="启用 Harness" description="只在你点“理解”时请求模型。">
      <el-switch v-model="config.harness.enabled" aria-label="启用 Harness" />
    </SettingsItem>
    <SettingsItem label="示例" description="点一个动作，看看它能帮你做什么。" stacked>
      <div class="harness-preview"><p class="harness-sentence">Although the task was difficult, she finished it on time.</p><div class="harness-preview-actions"><button v-for="action in visibleActions" :key="action.id" type="button" :class="{active: previewAction === action.id}" @click="previewAction = action.id">{{ action.label }}</button></div><p class="harness-result">{{ previewResults[previewAction] }}</p></div>
    </SettingsItem>
    <SettingsItem label="服务" description="复用已配置的 AI 服务和密钥。">
      <div class="service-control">
        <el-select v-model="config.harness.service" @change="config.harness.model = ''" clearable aria-label="Harness 服务" placeholder="跟随当前默认服务">
          <el-option v-for="item in serviceOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <small v-if="!effectiveServiceSupportsHarness" class="service-hint" role="status">请选择一个 AI 服务，用于解释和练习。</small>
      </div>
    </SettingsItem>
    <SettingsItem label="模型" description="跟随服务设置，也可以选择或输入其他模型。">
      <el-select v-model="config.harness.model" clearable filterable allow-create default-first-option aria-label="Harness 模型" placeholder="跟随服务模型">
        <el-option v-for="model in modelOptions" :key="model" :label="model" :value="model" />
      </el-select>
    </SettingsItem>
    <SettingsItem label="上下文范围" description="结合本段理解含义，或只发送选中的文字。">
      <SegmentedControl v-model="config.harness.contextMode" :options="contextModeOptions" label="上下文范围" />
    </SettingsItem>
  </SettingsGroup>
  <details class="harness-more"><summary>更多偏好</summary><SettingsGroup>
    <SettingsItem v-if="config.harness.contextMode === 'paragraph'" label="上下文上限" description="限制发送给 AI 的字符数，范围 500 到 4000。">
      <el-input-number v-model="config.harness.maxContextChars" :min="500" :max="4000" :step="100" controls-position="right" aria-label="上下文上限" />
    </SettingsItem>
    <SettingsItem label="默认动作" description="入口打开时优先显示的动作。">
      <el-select v-model="config.harness.defaultAction" aria-label="默认动作">
        <el-option v-for="action in visibleActions" :key="action.id" :label="action.label" :value="action.id" />
      </el-select>
    </SettingsItem>
    <SettingsItem label="可用动作" description="至少保留“读懂”，其余动作可按需隐藏。" stacked>
      <div class="harness-actions">
        <label v-for="action in HARNESS_ACTIONS" :key="action.id" class="harness-action">
          <input type="checkbox" :checked="config.harness.actions.includes(action.id)" :disabled="action.id === 'meaning'" @change="toggleAction(action.id)" />
          <span><strong>{{ action.label }}</strong><small>{{ action.description }}</small></span>
        </label>
      </div>
    </SettingsItem>
    <SettingsItem label="解释深度" description="控制回答的展开程度。">
      <SegmentedControl v-model="config.harness.explanationDepth" :options="explanationDepthOptions" label="解释深度" />
    </SettingsItem>
    <SettingsItem label="学习程度" description="帮助 AI 调整解释和练习的难度。">
      <el-select v-model="config.harness.learningLevel" aria-label="学习程度">
        <el-option label="初级" value="beginner" /><el-option label="中级" value="intermediate" /><el-option label="高级" value="advanced" />
      </el-select>
    </SettingsItem>
  </SettingsGroup></details>
</template>

<script setup lang="ts">
import {computed, ref, toRef} from 'vue'
import {models, options} from '@/src/core/config/catalog'
import {getCustomOpenAIProviderLabel, getCustomOpenAIProviderModels, isCustomOpenAIProviderId} from '@/src/core/config/customOpenAI'
import {HARNESS_ACTIONS, isHarnessService, type HarnessActionId} from '@/src/core/config/harness'
import type {Config} from '@/src/core/config/model'
import SettingsGroup from './components/SettingsGroup.vue'
import SettingsItem from './components/SettingsItem.vue'
import SegmentedControl from './components/SegmentedControl.vue'

const props = defineProps<{config: Config}>()
const config = toRef(props, 'config')
const serviceOptions = computed(() => [
  ...options.services.filter((item) => !item.disabled && isHarnessService(item.value)),
  ...config.value.customOpenAIProviders.filter((provider) => !options.services.some((item) => item.value === provider.id)).map((provider) => ({value: provider.id, label: getCustomOpenAIProviderLabel(config.value.customOpenAIProviders, provider.id)})),
])
const modelOptions = computed(() => {
  const service = config.value.harness.service || config.value.service
  return (isCustomOpenAIProviderId(service) ? getCustomOpenAIProviderModels(config.value.customOpenAIProviders, service) : models.get(service) || []).filter((model) => model !== '自定义模型')
})
const effectiveService = computed(() => config.value.harness.service || config.value.service)
const effectiveServiceSupportsHarness = computed(() => (
  isHarnessService(effectiveService.value, config.value.customOpenAIProviders)
))
const visibleActions = computed(() => HARNESS_ACTIONS.filter((action) => config.value.harness.actions.includes(action.id)))
const previewAction = ref<HarnessActionId>(config.value.harness.defaultAction)
const previewResults: Record<HarnessActionId, string> = {meaning: '她按时完成了任务，尽管任务很难。', grammar: 'Although 引导让步从句；主句是 she finished it on time。', usage: 'finish a task on time = 按时完成任务。', practice: '用 on time 写一句自己的经历。提示：想想最近一次按时完成的事。'}
const contextModeOptions = [{value: 'paragraph', label: '当前段落'}, {value: 'selection', label: '当前选区'}]
const explanationDepthOptions = [{value: 'concise', label: '简洁'}, {value: 'detailed', label: '详细'}]
function toggleAction(id: HarnessActionId) {
  if (id === 'meaning') return
  const actions = config.value.harness.actions.includes(id) ? config.value.harness.actions.filter((item) => item !== id) : [...config.value.harness.actions, id]
  config.value.harness.actions = actions.includes('meaning') ? actions : ['meaning', ...actions]
  if (!config.value.harness.actions.includes(config.value.harness.defaultAction)) config.value.harness.defaultAction = 'meaning'
}
</script>

<style scoped>
.harness-preview { position:relative; display:flex; flex-direction:column; gap:9px; padding:11px; border:1px solid var(--line); border-radius:10px; }
.harness-sentence { margin:0; color:var(--ink); font-size:12px; line-height:1.5; }
.harness-preview-actions { display:flex; flex-wrap:wrap; gap:6px; }
.harness-preview-actions button { border:1px solid var(--line); border-radius:7px; padding:5px 9px; background:var(--surface); color:var(--muted); cursor:pointer; font-size:11px; }
.harness-preview-actions button.active { border-color:var(--accent); color:var(--accent); }
.harness-result { margin:0; color:var(--muted); font-size:11px; line-height:1.5; }
.harness-more { margin:0 auto 22px; width:min(100%,1080px); }
.harness-more > summary { padding:8px 4px; color:var(--ink); cursor:pointer; font-size:13px; font-weight:700; }
.service-control { display:flex; width:100%; max-width:360px; flex-direction:column; gap:5px; }
.service-hint { color:var(--warning, #b26a00); font-size:10px; line-height:1.4; }
.harness-actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.harness-action { display:flex; gap:8px; align-items:flex-start; padding:10px; border:1px solid var(--line); border-radius:8px; }
.harness-action span { display:flex; flex-direction:column; gap:2px; }
.harness-action small { color:var(--muted); font-size:10px; }
@media (max-width:700px) { .harness-actions { grid-template-columns:1fr; } }
</style>
