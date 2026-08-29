<!--
@file src/features/settings/ui/ConfigManagement.vue
文件职责：提供配置管理页面的完整用户界面，让用户查看最近修改和定时备份，并通过统一 JSON 对话框复制导出或预览导入。
主要内容：渲染凭据持久化开关、两类十份版本列表、仅含导出与导入的迁移入口、完整配置复制与差异确认对话框，并在导入预览中隐藏专用 API 凭据的实际内容。
模块边界：本组件只负责交互状态和展示，通过 core/config 生成包含凭据的用户主动导出内容，并通过 services/config 公共 API 读取或提交配置；快照保留、并发控制和浏览器存储不在 Vue 层实现。
-->
<template>
  <section class="config-management">
    <SettingsGroup title="凭据安全" description="API 凭据默认只保留在当前浏览器会话。">
      <SettingsItem
        label="跨浏览器重启保存 API 凭据"
        description="开启后会以明文写入扩展本地存储，仅建议在受信任的个人设备上使用。"
      >
        <el-switch
          :model-value="props.config.persistCredentials"
          :loading="credentialPersistenceBusy"
          aria-label="跨浏览器重启保存 API 凭据"
          data-testid="persist-credentials-switch"
          @change="setCredentialPersistence"
        />
      </SettingsItem>
    </SettingsGroup>

    <div class="version-grid">
      <section class="version-panel" aria-labelledby="recent-config-title">
        <header class="version-panel-heading">
          <div>
            <h2 id="recent-config-title">最近修改</h2>
            <p>有效配置变化会自动记录，最多保留 10 份。</p>
          </div>
          <span>{{ historyEntries.length }}/10</span>
        </header>
        <div v-if="historyEntries.length" class="version-list">
          <button
            v-for="entry in historyEntries"
            :key="entry.version"
            type="button"
            class="version-entry"
            :class="{ current: entry.version === currentHistoryVersion }"
            :aria-label="`查看最近修改 v${entry.version}，${snapshotSummary(entry.config)}，${formatTime(entry.savedAt)}`"
            @click="openHistoryPreview(entry)"
          >
            <span class="version-badge">v{{ entry.version }}</span>
            <span class="version-copy">
              <strong>{{ snapshotSummary(entry.config) }}</strong>
              <small>{{ formatTime(entry.savedAt) }}</small>
            </span>
            <span v-if="entry.version === currentHistoryVersion" class="current-mark">当前</span>
            <span v-else class="view-link">查看</span>
          </button>
        </div>
        <div v-else class="version-empty">修改设置后会在这里生成版本。</div>
      </section>

      <section class="version-panel" aria-labelledby="automatic-backup-title">
        <header class="version-panel-heading">
          <div>
            <h2 id="automatic-backup-title">定时备份</h2>
            <p>后台每 6 小时备份一次，最多保留 10 份（约 2.5 天）。</p>
          </div>
          <span>{{ backupEntries.length }}/10</span>
        </header>
        <div v-if="backupEntries.length" class="version-list">
          <button
            v-for="entry in backupEntries"
            :key="entry.version"
            type="button"
            class="version-entry"
            :aria-label="`查看定时备份 b${entry.version}，${snapshotSummary(entry.config)}，${formatTime(entry.savedAt)}`"
            @click="openBackupPreview(entry)"
          >
            <span class="version-badge backup">b{{ entry.version }}</span>
            <span class="version-copy">
              <strong>{{ snapshotSummary(entry.config) }}</strong>
              <small>{{ formatTime(entry.savedAt) }}</small>
            </span>
            <span class="view-link">查看</span>
          </button>
        </div>
        <div v-else class="version-empty">首次启动后台后会建立一份基线备份。</div>
      </section>
    </div>

    <SettingsGroup title="导入与导出" description="导出内容包含当前全部用户配置和 API 凭据，请仅复制到可信位置。">
      <div class="transfer-row">
        <div class="transfer-copy">
          <strong>当前配置 JSON</strong>
          <small>导入会先显示与当前配置的差异，确认后才会应用。</small>
        </div>
        <div class="transfer-actions">
          <el-button @click="openExportDialog"><CopyDocument />导出配置</el-button>
          <el-button type="primary" @click="openImportDialog"><Upload />导入配置</el-button>
        </div>
      </div>
      <p class="transfer-warning">导出会显示 API Key、Secret、提示词、自定义模型、请求体、代理与网站规则等完整配置。</p>
    </SettingsGroup>

    <el-dialog
      v-model="transferDialogVisible"
      :title="transferDialogTitle"
      width="min(680px, calc(100vw - 32px))"
      data-testid="config-transfer-dialog"
    >
      <el-input
        v-model="transferJson"
        type="textarea"
        :rows="12"
        :readonly="transferDialogMode === 'export'"
        :placeholder="transferDialogMode === 'export' ? '' : '粘贴 FluentRead 配置 JSON'"
        aria-label="配置 JSON"
      />
      <template #footer>
        <el-button @click="transferDialogVisible = false">取消</el-button>
        <el-button
          v-if="transferDialogMode === 'export'"
          type="primary"
          :disabled="!transferJson"
          @click="copyExportedConfig"
        >复制</el-button>
        <el-button
          v-else
          type="primary"
          :disabled="!transferJson.trim()"
          @click="previewImportedConfig"
        >查看差异</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="previewVisible"
      class="config-preview-dialog"
      :title="previewTitle"
      width="min(880px, calc(100vw - 32px))"
      destroy-on-close
      @closed="clearPreview"
    >
      <template v-if="previewTarget">
        <div class="preview-summary">
          <div>
            <span>{{ previewSourceLabel }}</span>
            <strong>{{ formatTime(previewTarget.savedAt) }}</strong>
          </div>
          <b :class="{ empty: previewChangeCount === 0 }">
            {{ previewChangeCount ? `${previewChangeCount} 项不同` : '与当前相同' }}
          </b>
        </div>

        <div v-if="previewDiff.groups.length || previewCredentialChanges.length" class="diff-groups">
          <section v-for="group in previewDiff.groups" :key="group.id" class="diff-group">
            <h3>{{ group.label }}<span>{{ group.changes.length }}</span></h3>
            <div class="diff-list">
              <article v-for="change in group.changes" :key="change.key" class="diff-item">
                <strong>{{ change.label }}</strong>
                <div><span>当前</span><p>{{ change.before }}</p></div>
                <div><span>此版本</span><p>{{ change.after }}</p></div>
              </article>
            </div>
          </section>
          <section v-if="previewCredentialChanges.length" class="diff-group">
            <h3>凭据安全<span>{{ previewCredentialChanges.length }}</span></h3>
            <div class="diff-list">
              <article v-for="change in previewCredentialChanges" :key="change.key" class="diff-item">
                <strong>{{ change.label }}</strong>
                <div><span>当前</span><p>{{ change.before }}</p></div>
                <div><span>导入后</span><p>{{ change.after }}</p></div>
              </article>
            </div>
          </section>
        </div>
        <div v-else class="diff-empty">这份配置与当前可恢复配置完全相同。</div>

        <details class="json-details">
          <summary>查看完整配置 JSON</summary>
          <pre>{{ previewJson }}</pre>
        </details>
        <p class="restore-boundary">{{ previewBoundary }}</p>
      </template>
      <template #footer>
        <el-button @click="previewVisible = false">关闭</el-button>
        <el-button
          type="primary"
          :loading="applyBusy"
          :disabled="!previewTarget || previewChangeCount === 0"
          @click="applyPreviewTarget"
        >{{ previewActionLabel }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import {computed, onUnmounted, ref} from 'vue';
import {CopyDocument, Upload} from '@element-plus/icons-vue';
import {ElMessage, ElMessageBox} from 'element-plus';
import browser from 'webextension-polyfill';
import {options} from '@/src/core/config/catalog';
import {extractConfigCredentials} from '@/src/core/config/credentials';
import {buildConfigDiff} from '@/src/core/config/diff';
import {normalizeConfig, type Config} from '@/src/core/config/model';
import {isConfigImportValid, prepareConfigForExport, prepareConfigForImport} from '@/src/core/config/transfer';
import {
  configAutoBackupsReady,
  configHistoryReady,
  getConfigAutoBackupsSnapshot,
  getConfigHistorySnapshot,
  requestConfigAutoBackupRestore,
  requestConfigHistoryAction,
  requestConfigSave,
  subscribeConfigAutoBackups,
  subscribeConfigHistory,
  type ConfigAutoBackupEntry,
  type ConfigAutoBackupState,
  type ConfigHistoryEntry,
  type ConfigHistoryState,
} from '@/src/services/config';
import {toRestorableConfig} from '@/src/services/config/history';
import SettingsGroup from './components/SettingsGroup.vue';
import SettingsItem from './components/SettingsItem.vue';

const props = defineProps<{config: Config}>();
const sendRuntimeMessage = browser.runtime.sendMessage.bind(browser.runtime);

const configHistory = ref<ConfigHistoryState>(getConfigHistorySnapshot());
const configBackups = ref<ConfigAutoBackupState>(getConfigAutoBackupsSnapshot());
const historyEntries = computed(() => [...configHistory.value.entries].reverse());
const backupEntries = computed(() => [...configBackups.value.entries].reverse());
const currentHistoryVersion = computed(() => configHistory.value.entries[configHistory.value.cursor]?.version ?? null);

void configHistoryReady.then(() => { configHistory.value = getConfigHistorySnapshot(); });
void configAutoBackupsReady.then(() => { configBackups.value = getConfigAutoBackupsSnapshot(); });
const unsubscribeHistory = subscribeConfigHistory((history) => { configHistory.value = history; });
const unsubscribeBackups = subscribeConfigAutoBackups((backups) => { configBackups.value = backups; });
onUnmounted(() => {
  unsubscribeHistory();
  unsubscribeBackups();
});

function formatTime(savedAt: string): string {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function snapshotSummary(value: ConfigHistoryEntry['config'] | ConfigAutoBackupEntry['config']): string {
  const target = options.to.find((item: any) => item.value === value.to)?.label || value.to;
  const service = options.services.find((item: any) => item.value === value.service)?.label || value.service;
  const rules = (value.alwaysTranslateDomains?.length || 0) + (value.disabledExtensionDomains?.length || 0);
  return `${target} · ${service} · ${rules} 条网站规则`;
}

type PreviewKind = 'history' | 'backup' | 'import';
interface PreviewTarget {
  kind: PreviewKind;
  version?: number;
  label: string;
  savedAt: string;
  config: unknown;
}

const previewTarget = ref<PreviewTarget | null>(null);
const previewVisible = ref(false);
const applyBusy = ref(false);
const resolvedPreviewConfig = computed(() => {
  const target = previewTarget.value;
  if (!target) return undefined;
  return target.kind === 'import'
    ? prepareConfigForImport(target.config, props.config)
    : target.config;
});
const previewDiff = computed(() => buildConfigDiff(
  toRestorableConfig(props.config),
  toRestorableConfig(resolvedPreviewConfig.value),
));
interface CredentialPreviewChange {
  key: string;
  label: string;
  before: string;
  after: string;
}

const scalarCredentialLabels = {
  ak: 'Access Key',
  sk: 'Secret Key',
  appid: '旧版 App ID',
  key: '旧版服务 Key',
  youdaoAppKey: '有道 AppKey',
  youdaoAppSecret: '有道 AppSecret',
  tencentSecretId: '腾讯云 SecretId',
  tencentSecretKey: '腾讯云 SecretKey',
} as const;

function isCredentialConfigured(value: unknown): boolean {
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return value !== null && value !== undefined && value !== false;
}

function credentialChange(
  key: string,
  label: string,
  before: unknown,
  after: unknown,
): CredentialPreviewChange | null {
  if (JSON.stringify(before ?? '') === JSON.stringify(after ?? '')) return null;
  const hadValue = isCredentialConfigured(before);
  const hasValue = isCredentialConfigured(after);
  if (!hadValue && !hasValue) return null;
  return {
    key,
    label,
    before: hadValue ? '已配置（内容已隐藏）' : '未设置',
    after: hasValue
      ? hadValue ? '将替换（内容已隐藏）' : '将新增（内容已隐藏）'
      : '将清除',
  };
}

const previewCredentialChanges = computed(() => {
  if (previewTarget.value?.kind !== 'import') return [];
  const before = extractConfigCredentials(props.config);
  const after = extractConfigCredentials(resolvedPreviewConfig.value);
  const changes: CredentialPreviewChange[] = [];

  for (const service of new Set([...Object.keys(before.token), ...Object.keys(after.token)])) {
    const serviceLabel = options.services.find((item: any) => item.value === service)?.label || service;
    const change = credentialChange(`token.${service}`, `${serviceLabel} API Key`, before.token[service], after.token[service]);
    if (change) changes.push(change);
  }
  for (const field of Object.keys(scalarCredentialLabels) as Array<keyof typeof scalarCredentialLabels>) {
    const change = credentialChange(field, scalarCredentialLabels[field], before[field], after[field]);
    if (change) changes.push(change);
  }
  for (const key of new Set([...Object.keys(before.extra), ...Object.keys(after.extra)])) {
    const change = credentialChange(`extra.${key}`, `${key} 扩展凭据`, before.extra[key], after.extra[key]);
    if (change) changes.push(change);
  }
  return changes;
});
const previewChangeCount = computed(() => previewDiff.value.changeCount + previewCredentialChanges.value.length);
const previewJson = computed(() => JSON.stringify(toRestorableConfig(resolvedPreviewConfig.value), null, 2));
const previewTitle = computed(() => previewTarget.value?.kind === 'import' ? '导入前查看差异' : '配置版本详情');
const previewSourceLabel = computed(() => previewTarget.value?.kind === 'history'
  ? `最近修改 ${previewTarget.value.label}`
  : previewTarget.value?.kind === 'backup'
    ? `定时备份 ${previewTarget.value.label}`
    : previewTarget.value?.label || '导入配置');
const previewActionLabel = computed(() => previewTarget.value?.kind === 'import' ? '确认导入' : '恢复此版本');
const previewBoundary = computed(() => previewTarget.value?.kind === 'import'
  ? previewCredentialChanges.value.length
    ? '这是包含服务凭据的旧版配置；上方逐项标出新增、替换或清除，内容始终隐藏。确认后仅更新文件明确提供的字段，其他凭据继续保留。“跨重启保存凭据”开关仍保持当前选择。'
    : '导入文件不含服务凭据，将保留当前会话中的凭据；翻译次数和“跨重启保存凭据”开关也不会改变。'
  : 'API 凭据、翻译次数和“跨重启保存凭据”开关不会随版本恢复。');

function showPreview(target: PreviewTarget) {
  previewTarget.value = target;
  previewVisible.value = true;
}

function openHistoryPreview(entry: ConfigHistoryEntry) {
  showPreview({kind: 'history', version: entry.version, label: `v${entry.version}`, savedAt: entry.savedAt, config: entry.config});
}

function openBackupPreview(entry: ConfigAutoBackupEntry) {
  showPreview({kind: 'backup', version: entry.version, label: `b${entry.version}`, savedAt: entry.savedAt, config: entry.config});
}

function clearPreview() {
  previewTarget.value = null;
  applyBusy.value = false;
}

async function applyPreviewTarget() {
  const target = previewTarget.value;
  if (!target || previewChangeCount.value === 0 || applyBusy.value) return;
  try {
    await ElMessageBox.confirm(
      target.kind === 'import'
        ? `将应用 ${previewChangeCount.value} 项配置变化，是否继续？`
        : `将恢复 ${target.label}，并生成一份新的最近修改记录。是否继续？`,
      target.kind === 'import' ? '确认导入配置' : '确认恢复配置',
      {confirmButtonText: target.kind === 'import' ? '导入' : '恢复', cancelButtonText: '取消', type: 'warning'},
    );
  } catch {
    return;
  }

  applyBusy.value = true;
  try {
    if (target.kind === 'history') {
      configHistory.value = await requestConfigHistoryAction('restore', target.version, sendRuntimeMessage);
    } else if (target.kind === 'backup') {
      const result = await requestConfigAutoBackupRestore(target.version!, sendRuntimeMessage);
      configBackups.value = result.backups;
      configHistory.value = result.history;
    } else {
      await requestConfigSave(resolvedPreviewConfig.value, sendRuntimeMessage);
    }
    previewVisible.value = false;
    ElMessage.success(target.kind === 'import' ? '配置已导入' : '配置已恢复');
  } catch (error) {
    ElMessage.error(`${target.kind === 'import' ? '导入' : '恢复'}失败：${error instanceof Error ? error.message : '请稍后重试'}`);
  } finally {
    applyBusy.value = false;
  }
}

const credentialPersistenceBusy = ref(false);
async function setCredentialPersistence(value: string | number | boolean) {
  const enabled = value === true;
  if (enabled === props.config.persistCredentials || credentialPersistenceBusy.value) return;
  if (enabled) {
    try {
      await ElMessageBox.confirm(
        '开启后，API Key、访问令牌及其他服务凭据会以明文写入扩展本地存储，并在浏览器重启后继续保留。',
        '保存 API 凭据',
        {confirmButtonText: '了解风险并开启', cancelButtonText: '取消', type: 'warning'},
      );
    } catch {
      return;
    }
  }

  credentialPersistenceBusy.value = true;
  try {
    await requestConfigSave(normalizeConfig({...props.config, persistCredentials: enabled}), sendRuntimeMessage);
    ElMessage.success(enabled ? '已允许跨浏览器重启保存 API 凭据' : 'API 凭据现仅保存在当前浏览器会话');
  } catch (error) {
    ElMessage.error(`凭据存储设置失败：${error instanceof Error ? error.message : '请稍后重试'}`);
  } finally {
    credentialPersistenceBusy.value = false;
  }
}

function exportedJson(): string {
  return JSON.stringify(prepareConfigForExport(props.config), null, 2);
}

type TransferDialogMode = 'export' | 'import';
const transferDialogMode = ref<TransferDialogMode>('export');
const transferDialogVisible = ref(false);
const transferJson = ref('');
const transferDialogTitle = computed(() => transferDialogMode.value === 'export'
  ? '导出配置 JSON'
  : '粘贴配置 JSON');

function openExportDialog() {
  transferDialogMode.value = 'export';
  transferJson.value = exportedJson();
  transferDialogVisible.value = true;
}

function openImportDialog() {
  transferDialogMode.value = 'import';
  transferJson.value = '';
  transferDialogVisible.value = true;
}

async function copyExportedConfig() {
  try {
    await navigator.clipboard.writeText(transferJson.value);
    ElMessage.success('配置 JSON 已复制');
  } catch (error) {
    ElMessage.error(`复制失败：${error instanceof Error ? error.message : '请检查剪贴板权限'}`);
  }
}

function prepareImportPreview(text: string, label: string) {
  const parsed = JSON.parse(text) as unknown;
  if (!isConfigImportValid(parsed)) throw new Error('配置无效或格式不正确');
  showPreview({kind: 'import', label, savedAt: new Date().toISOString(), config: parsed});
}

function previewImportedConfig() {
  try {
    prepareImportPreview(transferJson.value, '粘贴的 JSON');
    transferDialogVisible.value = false;
  } catch (error) {
    ElMessage.error(`无法读取配置：${error instanceof Error ? error.message : 'JSON 格式错误'}`);
  }
}
</script>

<style scoped>
.config-management { width: 100%; }
.version-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; width: min(100%, 1080px); margin: 0 auto 22px; }
.version-panel { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 16px; background: var(--surface); box-shadow: 0 7px 22px rgba(31, 40, 61, .035); }
.version-panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; padding: 16px; border-bottom: 1px solid var(--line); }
.version-panel-heading h2 { margin: 0; color: var(--ink); font-size: 15px; }
.version-panel-heading p { margin: 4px 0 0; color: var(--muted); font-size: 10.5px; line-height: 1.5; }
.version-panel-heading > span { flex: none; padding: 4px 8px; border-radius: 999px; color: var(--brand-strong); background: var(--brand-soft); font-size: 10px; font-weight: 750; }
.version-list { max-height: 360px; overflow-y: auto; }
.version-entry { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; min-height: 58px; padding: 9px 12px; border: 0; border-bottom: 1px solid var(--line); color: inherit; background: transparent; text-align: left; cursor: pointer; }
.version-entry:last-child { border-bottom: 0; }
.version-entry:hover { background: var(--surface-soft); }
.version-entry.current { background: var(--brand-soft); }
.version-badge { display: grid; place-items: center; min-height: 28px; border-radius: 9px; color: var(--brand-strong); background: var(--brand-soft); font-size: 10px; font-weight: 800; }
.version-badge.backup { color: #267260; background: #eaf8f4; }
.version-copy { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.version-copy strong { overflow: hidden; color: var(--ink); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.version-copy small { color: var(--muted); font-size: 9.5px; }
.view-link, .current-mark { color: var(--brand-strong); font-size: 10px; font-weight: 750; }
.current-mark { padding: 3px 7px; border-radius: 999px; background: var(--brand-soft); }
.version-empty { padding: 28px 16px; color: var(--muted); font-size: 11px; text-align: center; }
.transfer-row { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 15px 16px; }
.transfer-copy { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
.transfer-copy strong { color: var(--ink); font-size: 12.5px; }
.transfer-copy small, .transfer-warning { color: var(--muted); font-size: 10.5px; line-height: 1.55; }
.transfer-actions { display: flex; flex: none; align-items: center; gap: 7px; }
.transfer-actions :deep(.el-button) { margin-left: 0; }
.transfer-actions :deep(svg) { width: 14px; margin-right: 5px; }
.transfer-warning { margin: 0; padding: 0 16px 14px; }
.preview-summary { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 13px 14px; border: 1px solid var(--line); border-radius: 13px; background: var(--surface-soft); }
.preview-summary > div { display: flex; flex-direction: column; gap: 3px; }
.preview-summary span { color: var(--muted); font-size: 10px; }
.preview-summary strong { color: var(--ink); font-size: 12px; }
.preview-summary b { padding: 5px 9px; border-radius: 999px; color: var(--brand-strong); background: var(--brand-soft); font-size: 10px; }
.preview-summary b.empty { color: #267260; background: #eaf8f4; }
.diff-groups { display: grid; gap: 14px; max-height: 48vh; margin-top: 16px; padding-right: 4px; overflow-y: auto; }
.diff-group h3 { display: flex; align-items: center; gap: 7px; margin: 0 0 7px; color: var(--ink); font-size: 12px; }
.diff-group h3 span { display: grid; place-items: center; min-width: 20px; height: 20px; border-radius: 999px; color: var(--brand-strong); background: var(--brand-soft); font-size: 9px; }
.diff-list { overflow: hidden; border: 1px solid var(--line); border-radius: 12px; }
.diff-item { display: grid; grid-template-columns: minmax(130px, .65fr) repeat(2, minmax(0, 1fr)); gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.diff-item:last-child { border-bottom: 0; }
.diff-item > strong { align-self: center; color: var(--ink); font-size: 10.5px; }
.diff-item div { min-width: 0; }
.diff-item span { color: var(--muted); font-size: 9px; }
.diff-item p { margin: 3px 0 0; overflow-wrap: anywhere; color: var(--muted); font-size: 10px; line-height: 1.45; }
.diff-empty { margin-top: 16px; padding: 28px; border: 1px dashed var(--line); border-radius: 12px; color: var(--muted); font-size: 11px; text-align: center; }
.json-details { margin-top: 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-soft); }
.json-details summary { padding: 11px 13px; color: var(--ink); cursor: pointer; font-size: 10.5px; font-weight: 700; }
.json-details pre { max-height: 280px; margin: 0; padding: 12px; overflow: auto; border-top: 1px solid var(--line); color: var(--muted); background: var(--surface); font-size: 9.5px; line-height: 1.55; white-space: pre-wrap; }
.restore-boundary { margin: 10px 2px 0; color: var(--muted); font-size: 10px; line-height: 1.5; }

@media (max-width: 900px) {
  .version-grid { grid-template-columns: 1fr; }
  .transfer-row { align-items: flex-start; flex-direction: column; }
  .transfer-actions { width: 100%; flex-wrap: wrap; }
}
@media (max-width: 600px) {
  .diff-item { grid-template-columns: minmax(0, 1fr); gap: 6px; }
  .version-entry { grid-template-columns: 40px minmax(0, 1fr) auto; }
}

:global(:root.dark) .version-badge.backup { color: #80d8c2; background: rgba(38, 114, 96, .22); }
:global(:root.dark) .preview-summary b.empty { color: #80d8c2; background: rgba(38, 114, 96, .22); }
</style>
