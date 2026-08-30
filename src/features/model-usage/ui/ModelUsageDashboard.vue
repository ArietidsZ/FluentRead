<!--
 @file src/features/model-usage/ui/ModelUsageDashboard.vue
 文件职责：在 Options 设置页展示当前浏览器保存的模型调用可观测数据，并提供筛选、请求明细、迁移和独立重置入口。
 主要内容：呈现自适应 Token 大数、缓存读取/写入与命中率、请求结果、输入输出均值、趋势、服务模型分布和稳定游标分页的逐请求记录，并支持版本化 JSON 导入导出。
 模块边界：组件只消费后台白名单数据，不读取 API Key、不记录原文、译文、提示词或网址，也不直接访问 IndexedDB；事件采集、Token 解释、持久化和导入校验由 services、providers 与 background 层拥有。
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
            <el-select v-model="selectedService" class="usage-select" popper-class="usage-select-popper" fit-input-width aria-label="模型用量服务" placeholder="全部 AI 服务" @change="handleServiceChange">
              <el-option label="全部 AI 服务" value="" />
              <el-option v-for="service in serviceOptions" :key="service.id" :label="service.label" :value="service.id" />
            </el-select>
          </div>
        </label>

        <label class="usage-filter">
          <span>模型</span>
          <div class="usage-select-shell">
            <el-select v-model="selectedModel" class="usage-select" popper-class="usage-select-popper" fit-input-width aria-label="模型用量模型" placeholder="全部模型">
              <el-option label="全部模型" value="" />
              <el-option v-for="model in modelOptions" :key="model" :label="modelLabel(model)" :value="model" />
            </el-select>
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

      <div class="usage-toolbar-actions" aria-label="模型用量数据管理">
        <button type="button" class="usage-data-button" :disabled="exporting" @click="exportUsageData">
          {{ exporting ? '正在导出…' : '导出全部数据' }}
        </button>
        <button type="button" class="usage-data-button" :disabled="importing" @click="openImportPicker">
          {{ importing ? '正在导入…' : '导入数据' }}
        </button>
        <button ref="resetButton" type="button" class="usage-reset-button" @click="openResetDialog">
          清除统计
        </button>
        <input
          ref="importFileInput"
          class="usage-file-input"
          type="file"
          accept=".json,application/json"
          aria-label="选择模型用量 JSON 文件"
          @change="handleImportFile"
        />
      </div>
    </div>

    <div class="usage-local-notice">
      <span aria-hidden="true">本机</span>
      <p>
        统计保存在当前浏览器，包含 FluentRead 在此设备发起及从用量文件导入的调用。普通 API Key 不能读取服务商账号的全部历史用量。
      </p>
      <small v-if="snapshot">
        {{ recordingStartLabel }} · {{ generatedAtLabel }}
      </small>
    </div>

    <div
      v-if="transferMessage"
      class="usage-transfer-message"
      :class="{ error: transferMessageIsError }"
      :role="transferMessageIsError ? 'alert' : 'status'"
    >
      {{ transferMessage }}
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
            <div class="usage-summary-copy">
              <span>Token 使用量</span>
              <strong
                :title="tokenExactTitle(selectedTotals.totalTokens)"
                :aria-label="tokenAriaLabel(selectedTotals.totalTokens)"
              >{{ formatToken(selectedTotals.totalTokens) }}</strong>
              <small class="usage-card-context">
                {{ appliedRangeLabel }} · {{ appliedScopeLabel }}
                <em v-if="loading">正在更新…</em>
              </small>
            </div>
            <span class="usage-card-badge">本机统计</span>
          </div>
          <div class="usage-periods" aria-label="各时间范围 Token 使用量">
            <div>
              <span>今日</span>
              <strong :title="tokenExactTitle(snapshot.metrics.today.totalTokens)">{{ formatToken(snapshot.metrics.today.totalTokens) }}</strong>
            </div>
            <div>
              <span>7 天</span>
              <strong :title="tokenExactTitle(snapshot.metrics.sevenDays.totalTokens)">{{ formatToken(snapshot.metrics.sevenDays.totalTokens) }}</strong>
            </div>
            <div>
              <span>30 天</span>
              <strong :title="tokenExactTitle(snapshot.metrics.thirtyDays.totalTokens)">{{ formatToken(snapshot.metrics.thirtyDays.totalTokens) }}</strong>
            </div>
          </div>
        </article>

        <article class="usage-card usage-compact-card">
          <div class="usage-metric-heading">
            <span>模型请求</span>
            <small>{{ appliedRangeLabel }}</small>
          </div>
          <strong>{{ formatNumber(selectedTotals.requestCount) }}</strong>
          <small>
            {{ formatNumber(selectedTotals.successfulRequests) }} 成功 ·
            {{ formatNumber(selectedTotals.errorRequests) }} 错误 ·
            {{ formatNumber(selectedTotals.timeoutRequests) }} 超时 ·
            {{ formatNumber(selectedTotals.cancelledRequests) }} 取消
          </small>
        </article>

        <article class="usage-card usage-compact-card usage-average-card">
          <div class="usage-metric-heading">
            <span>平均每次请求</span>
            <small>分别计算</small>
          </div>
          <div class="usage-average-grid">
            <div class="usage-average-value">
              <span>输入 / 请求</span>
              <strong :title="averageTokenTitle(selectedTotals.averageInputTokensPerReportedRequest)">{{ formatAverageValue(selectedTotals.averageInputTokensPerReportedRequest) }}</strong>
              <small>Token</small>
            </div>
            <div class="usage-average-value">
              <span>输出 / 请求</span>
              <strong :title="averageTokenTitle(selectedTotals.averageOutputTokensPerReportedRequest)">{{ formatAverageValue(selectedTotals.averageOutputTokensPerReportedRequest) }}</strong>
              <small>Token</small>
            </div>
          </div>
          <small class="usage-card-footnote">只按返回 Token 明细的请求计算</small>
        </article>

        <article class="usage-card usage-compact-card usage-cache-card">
          <div class="usage-metric-heading">
            <span>模型缓存</span>
            <small>输入 Token</small>
          </div>
          <strong>{{ formatUsageRate(selectedTotals.cacheTokenHitRate) }}</strong>
          <span class="usage-cache-caption">Token 命中率</span>
          <div class="usage-cache-values">
            <div>
              <span>缓存读取</span>
              <strong :title="tokenExactTitle(selectedTotals.cachedInputTokens)">{{ formatToken(selectedTotals.cachedInputTokens) }}</strong>
            </div>
            <div>
              <span>缓存写入</span>
              <strong :title="tokenExactTitle(selectedTotals.cacheWriteTokens)">{{ formatToken(selectedTotals.cacheWriteTokens) }}</strong>
            </div>
          </div>
          <small v-if="selectedTotals.cacheReportedRequests">
            {{ selectedTotals.cacheHitRequests }}/{{ selectedTotals.cacheReportedRequests }} 次请求命中 · 缓存明细覆盖 {{ formatUsageRate(selectedTotals.cacheCoverageRate) }}
          </small>
          <small v-else>服务商尚未返回可计算的缓存读取明细</small>
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

          <div class="usage-breakdown-heading" aria-label="分布排序">
            <span>服务 / 模型</span>
            <button
              v-for="option in breakdownSortOptions"
              :key="option.key"
              type="button"
              :data-sort-key="option.key"
              :aria-label="`按${option.label}排序`"
              :aria-pressed="breakdownSort === option.key"
              :class="{ active: breakdownSort === option.key }"
              @click="breakdownSort = option.key"
            >
              {{ option.label }}
            </button>
          </div>
          <div class="usage-breakdown-list">
            <button
              v-for="row in visibleBreakdown"
              :key="`${row.serviceId}:${row.model}`"
              type="button"
              :class="{ active: appliedFilter.serviceId === row.serviceId && appliedFilter.model === row.model }"
              :aria-label="`${serviceLabel(row.serviceId)} ${modelLabel(row.model)}，输入 ${formatNumber(row.totals.inputTokens)} Token，其中缓存读取 ${formatNumber(row.totals.cachedInputTokens)} Token，缓存 Token 命中率 ${formatUsageRate(row.totals.cacheTokenHitRate)}，输出 ${formatNumber(row.totals.outputTokens)} Token，共 ${formatNumber(row.totals.totalTokens)} Token，${formatNumber(row.totals.requestCount)} 次请求，点击筛选`"
              @click="selectBreakdown(row.serviceId, row.model)"
            >
              <ServiceIcon :service="row.serviceId" :label="serviceLabel(row.serviceId)" size="small" />
              <span class="usage-breakdown-copy">
                <strong>{{ serviceLabel(row.serviceId) }}</strong>
                <small>{{ modelLabel(row.model) }}</small>
                <i aria-hidden="true"><b :style="{ width: `${breakdownShare(row.totals.totalTokens)}%` }"></b></i>
              </span>
              <strong class="usage-breakdown-value" :title="tokenExactTitle(row.totals.inputTokens)">{{ formatToken(row.totals.inputTokens) }}</strong>
              <strong class="usage-breakdown-value usage-breakdown-cache" :title="cacheBreakdownTitle(row.totals)">{{ row.totals.cacheReportedRequests ? formatToken(row.totals.cachedInputTokens) : '—' }}</strong>
              <strong class="usage-breakdown-value" :title="tokenExactTitle(row.totals.outputTokens)">{{ formatToken(row.totals.outputTokens) }}</strong>
              <strong class="usage-breakdown-value usage-breakdown-requests">{{ formatNumber(row.totals.requestCount) }}</strong>
              <strong class="usage-breakdown-value usage-breakdown-total" :title="tokenExactTitle(row.totals.totalTokens)">{{ formatToken(row.totals.totalTokens) }}</strong>
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

      <section v-if="hasSelectedUsage" class="usage-card usage-request-log-card" aria-labelledby="usage-request-log-title">
        <header class="usage-request-log-header">
          <div>
            <span>逐请求可观测记录</span>
            <strong id="usage-request-log-title">每一次上游大模型调用</strong>
            <small>已显示 {{ requestLogItems.length }} / {{ formatNumber(requestLogTotalCount) }} 条</small>
          </div>
          <div class="usage-request-filters" aria-label="请求记录筛选">
            <label>
              <span>场景</span>
              <select v-model="requestPurpose" aria-label="按调用场景筛选请求记录">
                <option value="">全部场景</option>
                <option value="translation">翻译</option>
                <option value="page-summary">页面摘要</option>
                <option value="connection-test">连接测试</option>
              </select>
            </label>
            <label>
              <span>状态</span>
              <select v-model="requestOutcome" aria-label="按调用状态筛选请求记录">
                <option value="">全部状态</option>
                <option value="success">成功</option>
                <option value="error">错误</option>
                <option value="timeout">超时</option>
                <option value="cancelled">已取消</option>
              </select>
            </label>
            <label>
              <span>缓存</span>
              <select v-model="requestCacheStatus" aria-label="按模型缓存状态筛选请求记录">
                <option value="">全部缓存状态</option>
                <option value="hit">已命中</option>
                <option value="miss">未命中</option>
                <option value="unreported">未上报</option>
              </select>
            </label>
          </div>
        </header>

        <p class="usage-request-privacy">
          仅记录时间、服务与模型、调用场景、状态、耗时及服务商返回的 Token；不保存原文、译文、提示词、网页地址、API Key、请求体或响应正文。
        </p>

        <div v-if="requestLogError" class="usage-request-log-error" role="alert">
          <span>{{ requestLogError }}</span>
          <button type="button" @click="loadRequestLog(true)">重试</button>
        </div>
        <div v-if="requestLogLoading && !requestLogItems.length" class="usage-request-log-loading" role="status">
          正在读取请求记录…
        </div>
        <div v-else-if="!requestLogItems.length && !requestLogError" class="usage-request-log-empty">
          当前记录筛选下没有请求。
        </div>
        <div v-else class="usage-request-table-wrap">
          <table class="usage-request-table">
            <caption>当前服务、模型、时间范围与记录筛选下的大模型上游请求</caption>
            <thead>
              <tr>
                <th scope="col">发起时间</th>
                <th scope="col">服务 / 模型</th>
                <th scope="col">场景</th>
                <th scope="col">状态</th>
                <th scope="col">耗时</th>
                <th scope="col">Token 明细</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in requestLogItems" :key="item.id">
                <td data-label="发起时间">
                  <time :datetime="new Date(item.startedAt).toISOString()">{{ formatRequestTime(item.startedAt) }}</time>
                </td>
                <td data-label="服务 / 模型">
                  <span class="usage-request-service">
                    <ServiceIcon :service="item.serviceId" :label="serviceLabel(item.serviceId)" size="small" />
                    <span>
                      <strong>{{ serviceLabel(item.serviceId) }}</strong>
                      <small>{{ modelLabel(item.model) }}</small>
                      <small v-if="item.actualModel && item.actualModel !== item.configuredModel">配置模型：{{ modelLabel(item.configuredModel) }}</small>
                    </span>
                  </span>
                </td>
                <td data-label="场景"><span class="usage-purpose">{{ purposeLabel(item.purpose) }}</span></td>
                <td data-label="状态">
                  <span class="usage-request-status">
                    <strong :class="`is-${item.outcome}`">{{ outcomeLabel(item.outcome) }}</strong>
                    <small v-if="item.statusCode">HTTP {{ item.statusCode }}</small>
                  </span>
                </td>
                <td data-label="耗时">{{ formatDuration(item.durationMs) }}</td>
                <td data-label="Token 明细" class="usage-request-token-cell">
                  <template v-if="item.usageAvailability === 'reported'">
                    <div class="usage-request-tokens">
                      <span><i>输入</i><b :title="tokenExactTitle(item.inputTokens || 0)">{{ formatToken(item.inputTokens || 0) }}</b></span>
                      <span :class="{ hit: isCacheHit(item), miss: item.cachedInputTokens === 0 }">
                        <i>缓存读取</i>
                        <b :title="requestCacheTitle(item)">{{ requestCacheValue(item) }}</b>
                      </span>
                      <span><i>输出</i><b :title="tokenExactTitle(item.outputTokens || 0)">{{ formatToken(item.outputTokens || 0) }}</b></span>
                      <span><i>总计</i><b :title="tokenExactTitle(item.totalTokens || 0)">{{ formatToken(item.totalTokens || 0) }}</b></span>
                    </div>
                    <small v-if="item.cacheWriteTokens || item.reasoningTokens" class="usage-request-token-extra">
                      <span v-if="item.cacheWriteTokens">缓存写入 {{ formatToken(item.cacheWriteTokens) }}</span>
                      <span v-if="item.reasoningTokens">推理 {{ formatToken(item.reasoningTokens) }}</span>
                    </small>
                  </template>
                  <span v-else class="usage-unreported-token">{{ usageAvailabilityLabel(item.usageAvailability) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer v-if="requestLogItems.length" class="usage-request-log-footer" aria-live="polite">
          <span>{{ requestLogNextCursor ? '还可以查看更早记录' : '已显示当前筛选的全部记录' }}</span>
          <button
            v-if="requestLogNextCursor"
            type="button"
            :disabled="requestLogLoading"
            @click="loadRequestLog(false)"
          >{{ requestLogLoading ? '正在读取…' : '加载更早记录' }}</button>
        </footer>
      </section>
    </template>

    <el-dialog
      v-model="importDialogOpen"
      title="导入模型用量数据"
      width="min(560px, calc(100vw - 32px))"
      :close-on-click-modal="!importing"
      :close-on-press-escape="!importing"
      :show-close="!importing"
      destroy-on-close
      data-testid="model-usage-import-dialog"
      @closed="clearPendingImport"
    >
      <div v-if="pendingImportDocument" class="usage-import-preview">
        <div>
          <span>文件</span>
          <strong>{{ pendingImportFileName }}</strong>
        </div>
        <div>
          <span>请求记录</span>
          <strong>{{ formatNumber(pendingImportDocument.events.length) }} 条</strong>
        </div>
        <div>
          <span>时间范围</span>
          <strong>{{ pendingImportRangeLabel }}</strong>
        </div>
        <p>导入会按事件 ID 与当前统计合并：完全相同的记录自动跳过，冲突或非法记录会拒绝整批文件，不会覆盖现有数据。</p>
        <p class="usage-import-warning">JSON 未加密，会暴露调用时间、服务、模型和 Token 使用习惯；文件不包含原文、译文、网页地址或 API Key。</p>
        <p v-if="transferMessageIsError && transferMessage.startsWith('导入失败')" class="usage-dialog-error" role="alert">{{ transferMessage }}</p>
      </div>
      <template #footer>
        <el-button :disabled="importing" @click="importDialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="importing" :disabled="!pendingImportDocument" @click="confirmImport">
          合并并导入
        </el-button>
      </template>
    </el-dialog>

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
          <p id="usage-reset-description">会删除本机请求记录及其汇总；不会删除 API Key、翻译设置、FluentRead 译文缓存或配置历史。此操作无法撤销。</p>
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
import {formatTokenCount, formatUsageRate} from '@/src/features/model-usage/model/tokenFormat'
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue'
import {
  MODEL_USAGE_REQUEST_PAGE_SIZE,
  MODEL_USAGE_TRANSFER_FORMAT,
  MODEL_USAGE_TRANSFER_MAX_BYTES,
  MODEL_USAGE_TRANSFER_VERSION,
  type DashboardSnapshot,
  type Filter,
  type ModelUsageCacheStatus,
  type ModelUsageImportResult,
  type ModelUsageOutcome,
  type ModelUsagePurpose,
  type ModelUsageRequestCursor,
  type ModelUsageRequestPage,
  type ModelUsageTransferDocument,
  type Range,
  type StoredModelUsageEvent,
  type Totals,
} from '@/src/services/model-usage/types'

type ModelUsageResponse<T> = {
  success?: boolean
  data?: T
  error?: string
}

type BreakdownSortKey = 'input' | 'cache' | 'output' | 'requests' | 'total'
type RequestPurposeFilter = '' | ModelUsagePurpose
type RequestOutcomeFilter = '' | ModelUsageOutcome
type RequestCacheFilter = '' | ModelUsageCacheStatus

const BREAKDOWN_PREVIEW_COUNT = 8
const numberFormatter = new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 0})
const rangeDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})
const requestDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
})
const rangeOptions: Array<{value: Range; label: string}> = [
  {value: 'today', label: '今日'},
  {value: '7d', label: '7 天'},
  {value: '30d', label: '30 天'},
]
const breakdownSortOptions: Array<{key: BreakdownSortKey; label: string}> = [
  {key: 'input', label: '输入'},
  {key: 'cache', label: '缓存'},
  {key: 'output', label: '输出'},
  {key: 'requests', label: '次数'},
  {key: 'total', label: '总计'},
]

const props = withDefaults(defineProps<{active?: boolean}>(), {active: true})
const snapshot = ref<DashboardSnapshot | null>(null)
const selectedService = ref('')
const selectedModel = ref('')
const range = ref<Range>('30d')
const loading = ref(false)
const errorMessage = ref('')
const showAllBreakdown = ref(false)
const breakdownSort = ref<BreakdownSortKey>('total')
const requestPurpose = ref<RequestPurposeFilter>('')
const requestOutcome = ref<RequestOutcomeFilter>('')
const requestCacheStatus = ref<RequestCacheFilter>('')
const requestLogItems = ref<StoredModelUsageEvent[]>([])
const requestLogNextCursor = ref<ModelUsageRequestCursor | null>(null)
const requestLogTotalCount = ref(0)
const requestLogLoading = ref(false)
const requestLogError = ref('')
const exporting = ref(false)
const importing = ref(false)
const transferMessage = ref('')
const transferMessageIsError = ref(false)
const importDialogOpen = ref(false)
const pendingImportDocument = ref<ModelUsageTransferDocument | null>(null)
const pendingImportFileName = ref('')
const importFileInput = ref<HTMLInputElement | null>(null)
const resetDialogOpen = ref(false)
const resetting = ref(false)
const resetError = ref('')
const rangeControl = ref<HTMLElement | null>(null)
const resetDialog = ref<HTMLElement | null>(null)
const resetCancelButton = ref<HTMLButtonElement | null>(null)
const resetButton = ref<HTMLButtonElement | null>(null)
let dashboardRevision = 0
let requestLogRevision = 0
let mounted = false

const selectedTotals = computed<Totals>(() => snapshot.value!.selected.totals)
const appliedFilter = computed<Filter>(() => snapshot.value?.selected.filter || {range: range.value})
const appliedRangeLabel = computed(() => (
  rangeOptions.find(option => option.value === appliedFilter.value.range)?.label || '30 天'
))
const serviceOptions = computed(() => (snapshot.value?.dimensions || []).map(dimension => ({
  id: dimension.serviceId,
  label: serviceLabel(dimension.serviceId),
})))
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
  return successful > 0 ? formatUsageRate(selectedTotals.value.reportedTokenRequests / successful) : '0%'
})
const visibleBreakdown = computed(() => {
  const rows = [...(snapshot.value?.breakdown || [])].sort((left, right) => {
    const value = (totals: Totals) => breakdownSort.value === 'input'
      ? totals.inputTokens
      : breakdownSort.value === 'cache'
        ? totals.cachedInputTokens
        : breakdownSort.value === 'output'
          ? totals.outputTokens
          : breakdownSort.value === 'requests'
            ? totals.requestCount
            : totals.totalTokens
    return value(right.totals) - value(left.totals)
      || right.totals.totalTokens - left.totals.totalTokens
      || right.totals.inputTokens - left.totals.inputTokens
      || right.totals.outputTokens - left.totals.outputTokens
      || right.totals.requestCount - left.totals.requestCount
      || left.serviceId.localeCompare(right.serviceId)
      || left.model.localeCompare(right.model)
  })
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
const pendingImportRangeLabel = computed(() => {
  const timestamps = (pendingImportDocument.value?.events || [])
    .map(event => event.startedAt)
    .filter(timestamp => typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp >= 0)
    .sort((left, right) => left - right)
  if (!timestamps.length) return '无记录'
  return `${rangeDateFormatter.format(timestamps[0])} — ${rangeDateFormatter.format(timestamps.at(-1)!)}`
})

function serviceLabel(serviceId: string): string {
  return options.services.find(option => option.value === serviceId)?.label || serviceId || '未知服务'
}

function modelLabel(model: string): string {
  return model === 'unknown' ? '未知模型' : model
}

function formatNumber(value: number): string {
  return numberFormatter.format(Number.isFinite(value) && value > 0 ? value : 0)
}

function formatToken(value: number): string {
  return formatTokenCount(value).compact
}

function tokenExactTitle(value: number): string {
  return `完整数值：${formatTokenCount(value).exact} Token`
}

function tokenAriaLabel(value: number): string {
  return `${formatTokenCount(value).exact} Token`
}

function formatAverageValue(value: number | null): string {
  return value === null ? '—' : formatToken(Math.round(value))
}

function averageTokenTitle(value: number | null): string {
  return value === null ? '没有可计算的 Token 明细' : tokenExactTitle(Math.round(value))
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(timestamp)
}

function formatRequestTime(timestamp: number): string {
  return requestDateFormatter.format(timestamp)
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '—'
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`
  if (durationMs < 60_000) return `${new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 2}).format(durationMs / 1_000)} 秒`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.round((durationMs % 60_000) / 1_000)
  return `${minutes} 分 ${seconds} 秒`
}

function purposeLabel(purpose: ModelUsagePurpose): string {
  return purpose === 'page-summary' ? '页面摘要' : purpose === 'connection-test' ? '连接测试' : '翻译'
}

function outcomeLabel(outcome: ModelUsageOutcome): string {
  return outcome === 'success' ? '成功' : outcome === 'timeout' ? '超时' : outcome === 'cancelled' ? '已取消' : '错误'
}

function usageAvailabilityLabel(availability: StoredModelUsageEvent['usageAvailability']): string {
  return availability === 'malformed' ? '服务商 Token 明细格式异常' : '服务商未返回 Token 明细'
}

function isCacheHit(item: StoredModelUsageEvent): boolean {
  return typeof item.cachedInputTokens === 'number' && item.cachedInputTokens > 0
}

function requestCacheRate(item: StoredModelUsageEvent): number | null {
  if (item.cachedInputTokens === undefined || !item.inputTokens) return null
  return item.cachedInputTokens / item.inputTokens
}

function requestCacheValue(item: StoredModelUsageEvent): string {
  if (item.cachedInputTokens === undefined) return '未上报'
  return `${formatToken(item.cachedInputTokens)} · ${formatUsageRate(requestCacheRate(item))}`
}

function requestCacheTitle(item: StoredModelUsageEvent): string {
  if (item.cachedInputTokens === undefined) return '服务商未返回缓存读取明细'
  return `${tokenExactTitle(item.cachedInputTokens)}；输入 Token 命中率 ${formatUsageRate(requestCacheRate(item))}`
}

function cacheBreakdownTitle(totals: Totals): string {
  if (!totals.cacheReportedRequests) return '服务商未返回缓存读取明细'
  return `${tokenExactTitle(totals.cachedInputTokens)}；Token 命中率 ${formatUsageRate(totals.cacheTokenHitRate)}`
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
  requestPurpose.value = ''
  requestOutcome.value = ''
  requestCacheStatus.value = ''
  showAllBreakdown.value = false
}

function currentFilter(): Filter {
  return {
    range: range.value,
    ...(selectedService.value ? {serviceId: selectedService.value} : {}),
    ...(selectedModel.value ? {model: selectedModel.value} : {}),
  }
}

async function loadSnapshot(): Promise<void> {
  const revision = ++dashboardRevision
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await browser.runtime.sendMessage({
      type: 'modelUsage',
      action: 'query',
      filter: currentFilter(),
    }) as ModelUsageResponse<DashboardSnapshot>
    if (revision !== dashboardRevision) return
    if (response?.success !== true || !response.data) {
      throw new Error(response?.error || '后台没有返回可用的统计快照')
    }
    snapshot.value = response.data
    if (response.data.selected.totals.requestCount > 0) void loadRequestLog(true)
    else {
      requestLogItems.value = []
      requestLogNextCursor.value = null
      requestLogTotalCount.value = 0
    }
  } catch (error) {
    if (revision !== dashboardRevision) return
    errorMessage.value = error instanceof Error ? error.message : '未知错误'
  } finally {
    if (revision === dashboardRevision) loading.value = false
  }
}

async function loadRequestLog(reset: boolean): Promise<void> {
  if (!props.active) return
  const revision = ++requestLogRevision
  if (reset) {
    requestLogItems.value = []
    requestLogNextCursor.value = null
  }
  requestLogLoading.value = true
  requestLogError.value = ''
  try {
    const response = await browser.runtime.sendMessage({
      type: 'modelUsage',
      action: 'list',
      query: {
        filter: {
          ...currentFilter(),
          ...(requestPurpose.value ? {purpose: requestPurpose.value} : {}),
          ...(requestOutcome.value ? {outcome: requestOutcome.value} : {}),
          ...(requestCacheStatus.value ? {cacheStatus: requestCacheStatus.value} : {}),
        },
        ...(!reset && requestLogNextCursor.value ? {cursor: requestLogNextCursor.value} : {}),
        limit: MODEL_USAGE_REQUEST_PAGE_SIZE,
      },
    }) as ModelUsageResponse<ModelUsageRequestPage>
    if (revision !== requestLogRevision) return
    if (response?.success !== true || !response.data) {
      throw new Error(response?.error || '后台没有返回请求记录')
    }
    const knownIds = new Set(reset ? [] : requestLogItems.value.map(item => item.id))
    const incoming = response.data.items.filter(item => !knownIds.has(item.id))
    requestLogItems.value = reset ? incoming : [...requestLogItems.value, ...incoming]
    requestLogNextCursor.value = response.data.nextCursor
    requestLogTotalCount.value = response.data.totalCount
  } catch (error) {
    if (revision !== requestLogRevision) return
    requestLogError.value = error instanceof Error ? error.message : '读取请求记录失败'
  } finally {
    if (revision === requestLogRevision) requestLogLoading.value = false
  }
}

async function exportUsageData(): Promise<void> {
  if (exporting.value) return
  exporting.value = true
  transferMessage.value = ''
  try {
    const response = await browser.runtime.sendMessage({type: 'modelUsage', action: 'export'}) as ModelUsageResponse<ModelUsageTransferDocument>
    if (response?.success !== true || !response.data) throw new Error(response?.error || '后台没有返回导出数据')
    const serialized = JSON.stringify(response.data, null, 2)
    const url = URL.createObjectURL(new Blob([serialized], {type: 'application/json'}))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `FluentRead-model-usage-${new Date().toISOString().slice(0, 10)}.json`
    anchor.style.display = 'none'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    transferMessageIsError.value = false
    transferMessage.value = `已导出 ${formatNumber(response.data.events.length)} 条脱敏请求记录。`
  } catch (error) {
    transferMessageIsError.value = true
    transferMessage.value = `导出失败：${error instanceof Error ? error.message : '未知错误'}`
  } finally {
    exporting.value = false
  }
}

function openImportPicker(): void {
  transferMessage.value = ''
  if (importFileInput.value) importFileInput.value.value = ''
  importFileInput.value?.click()
}

function parseImportPreview(value: unknown): ModelUsageTransferDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('文件内容必须是 JSON 对象')
  const document = value as Partial<ModelUsageTransferDocument>
  if (document.format !== MODEL_USAGE_TRANSFER_FORMAT || document.version !== MODEL_USAGE_TRANSFER_VERSION) {
    throw new Error('这不是受支持的 FluentRead 模型用量文件')
  }
  if (!Array.isArray(document.events)) throw new Error('文件缺少请求记录数组')
  return document as ModelUsageTransferDocument
}

async function handleImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  transferMessage.value = ''
  try {
    if (file.size > MODEL_USAGE_TRANSFER_MAX_BYTES) throw new Error('文件超过 128 MiB 上限')
    pendingImportDocument.value = parseImportPreview(JSON.parse(await file.text()))
    pendingImportFileName.value = file.name
    importDialogOpen.value = true
  } catch (error) {
    transferMessageIsError.value = true
    transferMessage.value = `无法读取导入文件：${error instanceof Error ? error.message : '未知错误'}`
  } finally {
    input.value = ''
  }
}

function clearPendingImport(): void {
  if (importing.value) return
  pendingImportDocument.value = null
  pendingImportFileName.value = ''
}

async function confirmImport(): Promise<void> {
  if (!pendingImportDocument.value || importing.value) return
  importing.value = true
  transferMessage.value = ''
  try {
    const response = await browser.runtime.sendMessage({
      type: 'modelUsage',
      action: 'import',
      document: pendingImportDocument.value,
    }) as ModelUsageResponse<ModelUsageImportResult>
    if (response?.success !== true || !response.data) throw new Error(response?.error || '后台没有确认导入结果')
    importDialogOpen.value = false
    transferMessageIsError.value = false
    transferMessage.value = `导入完成：新增 ${formatNumber(response.data.importedCount)} 条，跳过 ${formatNumber(response.data.duplicateCount)} 条重复记录。`
    await loadSnapshot()
  } catch (error) {
    transferMessageIsError.value = true
    transferMessage.value = `导入失败：${error instanceof Error ? error.message : '未知错误'}`
  } finally {
    importing.value = false
    if (!importDialogOpen.value) clearPendingImport()
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
    const response = await browser.runtime.sendMessage({type: 'modelUsage', action: 'reset'}) as ModelUsageResponse<{cleared?: boolean}>
    if (response?.success !== true) throw new Error(response?.error || '后台没有确认清除结果')
    resetDialogOpen.value = false
    setSettingsBackgroundInert(false)
    transferMessageIsError.value = false
    transferMessage.value = '模型用量请求记录及汇总已清除。'
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

watch([requestPurpose, requestOutcome, requestCacheStatus], () => {
  if (!mounted || !props.active || !snapshot.value) return
  void loadRequestLog(true)
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
  dashboardRevision += 1
  requestLogRevision += 1
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  setSettingsBackgroundInert(false)
})
</script>

<style scoped src="./model-usage-dashboard.css"></style>
