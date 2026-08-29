<!--
 @file src/features/model-usage/ui/ModelUsageDashboard.vue
 文件职责：在 Options 设置页展示仅属于当前浏览器的模型调用统计，并提供服务、模型与时间范围筛选和统计重置入口。
 主要内容：通过 modelUsage runtime 合同查询聚合快照，呈现今日、七天、三十天 Token、请求均值、趋势和服务模型分布，并处理加载、空数据、部分上报、失败与二次确认重置状态。
 模块边界：组件只消费后台聚合结果，不读取 API Key、不记录原文或网址，也不直接访问统计仓库；事件采集、Token 解析、持久化与跨上下文消息处理由 services 和 background 层拥有。
-->
<template>
  <section id="settings-model-usage" class="model-usage-dashboard" aria-label="模型用量统计">
    <div class="usage-toolbar">
      <div class="usage-filter-grid" aria-label="模型用量筛选">
        <label class="usage-filter">
          <span>服务</span>
          <div class="usage-select-shell">
            <ServiceIcon
              v-if="selectedService"
              :service="selectedService"
              :label="serviceLabel(selectedService)"
              size="small"
            />
            <select v-model="selectedService" aria-label="模型用量服务" @change="handleServiceChange">
              <option value="">全部 AI 服务</option>
              <option v-for="service in serviceOptions" :key="service.id" :value="service.id">
                {{ service.label }}
              </option>
            </select>
          </div>
        </label>

        <label class="usage-filter">
          <span>模型</span>
          <div class="usage-select-shell">
            <select v-model="selectedModel" aria-label="模型用量模型">
              <option value="">全部模型</option>
              <option v-for="model in modelOptions" :key="model" :value="model">
                {{ modelLabel(model) }}
              </option>
            </select>
          </div>
        </label>

        <div class="usage-range-filter">
          <span>时间范围</span>
          <div ref="rangeControl" class="usage-range-control" role="radiogroup" aria-label="模型用量时间范围">
            <button
              v-for="(option, index) in rangeOptions"
              :key="option.value"
              type="button"
              role="radio"
              :data-range-index="index"
              :aria-checked="range === option.value"
              :tabindex="range === option.value ? 0 : -1"
              :class="{ active: range === option.value }"
              @click="range = option.value"
              @keydown="handleRangeKeydown($event, index)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
      </div>

      <button ref="resetButton" type="button" class="usage-reset-button" @click="openResetDialog">
        清除统计
      </button>
    </div>

    <div class="usage-local-notice">
      <span aria-hidden="true">本机</span>
      <p>
        仅统计本机 FluentRead 从此功能上线后发起的大模型调用。普通 API Key 不能读取服务商账号的全部历史用量。
      </p>
      <small v-if="snapshot">
        {{ recordingStartLabel }} · {{ generatedAtLabel }}
      </small>
    </div>

    <div v-if="errorMessage && snapshot" class="usage-inline-error" role="status">
      <span>{{ errorMessage }}</span>
      <button type="button" @click="loadSnapshot">重试</button>
    </div>

    <div v-if="loading && !snapshot" class="usage-state-card" aria-live="polite">
      <span class="usage-loader" aria-hidden="true"></span>
      <strong>正在读取本机统计</strong>
      <p>不会向模型服务商额外发送请求。</p>
    </div>

    <div v-else-if="errorMessage && !snapshot" class="usage-state-card usage-error-state" role="alert">
      <span aria-hidden="true">!</span>
      <strong>暂时无法读取模型用量</strong>
      <p>{{ errorMessage }}</p>
      <button type="button" @click="loadSnapshot">重新读取</button>
    </div>

    <template v-else-if="snapshot">
      <div class="usage-summary-grid" :aria-busy="loading">
        <article class="usage-card usage-token-card">
          <div class="usage-card-heading">
            <div>
              <span>Token 使用量</span>
              <strong>{{ formatNumber(selectedTotals.totalTokens) }}</strong>
            </div>
            <small>
              {{ appliedRangeLabel }} · {{ appliedScopeLabel }}
              <em v-if="loading">正在更新…</em>
            </small>
          </div>
          <div class="usage-periods" aria-label="各时间范围 Token 使用量">
            <div>
              <span>今日</span>
              <strong>{{ formatNumber(snapshot.metrics.today.totalTokens) }}</strong>
            </div>
            <div>
              <span>7 天</span>
              <strong>{{ formatNumber(snapshot.metrics.sevenDays.totalTokens) }}</strong>
            </div>
            <div>
              <span>30 天</span>
              <strong>{{ formatNumber(snapshot.metrics.thirtyDays.totalTokens) }}</strong>
            </div>
          </div>
        </article>

        <article class="usage-card usage-compact-card">
          <span>模型请求</span>
          <strong>{{ formatNumber(selectedTotals.requestCount) }}</strong>
          <small>{{ formatNumber(selectedTotals.successfulRequests) }} 次成功 · {{ formatNumber(selectedTotals.failedRequests) }} 次失败</small>
        </article>

        <article class="usage-card usage-compact-card">
          <span>平均每次请求</span>
          <strong>{{ formatAverage(selectedTotals.averageTokensPerReportedRequest) }}</strong>
          <small>只按返回 Token 明细的请求计算</small>
        </article>

        <article class="usage-card usage-compact-card">
          <span>输入 / 输出</span>
          <strong>{{ formatNumber(selectedTotals.inputTokens) }} <i>/</i> {{ formatNumber(selectedTotals.outputTokens) }}</strong>
          <div v-if="inputRatio !== null" class="usage-ratio" aria-hidden="true">
            <span class="usage-ratio-input" :style="{ width: `${inputRatio}%` }"></span>
            <span class="usage-ratio-output" :style="{ width: `${100 - inputRatio}%` }"></span>
          </div>
          <small v-if="selectedTotals.cachedInputTokens || selectedTotals.reasoningTokens">
            缓存输入 {{ formatNumber(selectedTotals.cachedInputTokens) }} · 推理 {{ formatNumber(selectedTotals.reasoningTokens) }}
          </small>
          <small v-else-if="inputRatio !== null">输入 Token / 输出 Token</small>
          <small v-else>尚无已报告的输入 / 输出 Token</small>
        </article>
      </div>

      <div v-if="hasIncompleteCoverage" class="usage-coverage-note" role="status">
        <strong>Token 明细覆盖 {{ coverageLabel }}</strong>
        <span>部分成功请求没有返回 usage；请求数仍完整，Token 和平均值只统计已报告部分。</span>
      </div>

      <div v-if="!hasSelectedUsage" class="usage-state-card usage-empty-state">
        <span aria-hidden="true">∿</span>
        <strong>{{ hasActiveFilter ? '当前筛选还没有调用记录' : '还没有模型调用记录' }}</strong>
        <p>
          {{ hasActiveFilter ? '可以切回全部服务、全部模型或更长的时间范围。' : '从下一次使用 AI 翻译开始，这里会在本机记录请求和 Token。' }}
        </p>
        <button v-if="hasActiveFilter" type="button" @click="clearFilters">查看全部用量</button>
      </div>

      <div v-else class="usage-detail-grid">
        <figure class="usage-card usage-trend-card" :aria-label="trendAriaLabel">
          <figcaption>
            <div>
              <span>用量轨迹</span>
              <strong>{{ appliedRangeLabel }} Token 变化</strong>
            </div>
            <div class="usage-legend" aria-label="趋势图图例">
              <span><i class="input"></i>输入</span>
              <span><i class="output"></i>输出</span>
            </div>
          </figcaption>

          <ol
            v-if="timelineRows.length"
            class="usage-trend-plot"
            aria-label="按时间排列的 Token 数据"
            :style="{ gridTemplateColumns: `repeat(${timelineRows.length}, minmax(0, 1fr))` }"
          >
            <li
              v-for="(point, index) in timelineRows"
              :key="point.key"
              :aria-label="point.ariaLabel"
              tabindex="0"
            >
              <div class="usage-bar-track" aria-hidden="true">
                <div class="usage-bar" :style="{ height: `${point.height}%` }">
                  <span class="usage-bar-output" :style="{ height: `${point.outputShare}%` }"></span>
                  <span class="usage-bar-input" :style="{ height: `${100 - point.outputShare}%` }"></span>
                </div>
              </div>
              <span :class="{ muted: !showTimelineLabel(index) }">{{ showTimelineLabel(index) ? point.label : '·' }}</span>
            </li>
          </ol>
          <div v-else class="usage-chart-empty">当前范围没有可绘制的数据</div>
        </figure>

        <section class="usage-card usage-breakdown-card" aria-labelledby="usage-breakdown-title">
          <header>
            <div>
              <span>服务与模型分布</span>
              <strong id="usage-breakdown-title">谁产生了这些 Token</strong>
            </div>
            <small>点击一行筛选</small>
          </header>

          <div class="usage-breakdown-heading" aria-hidden="true">
            <span>服务 / 模型</span><span>请求</span><span>Token</span>
          </div>
          <div class="usage-breakdown-list">
            <button
              v-for="row in visibleBreakdown"
              :key="`${row.serviceId}:${row.model}`"
              type="button"
              :class="{ active: appliedFilter.serviceId === row.serviceId && appliedFilter.model === row.model }"
              :aria-label="`${serviceLabel(row.serviceId)} ${modelLabel(row.model)}，${formatNumber(row.totals.requestCount)} 次请求，${formatNumber(row.totals.totalTokens)} Token，点击筛选`"
              @click="selectBreakdown(row.serviceId, row.model)"
            >
              <ServiceIcon :service="row.serviceId" :label="serviceLabel(row.serviceId)" size="small" />
              <span class="usage-breakdown-copy">
                <strong>{{ serviceLabel(row.serviceId) }}</strong>
                <small>{{ modelLabel(row.model) }}</small>
                <i aria-hidden="true"><b :style="{ width: `${breakdownShare(row.totals.totalTokens)}%` }"></b></i>
              </span>
              <span>{{ formatNumber(row.totals.requestCount) }}</span>
              <strong>{{ formatNumber(row.totals.totalTokens) }}</strong>
            </button>
          </div>
          <button
            v-if="snapshot.breakdown.length > BREAKDOWN_PREVIEW_COUNT"
            type="button"
            class="usage-show-all"
            :aria-expanded="showAllBreakdown"
            @click="showAllBreakdown = !showAllBreakdown"
          >
            {{ showAllBreakdown ? '收起' : `查看全部 ${snapshot.breakdown.length} 项` }}
          </button>
        </section>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="resetDialogOpen" class="usage-dialog-backdrop" @click.self="closeResetDialog">
        <section
          ref="resetDialog"
          class="usage-reset-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="usage-reset-title"
          aria-describedby="usage-reset-description"
          tabindex="-1"
          @keydown="handleResetDialogKeydown"
        >
          <span class="usage-dialog-icon" aria-hidden="true">!</span>
          <h2 id="usage-reset-title">清除本机模型用量？</h2>
          <p id="usage-reset-description">只会删除模型调用统计，不会删除 API Key、翻译设置、缓存或配置历史。此操作无法撤销。</p>
          <p v-if="resetError" class="usage-dialog-error" role="alert">{{ resetError }}</p>
          <div>
            <button ref="resetCancelButton" type="button" :disabled="resetting" @click="closeResetDialog">取消</button>
            <button type="button" class="danger" :disabled="resetting" @click="resetUsage">
              {{ resetting ? '正在清除…' : '确认清除统计' }}
            </button>
          </div>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import browser from 'webextension-polyfill'
import {options} from '@/src/core/config/catalog'
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue'
import type {
  DashboardSnapshot,
  Filter,
  Range,
  Totals,
} from '@/src/services/model-usage/types'

type ModelUsageQueryResponse = {
  success?: boolean
  data?: DashboardSnapshot
  error?: string
}

type ModelUsageResetResponse = {
  success?: boolean
  data?: {cleared?: boolean}
  error?: string
}

const BREAKDOWN_PREVIEW_COUNT = 8
const rangeOptions: Array<{value: Range; label: string}> = [
  {value: 'today', label: '今日'},
  {value: '7d', label: '7 天'},
  {value: '30d', label: '30 天'},
]

const snapshot = ref<DashboardSnapshot | null>(null)
const props = withDefaults(defineProps<{
  active?: boolean
}>(), {
  active: true,
})
const selectedService = ref('')
const selectedModel = ref('')
const range = ref<Range>('30d')
const loading = ref(false)
const errorMessage = ref('')
const showAllBreakdown = ref(false)
const resetDialogOpen = ref(false)
const resetting = ref(false)
const resetError = ref('')
const rangeControl = ref<HTMLElement | null>(null)
const resetDialog = ref<HTMLElement | null>(null)
const resetCancelButton = ref<HTMLButtonElement | null>(null)
const resetButton = ref<HTMLButtonElement | null>(null)
let requestRevision = 0
let mounted = false

const selectedTotals = computed<Totals>(() => snapshot.value!.selected.totals)
const appliedFilter = computed<Filter>(() => snapshot.value?.selected.filter || {range: range.value})
const appliedRangeLabel = computed(() => (
  rangeOptions.find(option => option.value === appliedFilter.value.range)?.label || '30 天'
))
const serviceOptions = computed(() => {
  const dimensions = snapshot.value?.dimensions || []
  return dimensions.map(dimension => ({
    id: dimension.serviceId,
    label: serviceLabel(dimension.serviceId),
  }))
})
const modelOptions = computed(() => {
  const dimensions = snapshot.value?.dimensions || []
  const source = selectedService.value
    ? dimensions.filter(dimension => dimension.serviceId === selectedService.value)
    : dimensions
  return [...new Set(source.flatMap(dimension => dimension.models))]
    .sort((left, right) => modelLabel(left).localeCompare(modelLabel(right), 'zh-CN'))
})
const appliedScopeLabel = computed(() => {
  const service = appliedFilter.value.serviceId ? serviceLabel(appliedFilter.value.serviceId) : '全部 AI 服务'
  return appliedFilter.value.model ? `${service} · ${modelLabel(appliedFilter.value.model)}` : service
})
const hasActiveFilter = computed(() => Boolean(
  appliedFilter.value.serviceId || appliedFilter.value.model || appliedFilter.value.range !== '30d',
))
const hasSelectedUsage = computed(() => selectedTotals.value.requestCount > 0)
const hasIncompleteCoverage = computed(() => (
  selectedTotals.value.successfulRequests > selectedTotals.value.reportedTokenRequests
))
const coverageLabel = computed(() => {
  const successful = selectedTotals.value.successfulRequests
  if (successful <= 0) return '0%'
  return `${Math.round((selectedTotals.value.reportedTokenRequests / successful) * 100)}%`
})
const inputRatio = computed<number | null>(() => {
  const total = selectedTotals.value.inputTokens + selectedTotals.value.outputTokens
  return total > 0 ? Math.round((selectedTotals.value.inputTokens / total) * 100) : null
})
const visibleBreakdown = computed(() => {
  const rows = snapshot.value?.breakdown || []
  return showAllBreakdown.value ? rows : rows.slice(0, BREAKDOWN_PREVIEW_COUNT)
})
const largestBreakdownTotal = computed(() => Math.max(
  1,
  ...(snapshot.value?.breakdown || []).map(row => row.totals.totalTokens),
))
const timelineRows = computed(() => {
  const timeline = snapshot.value?.timeline || []
  const maximum = Math.max(1, ...timeline.map(point => point.totals.totalTokens))
  return timeline.map(point => {
    const reported = point.totals.inputTokens + point.totals.outputTokens
    const outputShare = reported > 0 ? (point.totals.outputTokens / reported) * 100 : 0
    return {
      ...point,
      height: point.totals.totalTokens > 0 ? Math.max(3, (point.totals.totalTokens / maximum) * 100) : 0,
      outputShare,
      ariaLabel: `${point.label}，输入 ${formatNumber(point.totals.inputTokens)} Token，输出 ${formatNumber(point.totals.outputTokens)} Token，共 ${formatNumber(point.totals.totalTokens)} Token`,
    }
  })
})
const trendAriaLabel = computed(() => (
  `${appliedRangeLabel.value}${appliedScopeLabel.value}用量趋势，共 ${formatNumber(selectedTotals.value.totalTokens)} Token`
))
const recordingStartLabel = computed(() => snapshot.value?.recordingStartedAt
  ? `开始记录于 ${formatDate(snapshot.value.recordingStartedAt)}`
  : '尚未开始记录')
const generatedAtLabel = computed(() => snapshot.value
  ? `更新于 ${formatDate(snapshot.value.generatedAt)}`
  : '')

function serviceLabel(serviceId: string): string {
  return options.services.find(option => option.value === serviceId)?.label || serviceId || '未知服务'
}

function modelLabel(model: string): string {
  return model === 'unknown' ? '未知模型' : model
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 0}).format(Math.max(0, value || 0))
}

function formatAverage(value: number | null): string {
  return value === null ? '—' : `${formatNumber(value)} Token`
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function showTimelineLabel(index: number): boolean {
  const count = timelineRows.value.length
  if (count <= 8) return true
  const interval = count <= 14 ? 2 : 5
  return index === 0 || index === count - 1 || index % interval === 0
}

function breakdownShare(totalTokens: number): number {
  if (totalTokens <= 0) return 0
  return Math.max(2, (totalTokens / largestBreakdownTotal.value) * 100)
}

function handleRangeKeydown(event: KeyboardEvent, currentIndex: number): void {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  let nextIndex: number
  if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = rangeOptions.length - 1
  else {
    const offset = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
    nextIndex = (currentIndex + offset + rangeOptions.length) % rangeOptions.length
  }
  range.value = rangeOptions[nextIndex].value
  void nextTick(() => {
    rangeControl.value
      ?.querySelector<HTMLButtonElement>(`button[data-range-index="${nextIndex}"]`)
      ?.focus()
  })
}

function handleServiceChange(): void {
  if (selectedModel.value && !modelOptions.value.includes(selectedModel.value)) selectedModel.value = ''
  showAllBreakdown.value = false
}

function selectBreakdown(serviceId: string, model: string): void {
  selectedService.value = serviceId
  selectedModel.value = model
  showAllBreakdown.value = false
}

function clearFilters(): void {
  selectedService.value = ''
  selectedModel.value = ''
  range.value = '30d'
  showAllBreakdown.value = false
}

async function loadSnapshot(): Promise<void> {
  const revision = ++requestRevision
  loading.value = true
  errorMessage.value = ''
  try {
    const filter: Filter = {
      range: range.value,
      ...(selectedService.value ? {serviceId: selectedService.value} : {}),
      ...(selectedModel.value ? {model: selectedModel.value} : {}),
    }
    const response = await browser.runtime.sendMessage({
      type: 'modelUsage',
      action: 'query',
      filter,
    }) as ModelUsageQueryResponse
    if (revision !== requestRevision) return
    if (response?.success !== true || !response.data) {
      throw new Error(response?.error || '后台没有返回可用的统计快照')
    }
    snapshot.value = response.data
  } catch (error) {
    if (revision !== requestRevision) return
    errorMessage.value = error instanceof Error ? error.message : '未知错误'
  } finally {
    if (revision === requestRevision) loading.value = false
  }
}

async function openResetDialog(): Promise<void> {
  resetError.value = ''
  setSettingsBackgroundInert(true)
  resetDialogOpen.value = true
  await nextTick()
  resetCancelButton.value?.focus()
}

function closeResetDialog(): void {
  if (resetting.value) return
  resetDialogOpen.value = false
  setSettingsBackgroundInert(false)
  resetError.value = ''
  void nextTick(() => resetButton.value?.focus())
}

function setSettingsBackgroundInert(value: boolean): void {
  const settingsApp = document.querySelector<HTMLElement>('.settings-app')
  if (value) settingsApp?.setAttribute('inert', '')
  else settingsApp?.removeAttribute('inert')
}

function handleResetDialogKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeResetDialog()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = [...(resetDialog.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])]
  if (!focusable.length) {
    event.preventDefault()
    resetDialog.value?.focus()
    return
  }
  const first = focusable[0]
  const last = focusable.at(-1)!
  if (event.shiftKey && (document.activeElement === first || document.activeElement === resetDialog.value)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

async function resetUsage(): Promise<void> {
  if (resetting.value) return
  resetting.value = true
  resetError.value = ''
  try {
    const response = await browser.runtime.sendMessage({
      type: 'modelUsage',
      action: 'reset',
    }) as ModelUsageResetResponse
    if (response?.success !== true) throw new Error(response?.error || '后台没有确认清除结果')
    resetDialogOpen.value = false
    setSettingsBackgroundInert(false)
    await loadSnapshot()
    await nextTick()
    resetButton.value?.focus()
  } catch (error) {
    resetError.value = error instanceof Error ? error.message : '清除统计失败'
  } finally {
    resetting.value = false
  }
}

watch([selectedService, selectedModel, range], () => {
  if (!mounted || !props.active) return
  void loadSnapshot()
}, {flush: 'post'})

watch(() => props.active, (active, previous) => {
  if (!mounted || !active || previous === active) return
  void loadSnapshot()
})

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible' && props.active) void loadSnapshot()
}

onMounted(() => {
  mounted = true
  document.addEventListener('visibilitychange', handleVisibilityChange)
  if (props.active) void loadSnapshot()
})

onBeforeUnmount(() => {
  mounted = false
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  setSettingsBackgroundInert(false)
})
</script>

<style scoped src="./model-usage-dashboard.css"></style>
