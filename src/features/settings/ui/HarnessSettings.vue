<!--
 * @file src/features/settings/ui/HarnessSettings.vue
 * 文件职责：让用户通过阅读卡示例理解 Harness，并配置网页动作、模型和阅读偏好。
 * 主要内容：提供无需联网的交互示例、渐进展开的设置，以及按原文组织的 30 天阅读记录列表和 Markdown 问答详情。
 * 模块边界：只编辑传入 Config 的 harness 字段并通过阅读功能公共接口管理记录；不发起模型请求，不拥有网页选区或提示词。
 -->
<template>
  <SettingsGroup description="选中网页文字，直接点“读懂”或“拆句”。回答留在原文旁边，读完就继续浏览。">
    <SettingsItem label="启用 Harness" description="选中文字后显示学习动作，点击才会调用模型。">
      <el-switch v-model="config.harness.enabled" aria-label="启用 Harness" />
    </SettingsItem>
    <SettingsItem label="试试阅读卡" description="选中文字 → 点一个动作 → 读懂后继续浏览。" stacked>
      <div class="harness-preview-wrap"><div class="harness-preview">
        <div class="harness-preview-caption"><span>网页中的效果</span><small>演示内容，不调用模型</small></div>
        <p class="harness-sentence"><mark>Although the task was difficult, she finished it on time.</mark></p>
        <div class="harness-preview-actions" aria-label="示例学习动作">
          <button v-for="action in visibleActions" :key="action.id" type="button"
            :class="{active: previewAction === action.id, 'is-default': config.harness.defaultAction === action.id}"
            :aria-pressed="previewAction === action.id" :title="action.description" @click="previewAction = action.id">
            {{ action.label }}
          </button>
        </div>
        <div class="harness-preview-answer" aria-live="polite"><ReadingAnswer :text="previewResults[previewAction]" /></div>
        <p class="harness-preview-footer">还想问一句？在阅读卡下方输入问题，继续围绕这段原文学习。</p>
      </div></div>
    </SettingsItem>
    <SettingsItem label="服务" description="使用你已配置的 AI 服务和密钥，也可单独选择。">
      <div class="service-control">
        <el-select v-model="config.harness.service" @change="config.harness.model = ''" clearable aria-label="Harness 服务" placeholder="跟随当前默认服务">
          <el-option v-for="item in serviceOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <small v-if="!effectiveServiceSupportsHarness" class="service-hint" role="status">当前默认服务不能回答学习问题，请在这里选择一个 AI 服务。</small>
      </div>
    </SettingsItem>
    <SettingsItem label="模型" description="默认沿用服务的模型，也可以选择或输入模型名称。">
      <el-select v-model="config.harness.model" clearable filterable allow-create default-first-option aria-label="Harness 模型" placeholder="跟随服务模型">
        <el-option v-for="model in modelOptions" :key="model" :label="model" :value="model" />
      </el-select>
    </SettingsItem>
  </SettingsGroup>

  <section class="harness-history">
    <div class="harness-history-heading">
      <div><h2>阅读记录</h2><p>找回读过的句子和回答。本机保存 30 天，查看不调用模型。</p></div>
      <button type="button" class="harness-secondary-button" :aria-expanded="historyOpen" :disabled="historyMutating" aria-controls="harness-settings-records" @click="toggleHistoryOpen">
        {{ historyOpen ? '收起记录' : '查看记录' }}
      </button>
    </div>
    <div v-if="historyOpen" id="harness-settings-records" class="harness-history-body">
      <p v-if="historyError" class="harness-history-feedback" role="alert">{{ historyError }}<button v-if="!historyLoading && !selectedHistory" type="button" @click="reloadHistory">重试</button></p>
      <template v-if="selectedHistory">
        <div class="harness-history-toolbar">
          <button type="button" class="harness-secondary-button" @click="backToHistoryList">返回记录列表</button>
          <button type="button" class="harness-text-button" :disabled="historyMutating" @click="removeHistory(selectedHistory.id)">删除此条</button>
        </div>
        <article class="harness-history-detail">
          <header class="harness-history-source">
            <small>当时选中的原文</small>
            <blockquote>{{ selectedHistory.text }}</blockquote>
            <p>{{ formatDate(selectedHistory.updatedAt) }} · {{ selectedHistory.turns.length }} 次问答</p>
          </header>
          <section v-for="(turn, index) in selectedHistory.turns" :key="turn.id" class="harness-history-turn">
            <header><h3>{{ turn.question || actionLabelFor(turn.intent) }}</h3><small>{{ actionLabelFor(turn.intent) }} · {{ formatDate(turn.createdAt) }}<template v-if="turn.status !== 'completed'"> · {{ statusLabel(turn.status) }}</template></small></header>
            <ReadingAnswer v-if="turn.answer" :text="turn.answer" :compact="false" />
            <p v-else class="harness-history-empty-answer">{{ turn.status === 'streaming' ? '回答仍在生成中，稍后重新打开这条记录查看。' : '这次提问没有保存回答。' }}</p>
            <span class="harness-visually-hidden">第 {{ index + 1 }} 次问答结束</span>
          </section>
        </article>
        <p class="harness-history-footnote">想继续提问？回到网页，在阅读卡的“阅读记录”中打开这条记录。</p>
      </template>
      <template v-else>
        <p v-if="historyLoading && !historySessions.length" class="harness-history-feedback" role="status">正在读取记录…</p>
        <div v-else-if="!historySessions.length && !historyError" class="harness-history-empty">
          <strong>还没有阅读记录</strong>
          <p>在网页选中一句话，点“读懂”或“拆句”。回答会自动保存在这里，方便以后回看。</p>
        </div>
        <div v-if="historySessions.length" class="harness-history-list" aria-label="阅读记录列表">
          <div v-for="item in historySessions" :key="item.id" class="harness-history-row">
            <button type="button" class="harness-history-open" :disabled="historyMutating" @click="openHistory(item.id)">
              <span>{{ item.text }}</span><small>{{ actionLabelFor(item.intent) }} · {{ formatDate(item.updatedAt) }} · {{ item.turnCount }} 次问答</small>
            </button>
            <button type="button" class="harness-text-button" :disabled="historyMutating" aria-label="删除这条阅读记录" @click="removeHistory(item.id)">删除</button>
          </div>
        </div>
        <p v-if="historyDetailLoading" class="harness-history-feedback" role="status">正在打开记录…</p>
        <div v-if="historySessions.length" class="harness-history-toolbar">
          <button v-if="historyHasMore" type="button" class="harness-secondary-button" :disabled="historyLoading || historyMutating" @click="loadMoreHistory">{{ historyLoading ? '正在读取…' : '加载更多' }}</button>
          <span v-else class="harness-history-count">{{ historySessions.length }} 条记录</span>
          <button type="button" class="harness-text-button" :disabled="historyMutating" @click="clearHistory">清空记录</button>
        </div>
      </template>
    </div>
  </section>

  <details class="harness-more"><summary>更多设置<span>网页动作、回答方式与原文范围</span></summary><SettingsGroup>
    <SettingsItem label="选中后显示的动作" description="保留“读懂”，其他动作可按需隐藏；网页浮条和上方示例同步变化。" stacked>
      <div class="harness-actions">
        <label v-for="action in HARNESS_ACTIONS" :key="action.id" class="harness-action">
          <input type="checkbox" :checked="config.harness.actions.includes(action.id)" :disabled="action.id === 'meaning'" @change="toggleAction(action.id)" />
          <span><strong>{{ action.label }}</strong><small>{{ action.description }}</small></span>
        </label>
      </div>
    </SettingsItem>
    <SettingsItem label="优先动作" description="作为网页浮条的主要动作；隐藏它时会自动恢复为“读懂”。">
      <el-select v-model="config.harness.defaultAction" aria-label="默认动作">
        <el-option v-for="action in visibleActions" :key="action.id" :label="action.label" :value="action.id" />
      </el-select>
    </SettingsItem>
    <SettingsItem label="回答长度" description="先给出重点，需要更多解释时可以继续追问。">
      <SegmentedControl v-model="config.harness.explanationDepth" :options="explanationDepthOptions" label="解释深度" />
    </SettingsItem>
    <SettingsItem label="英语程度" description="让解释和练习贴近你的水平。">
      <el-select v-model="config.harness.learningLevel" aria-label="学习程度">
        <el-option label="初级" value="beginner" /><el-option label="中级" value="intermediate" /><el-option label="高级" value="advanced" />
      </el-select>
    </SettingsItem>
    <SettingsItem label="结合哪些原文" :description="config.harness.contextMode === 'paragraph' ? '需要理解代词或言外之意时，允许参考所选文字所在的段落；不会读取整页。' : '只发送你选中的文字，适合单句学习；不会补读周围段落。'">
      <SegmentedControl v-model="config.harness.contextMode" :options="contextModeOptions" label="上下文范围" />
    </SettingsItem>
    <SettingsItem v-if="config.harness.contextMode === 'paragraph'" label="段落最多发送" description="控制可参考的原文长度，通常保留默认值即可。">
      <div class="harness-context-limit"><el-input-number v-model="config.harness.maxContextChars" :min="500" :max="4000" :step="100" controls-position="right" aria-label="上下文上限" /><span>字符</span></div>
    </SettingsItem>
  </SettingsGroup></details>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, ref, toRef, watch} from 'vue'
import {models, options} from '@/src/core/config/catalog'
import {getCustomOpenAIProviderLabel, getCustomOpenAIProviderModels, isCustomOpenAIProviderId} from '@/src/core/config/customOpenAI'
import {HARNESS_ACTIONS, isHarnessService, type HarnessActionId} from '@/src/core/config/harness'
import type {Config} from '@/src/core/config/model'
import SettingsGroup from './components/SettingsGroup.vue'
import SettingsItem from './components/SettingsItem.vue'
import SegmentedControl from './components/SegmentedControl.vue'
import {ReadingAnswer, clearHarnessSessions, deleteHarnessSession, getHarnessSession, listHarnessSessions} from '@/src/features/reading-assistant/public'
import type {HarnessSession, HarnessSessionSummary} from '@/src/services/harness/sessionTypes'

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
const effectiveServiceSupportsHarness = computed(() => isHarnessService(config.value.harness.service || config.value.service, config.value.customOpenAIProviders))
const visibleActions = computed(() => HARNESS_ACTIONS.filter((action) => config.value.harness.actions.includes(action.id)))
const previewAction = ref<HarnessActionId>(config.value.harness.defaultAction)
const previewResults: Record<HarnessActionId, string> = {
  meaning: '### 这句话在说什么\n虽然任务很难，她还是按时完成了。\n\n### 理解重点\n**Although** 表示“虽然”，把困难和结果放在一起对比。重点是她克服了困难，仍然 **on time（按时）** 完成。',
  grammar: '### 先找主干\n**she → finished → it**\n她（主语）→ 完成（谓语）→ 任务（宾语）。\n\n### 再看修饰\n- **Although the task was difficult**：让步从句，交代“虽然任务很难”。\n- **on time**：修饰 finished，说明是“按时”完成。\n\n### 记住这个句型\n**Although + 困难，主句 + 结果。** Although 已经表达转折，主句不用再加 but。',
  usage: '### on time · 按时\n表示没有迟到，符合约定的时间。\n\n> The train arrived on time.\n\n火车准点到达。\n\n### 别和 in time 混淆\n- **on time**：按计划准时。\n- **in time**：赶得及，还不算太晚。',
  practice: '### 试着补完整\n虽然今天下雨了，我们还是准时到达。\n\n**Although it was raining, we arrived __ __.**\n\n### 核对答案\n**on time**。这里强调按约定时间到达。\n\n### 换成你的经历\n用 Although 开头，写一句“虽然有困难，但仍完成了”的经历。',
}
watch(() => config.value.harness.defaultAction, (action) => { previewAction.value = action })
watch(visibleActions, (actions) => {
  if (!actions.some((action) => action.id === previewAction.value)) previewAction.value = config.value.harness.defaultAction
})
const contextModeOptions = [{value: 'paragraph', label: '可参考本段'}, {value: 'selection', label: '仅选中文字'}]
const explanationDepthOptions = [{value: 'concise', label: '简洁'}, {value: 'detailed', label: '详细'}]
const historyOpen = ref(false)
const historySessions = ref<HarnessSessionSummary[]>([])
const historyOffset = ref(0)
const historyHasMore = ref(false)
const selectedHistory = ref<HarnessSession | null>(null)
const historyLoading = ref(false)
const historyDetailLoading = ref(false)
const historyMutating = ref(false)
const historyError = ref('')
let historyGeneration = 0
let detailGeneration = 0
const actionLabelFor = (value: string) => ({meaning: '读懂', grammar: '拆句', usage: '用法', practice: '练习'}[value] || '学习')
const statusLabel = (value: string) => ({streaming: '生成中', completed: '已完成', stopped: '已停止', error: '未完成'}[value] || '未完成')
const formatDate = (value: number) => new Intl.DateTimeFormat(undefined, {month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit'}).format(value)

function backToHistoryList() {
  detailGeneration += 1
  selectedHistory.value = null
  historyDetailLoading.value = false
}
async function toggleHistoryOpen() {
  historyOpen.value = !historyOpen.value
  if (historyOpen.value) await reloadHistory()
  else {
    historyGeneration += 1
    historyLoading.value = false
    backToHistoryList()
  }
}
async function reloadHistory() {
  historyGeneration += 1
  historyLoading.value = false
  historySessions.value = []
  historyOffset.value = 0
  historyHasMore.value = false
  backToHistoryList()
  await loadMoreHistory()
}
async function loadMoreHistory() {
  if (historyLoading.value || historyMutating.value) return
  const generation = historyGeneration
  historyLoading.value = true
  historyError.value = ''
  try {
    const result = await listHarnessSessions(historyOffset.value)
    if (generation !== historyGeneration) return
    const existingIds = new Set(historySessions.value.map((item) => item.id))
    historySessions.value = [...historySessions.value, ...result.sessions.filter((item) => !existingIds.has(item.id))]
    historyOffset.value += result.sessions.length
    historyHasMore.value = result.hasMore
  } catch {
    if (generation === historyGeneration) historyError.value = '读取记录失败，请重试。'
  } finally {
    if (generation === historyGeneration) historyLoading.value = false
  }
}
async function openHistory(id: string) {
  const generation = ++detailGeneration
  historyDetailLoading.value = true
  historyError.value = ''
  try {
    const record = await getHarnessSession(id)
    if (generation !== detailGeneration) return
    if (record) selectedHistory.value = record
    else {
      historySessions.value = historySessions.value.filter((item) => item.id !== id)
      historyOffset.value = historySessions.value.length
      historyError.value = '这条记录已过期或已被删除。'
    }
  } catch {
    if (generation === detailGeneration) historyError.value = '读取记录详情失败，请重试。'
  } finally {
    if (generation === detailGeneration) historyDetailLoading.value = false
  }
}
async function removeHistory(id: string) {
  if (historyMutating.value) return
  historyMutating.value = true
  historyError.value = ''
  historyGeneration += 1
  historyLoading.value = false
  detailGeneration += 1
  historyDetailLoading.value = false
  try {
    await deleteHarnessSession(id)
    historySessions.value = historySessions.value.filter((item) => item.id !== id)
    historyOffset.value = historySessions.value.length
    if (selectedHistory.value?.id === id) backToHistoryList()
  } catch {
    historyError.value = '删除记录失败，请重试。'
  } finally {
    historyMutating.value = false
  }
}
async function clearHistory() {
  if (historyMutating.value || !window.confirm('清空本机全部阅读记录？删除后无法恢复。')) return
  historyMutating.value = true
  historyError.value = ''
  historyGeneration += 1
  historyLoading.value = false
  backToHistoryList()
  try {
    await clearHarnessSessions()
    historySessions.value = []
    historyOffset.value = 0
    historyHasMore.value = false
  } catch {
    historyError.value = '清空记录失败，请重试。'
  } finally {
    historyMutating.value = false
  }
}
function toggleAction(id: HarnessActionId) {
  if (id === 'meaning') return
  const actions = config.value.harness.actions.includes(id) ? config.value.harness.actions.filter((item) => item !== id) : [...config.value.harness.actions, id]
  config.value.harness.actions = actions.includes('meaning') ? actions : ['meaning', ...actions]
  if (!config.value.harness.actions.includes(config.value.harness.defaultAction)) config.value.harness.defaultAction = 'meaning'
}
onBeforeUnmount(() => {
  historyGeneration += 1
  detailGeneration += 1
})
</script>

<style scoped>
.harness-preview-wrap { display:flex; justify-content:center; }
.harness-preview { width:100%; max-width:640px; margin-inline:auto; padding:16px; border:1px solid var(--line); border-radius:12px; background:var(--surface-soft); color:var(--ink); }
.harness-preview-caption { display:flex; flex-wrap:wrap; justify-content:space-between; gap:5px 12px; margin-bottom:12px; color:var(--muted); font-size:11px; }
.harness-preview-caption small { font-size:10px; }
.harness-sentence { margin:0 0 12px; color:var(--ink); font-size:13px; line-height:1.8; overflow-wrap:anywhere; }
.harness-sentence mark { color:inherit; background:color-mix(in srgb, var(--accent) 12%, transparent); border-radius:3px; padding:2px 1px; box-decoration-break:clone; -webkit-box-decoration-break:clone; }
.harness-preview-actions { display:flex; flex-wrap:wrap; gap:6px; padding-bottom:13px; }
.harness-preview-actions button { border:1px solid var(--line); border-radius:7px; padding:6px 12px; background:var(--surface); color:var(--ink); cursor:pointer; font:inherit; font-size:12px; }
.harness-preview-actions button.is-default { border-color:color-mix(in srgb, var(--accent) 40%, var(--line)); color:var(--accent); }
.harness-preview-actions button.active { border-color:var(--accent); background:color-mix(in srgb, var(--accent) 9%, var(--surface)); color:var(--accent); }
.harness-preview-answer { min-height:150px; padding:14px; border:1px solid var(--line); border-radius:10px; background:var(--surface); }
.harness-preview-footer { margin:12px 0 0; color:var(--muted); font-size:10.5px; line-height:1.6; }
.harness-more, .harness-history { margin:0 auto 22px; width:min(100%,1080px); }
.harness-more > summary { padding:10px 4px; color:var(--ink); cursor:pointer; font-size:13px; font-weight:700; }
.harness-more > summary span { margin-left:10px; color:var(--muted); font-size:10.5px; font-weight:400; }
.harness-more[open] > summary { margin-bottom:8px; }
.service-control { display:flex; width:100%; max-width:360px; flex-direction:column; gap:5px; }
.service-hint { color:var(--warning, #b26a00); font-size:10.5px; line-height:1.5; }
.harness-context-limit { display:flex; align-items:center; gap:9px; width:100%; color:var(--muted); font-size:11px; }
.harness-context-limit .el-input-number { flex:1; min-width:0; }
.harness-context-limit span { flex-shrink:0; }
.harness-actions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.harness-action { display:flex; gap:8px; align-items:flex-start; padding:10px; border:1px solid var(--line); border-radius:8px; cursor:pointer; }
.harness-action input { accent-color:var(--accent); margin:3px 0 0; }
.harness-action span { display:flex; flex-direction:column; gap:3px; color:var(--ink); font-size:12px; }
.harness-action small { color:var(--muted); font-size:10.5px; line-height:1.5; }
.harness-history-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:2px 4px; }
.harness-history-heading h2 { margin:0 0 4px; font-size:13px; line-height:1.5; color:var(--ink); }
.harness-history-heading p { margin:0; font-size:10.5px; line-height:1.6; color:var(--muted); }
.harness-history button { font:inherit; font-size:11.5px; cursor:pointer; }
.harness-history button:disabled { cursor:wait; opacity:.6; }
.harness-history button:focus-visible, .harness-preview-actions button:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.harness-secondary-button { flex-shrink:0; border:1px solid var(--line); border-radius:8px; padding:7px 11px; background:var(--surface); color:var(--ink); }
.harness-secondary-button:hover, .harness-text-button:hover { color:var(--accent); }
.harness-text-button { border:0; border-radius:6px; padding:7px 8px; background:transparent; color:var(--muted); }
.harness-history-body { color:var(--ink); margin-top:12px; padding:14px 16px; border:1px solid var(--line); border-radius:14px; background:var(--surface); }
.harness-history-list { max-height:420px; overflow:auto; }
.harness-history-row { display:flex; align-items:center; gap:10px; border-bottom:1px solid var(--line); }
.harness-history-row:last-child { border-bottom:0; }
.harness-history-row > .harness-text-button { flex-shrink:0; }
.harness-history-open { display:flex; flex:1; min-width:0; flex-direction:column; gap:5px; padding:12px 4px; text-align:left; border:0; background:transparent; color:var(--ink); border-radius:6px; }
.harness-history-open:hover { color:var(--accent); }
.harness-history-open > span { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; line-height:1.6; overflow-wrap:anywhere; }
.harness-history-open > small { color:var(--muted); font-size:10px; line-height:1.5; }
.harness-history-toolbar { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:12px; }
.harness-history-toolbar:first-child { margin:0 0 14px; }
.harness-history-count { color:var(--muted); font-size:10.5px; }
.harness-history-detail { max-width:740px; margin-inline:auto; overflow-wrap:anywhere; }
.harness-history-source { padding:13px 14px; border-radius:10px; background:var(--surface-soft); }
.harness-history-source > small { color:var(--muted); font-size:10.5px; }
.harness-history-source blockquote { margin:7px 0; color:var(--ink); font-size:13px; line-height:1.7; white-space:pre-wrap; }
.harness-history-source p { margin:6px 0 0; color:var(--muted); font-size:10px; }
.harness-history-turn { padding:20px 2px; border-bottom:1px solid var(--line); }
.harness-history-turn:last-child { border-bottom:0; padding-bottom:4px; }
.harness-history-turn > header { margin-bottom:13px; }
.harness-history-turn h3 { margin:0 0 5px; color:var(--ink); font-size:13px; line-height:1.6; white-space:pre-wrap; }
.harness-history-turn > header > small { color:var(--muted); font-size:10px; }
.harness-history-feedback, .harness-history-empty-answer, .harness-history-footnote { margin:10px 0; color:var(--muted); font-size:11px; line-height:1.65; }
.harness-history-feedback button { margin-left:7px; padding:3px 6px; border:0; border-radius:4px; background:var(--surface-soft); color:var(--accent); }
.harness-history-footnote { margin:18px 0 0; }
.harness-history-empty { padding:18px 6px; text-align:center; }
.harness-history-empty strong { color:var(--ink); font-size:12px; }
.harness-history-empty p { max-width:360px; margin:8px auto 0; color:var(--muted); font-size:11px; line-height:1.8; }
.harness-visually-hidden { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
@media (max-width:700px) { .harness-actions { grid-template-columns:1fr; } }
@media (max-width:480px) {
  .harness-preview { padding:12px; }
  .harness-preview-answer { padding:12px; }
  .harness-preview-caption { gap:4px; }
  .harness-more > summary span { display:block; margin:5px 0 0 14px; }
  .harness-history-heading { align-items:flex-start; }
  .harness-history-body { padding:12px; }
  .harness-history-row { gap:4px; }
  .harness-history-source { padding:11px; }
}
</style>
