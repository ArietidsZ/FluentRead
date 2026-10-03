<!--
 * @file src/features/settings/ui/HarnessSettings.vue
 * 文件职责：作为统一划词翻译的学习子设置，配置 AI 讲解、模型和阅读偏好。
 * 主要内容：提供按需 AI 讲解开关，直接展示服务和回答偏好，另行组织原文范围、学习记忆、提示词和开源来源。
 * 模块边界：只编辑传入 Config 的 harness 字段；阅读记录由学习中心统一呈现，不发起模型请求，不拥有网页选区或提示词。
 -->
<template>
  <SettingsGroup title="AI 深入讲解" description="点击卡片中的“读懂”“词性与句法”“用法”或“练习”时，才会向所选服务发送讲解请求。">
    <FeatureEnableCard v-model="config.harness.enabled" title="启用 AI 讲解" description="使用你配置的 AI 服务，围绕选中的原文继续学习。关闭后仍可翻译和查词。" />
    <div class="harness-provider-row">
      <div class="harness-provider-field">
        <label>翻译服务</label>
        <div class="harness-service-control">
          <el-select v-model="config.harness.service" class="harness-select" @change="config.harness.model = ''" clearable aria-label="学习讲解服务" :aria-describedby="!effectiveServiceSupportsHarness ? 'harness-service-hint' : undefined" placeholder="跟随当前默认服务" filterable>
            <el-option v-for="item in serviceOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <small class="harness-provider-help">仅支持大模型，使用已配置的服务和密钥。</small>
          <small v-if="!effectiveServiceSupportsHarness" id="harness-service-hint" class="service-hint" role="status">当前默认服务不能回答学习问题，请在这里选择一个 AI 服务。</small>
        </div>
      </div>
      <div class="harness-provider-field">
        <label>模型</label>
        <el-select v-model="config.harness.model" class="harness-select" clearable filterable allow-create default-first-option aria-label="学习讲解模型" placeholder="跟随服务模型">
          <el-option v-for="model in modelOptions" :key="model" :label="model" :value="model" />
        </el-select>
        <small class="harness-provider-help">默认沿用服务的模型，也可以选择或输入模型名称。</small>
      </div>
    </div>
    <SettingsItem label="卡片中的学习动作" description="卡片始终显示“读懂”，其他学习动作可按需显示。" stacked>
      <div class="harness-actions">
        <label v-for="action in HARNESS_ACTIONS" :key="action.id" class="harness-action">
          <input type="checkbox" :checked="config.harness.actions.includes(action.id)" :disabled="action.id === 'meaning'" @change="toggleAction(action.id)" />
          <span><strong>{{ action.label }}</strong><small>{{ action.description }}</small></span>
        </label>
      </div>
    </SettingsItem>
    <SettingsItem label="优先动作" description="选择默认学习动作；若隐藏该动作，默认恢复为“读懂”。">
      <el-select v-model="config.harness.defaultAction" class="harness-select" aria-label="默认动作">
        <el-option v-for="action in visibleActions" :key="action.id" :label="action.label" :value="action.id" />
      </el-select>
    </SettingsItem>

    <SettingsItem label="回答长度" description="先给出重点，需要更多解释时可以继续追问。">
      <SegmentedControl v-model="config.harness.explanationDepth" :options="explanationDepthOptions" label="解释深度" />
    </SettingsItem>
    <SettingsItem label="学习程度" description="让解释和练习贴近你的水平。">
      <el-select v-model="config.harness.learningLevel" class="harness-select" aria-label="学习程度">
        <el-option label="初级" value="beginner" /><el-option label="中级" value="intermediate" /><el-option label="高级" value="advanced" />
      </el-select>
    </SettingsItem>

  </SettingsGroup>

  <details class="harness-advanced"><summary>上下文、学习记忆与自定义指令</summary>
  <SettingsGroup title="原文范围">
    <SettingsItem label="结合哪些原文" :description="config.harness.contextMode === 'paragraph' ? '需要理解代词或言外之意时，允许参考所选文字所在的段落；不会读取整页。' : '只发送你选中的文字，适合单句学习；不会补读周围段落。'">
      <SegmentedControl v-model="config.harness.contextMode" :options="contextModeOptions" label="上下文范围" />
    </SettingsItem>
    <SettingsItem v-if="config.harness.contextMode === 'paragraph'" label="段落最多发送" description="控制可参考的原文长度，通常保留默认值即可。">
      <div class="harness-context-limit"><el-input-number v-model="config.harness.maxContextChars" :min="500" :max="4000" :step="100" aria-label="上下文上限" /><span>字符</span></div>
    </SettingsItem>
  </SettingsGroup>
  <SettingsGroup class="harness-memory-settings" :title="t('learning.memory')" :description="t('settings.memoryHelp')">
    <SettingsItem :label="t('settings.memoryEnabled')" :description="t('settings.memoryDescription')">
      <el-switch v-model="config.harness.memoryEnabled" :aria-label="t('settings.memoryEnabled')" />
    </SettingsItem>
  </SettingsGroup>

  <HarnessPromptSettings :preferences="config.harness" />
  <p class="harness-attribution">学习能力使用 <a href="https://github.com/deepseek-ai/deepseek-harness" target="_blank" rel="noopener noreferrer">DeepSeek Harness 开源内核 ↗</a></p>
  </details>
</template>

<script setup lang="ts">
import HarnessPromptSettings from './HarnessPromptSettings.vue';
import FeatureEnableCard from '@/src/ui/components/FeatureEnableCard.vue';
import {computed, toRef} from 'vue'
import {models, options} from '@/src/core/config/catalog'
import {getCustomOpenAIProviderLabel, getCustomOpenAIProviderModels, isCustomOpenAIProviderId} from '@/src/core/config/customOpenAI'
import {HARNESS_ACTIONS, isHarnessService, type HarnessActionId} from '@/src/core/config/harness'
import type {Config} from '@/src/core/config/model'
import SettingsGroup from './components/SettingsGroup.vue'
import SettingsItem from './components/SettingsItem.vue'
import SegmentedControl from './components/SegmentedControl.vue'
import {useUiI18n} from '@/src/ui/i18n'

const props = defineProps<{config: Config}>()
const config = toRef(props, 'config')
const {t} = useUiI18n()
const serviceOptions = computed(() => [
  ...options.services.filter((item) => !item.disabled && isHarnessService(item.value)),
  ...config.value.customOpenAIProviders.filter((provider) => !options.services.some((item) => item.value === provider.id)).map((provider) => ({value: provider.id, label: getCustomOpenAIProviderLabel(config.value.customOpenAIProviders, provider.id)})),
])
const modelOptions = computed(() => {
  const service = config.value.harness.service || config.value.service
  return (isCustomOpenAIProviderId(service) ? getCustomOpenAIProviderModels(config.value.customOpenAIProviders, service) : models.get(service) || []).filter((model) => model !== '自定义模型')
})
const effectiveServiceSupportsHarness = computed(() => isHarnessService(config.value.harness.service || config.value.service, config.value.customOpenAIProviders))
const visibleActions = computed(() => HARNESS_ACTIONS.filter((action) => config.value.harness.actions.includes(action.id)))
const contextModeOptions = [{value: 'paragraph', label: '可参考本段'}, {value: 'selection', label: '仅选中文字'}]
const explanationDepthOptions = [{value: 'concise', label: '简洁'}, {value: 'detailed', label: '详细'}]

function toggleAction(id: HarnessActionId) {
  if (id === 'meaning') return
  const actions = config.value.harness.actions.includes(id) ? config.value.harness.actions.filter((item) => item !== id) : [...config.value.harness.actions, id]
  config.value.harness.actions = actions.includes('meaning') ? actions : ['meaning', ...actions]
  if (!config.value.harness.actions.includes(config.value.harness.defaultAction)) config.value.harness.defaultAction = 'meaning'
}
</script>

<style scoped>
.harness-advanced > summary { padding:16px 18px; cursor:pointer; color:var(--ink); font-size:13px; font-weight:600; }
.harness-advanced { width:min(100%,1080px); margin:0 auto 12px; }
.harness-advanced[open] { border:0; }
summary:focus-visible { outline:2px solid var(--brand); outline-offset:-4px; }
.harness-attribution { display:flex; flex-wrap:wrap; align-items:center; gap:6px 12px; width:min(100%,1080px); margin:0 auto 10px; padding:4px 4px 12px; color:var(--muted); font-size:12px; line-height:1.7; }
.harness-attribution a { color:var(--brand); text-decoration:underline; text-underline-offset:3px; overflow-wrap:anywhere; }
.harness-attribution a:focus-visible { outline:2px solid var(--brand); outline-offset:4px; border-radius:3px; }
.harness-provider-row { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:24px; padding:16px; border-bottom:1px solid var(--line); }
.harness-provider-field { display:flex; flex-direction:column; gap:8px; min-width:0; }
.harness-provider-field > label { color:var(--ink); font-size:12.5px; font-weight:700; line-height:1.45; }
.harness-provider-help { color:var(--muted); font-size:10.5px; line-height:1.55; }
.harness-provider-row .harness-select { width:100%; max-width:none; }
@media (max-width:600px) { .harness-provider-row { grid-template-columns:1fr; gap:16px; padding-inline:12px; } }
.harness-service-control { display:flex; flex-direction:column; gap:8px; width:100%; min-width:0; }
.service-hint { display:block; margin-top:12px; }
.service-hint { color:var(--warning, #b26a00); font-size:10.5px; line-height:1.5; }
:global(:root.dark .harness-select .el-select__wrapper) { border-color:var(--line); background:var(--surface-soft); transition-property:border-color,box-shadow; }
:global(:root.dark .harness-select .el-select__wrapper:hover),
:global(:root.dark .harness-select .el-select__wrapper.is-focused) { background:var(--surface); }
:global(:root.dark .harness-select .el-select__selected-item),
:global(:root.dark .harness-select .el-select__input) { color:var(--ink); }
:global(:root.dark .harness-select .el-select__placeholder.is-transparent),
:global(:root.dark .harness-select .el-select__caret) { color:var(--muted); }
.harness-context-limit { display:flex; align-items:center; gap:9px; width:100%; color:var(--muted); font-size:11px; }
.harness-context-limit .el-input-number { flex:1; min-width:0; }
.harness-context-limit span { flex-shrink:0; }
.harness-actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.harness-action { display:flex; gap:8px; align-items:flex-start; padding:10px; border:1px solid var(--line); border-radius:8px; cursor:pointer; }
.harness-action input { accent-color:var(--brand); margin:3px 0 0; }
.harness-action span { display:flex; flex-direction:column; gap:3px; color:var(--ink); font-size:12px; }
.harness-action small { color:var(--muted); font-size:10.5px; line-height:1.5; }
@media (max-width:700px) { .harness-actions { grid-template-columns:1fr; } }
</style>
