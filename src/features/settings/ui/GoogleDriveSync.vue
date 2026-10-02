<!--
@file src/features/settings/ui/GoogleDriveSync.vue
文件职责：提供 Google Drive 完整配置同步入口和用户确认预览。
主要内容：连接账号、输入临时口令、选择方向、逐项处理隐藏内容的冲突与失败提示。
模块边界：页面不获取完整同步快照或令牌；关闭预览或离开页面会清空口令。
-->
<template>
  <section class="drive-sync" data-testid="google-drive-sync" aria-labelledby="drive-sync-title" :aria-busy="busy">
    <header class="drive-heading">
      <div><h2 id="drive-sync-title">Google Drive 配置同步</h2><p>把完整配置加密保存到自己的 Google 云盘，在其他设备恢复。</p></div>
      <span class="drive-badge">本机加密</span>
    </header>
    <p class="drive-boundary">包含 API Key、OAuth Token、鉴权请求头、自定义请求体及 URL 中的鉴权参数。仅同步配置，不包含单词本、聊天记录和用量统计。</p>
    <p class="drive-status" role="status">{{ statusText }}</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="drive-error" />
    <div v-if="status?.available" class="drive-actions">
      <el-button v-if="!status.account" type="primary" :loading="busy" data-testid="google-drive-connect" @click="connect">连接 Google 账号</el-button>
      <template v-else>
        <div class="drive-password">
          <label for="drive-passphrase">同步口令</label>
          <el-input id="drive-passphrase" v-model="passphrase" type="password" show-password autocomplete="off" :disabled="busy" placeholder="至少 12 个字符，所有设备使用同一口令" />
          <small>请使用自己独有的长口令并妥善保存。口令不会上传或保存；遗忘后无法解密云端配置。</small>
        </div>
        <div class="drive-buttons">
          <el-button type="primary" :loading="busy" :disabled="passphrase.trim().length < 12" data-testid="google-drive-preview" @click="prepare">预览同步</el-button>
          <el-button :disabled="busy" @click="disconnect">断开连接</el-button>
        </div>
      </template>
    </div>
    <p class="drive-footnote">文件保存在 Google Drive 的隐藏应用数据区。断开连接会清除扩展授权缓存，并保留本机设置与云端文件。</p>
    <el-dialog v-model="previewVisible" title="确认 Google Drive 同步" width="min(900px, calc(100vw - 24px))" :close-on-click-modal="!busy" :close-on-press-escape="!busy" :show-close="!busy" destroy-on-close @closed="clearPreview">
      <template v-if="preview">
        <p class="drive-preview-account">当前账号：{{ preview.account.email }}</p>
        <el-alert v-if="!preview.hasRemote" title="云端还没有同步文件。本次将创建加密的完整配置快照。" type="info" :closable="false" />
        <el-alert v-else-if="!preview.hasBaseline" title="这是本机首次同步此账号，请明确选择同步方向。下载会替换本机的配置及凭据。" type="warning" :closable="false" />
        <div class="drive-direction">
          <span id="drive-direction-label">选择同步方向</span>
          <el-radio-group v-model="direction" aria-labelledby="drive-direction-label" :disabled="busy">
            <el-radio-button value="upload">本机 → 云端</el-radio-button>
            <el-radio-button value="download" :disabled="!preview.hasRemote">云端 → 本机</el-radio-button>
            <el-radio-button value="merge" :disabled="!preview.hasRemote">合并两端</el-radio-button>
          </el-radio-group>
          <p>{{ directionHint }}</p>
        </div>
        <template v-if="preview.changes.length">
          <p>{{ preview.changes.length }} 项差异。私密和自定义内容均已隐藏。</p>
          <div class="drive-differences">
            <article v-for="change in visibleChanges" :key="change.id" class="drive-change">
              <strong>{{ change.label }} <span v-if="change.conflict">需要选择</span></strong>
              <div class="drive-values"><p>本机：{{ change.local }}</p><p>云端：{{ change.remote }}</p></div>
              <el-radio-group v-if="direction === 'merge'" v-model="choices[change.id]" :disabled="busy" :aria-label="`${change.label}，合并选择`">
                <el-radio value="local">保留本机</el-radio><el-radio value="remote">保留云端</el-radio>
              </el-radio-group>
            </article>
          </div>
          <el-pagination v-if="preview.changes.length > 40" v-model:current-page="page" :page-size="40" :total="preview.changes.length" layout="prev, pager, next" />
        </template>
        <p v-else-if="preview.hasRemote">两端配置相同。</p>
        <div v-if="!preview.hasRemote" class="drive-password drive-confirmation">
          <label for="drive-passphrase-confirm">再次输入同步口令</label>
          <el-input id="drive-passphrase-confirm" v-model="confirmation" type="password" autocomplete="off" :disabled="busy" placeholder="确认口令，避免创建无法解密的备份" />
        </div>
        <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
      </template>
      <template #footer>
        <el-button :disabled="busy" @click="previewVisible = false">取消</el-button>
        <el-button type="primary" :loading="busy" :disabled="!canCommit" data-testid="google-drive-confirm" @click="commit">{{ commitLabel }}</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref} from 'vue';
import {ElAlert, ElMessage, ElMessageBox, ElPagination, ElRadio, ElRadioButton, ElRadioGroup} from 'element-plus';
import 'element-plus/es/components/alert/style/css';
import 'element-plus/es/components/pagination/style/css';
import 'element-plus/es/components/radio/style/css';
import 'element-plus/es/components/radio-button/style/css';
import 'element-plus/es/components/radio-group/style/css';
import {googleDriveSyncClient as client} from '@/src/services/config/googleDriveSyncClient';
import type {DriveSyncDirection, DriveSyncPreview, DriveSyncStatus} from '@/src/services/config/googleDriveSync';

const status = ref<DriveSyncStatus | null>(null);
const busy = ref(false);
const error = ref('');
const passphrase = ref('');
const confirmation = ref('');
const preview = ref<DriveSyncPreview | null>(null);
const previewVisible = ref(false);
const direction = ref<DriveSyncDirection | ''>('');
const choices = ref<Record<string, string>>({});
const page = ref(1);
const visibleChanges = computed(() => preview.value?.changes.slice((page.value - 1) * 40, page.value * 40) ?? []);
const statusText = computed(() => !status.value ? '正在检查同步状态…' : !status.value.available ? status.value.reason : !status.value.account ? '尚未连接 Google 账号' : `${status.value.account.email}${status.value.lastSyncedAt ? ` · 上次同步 ${new Date(status.value.lastSyncedAt).toLocaleString()}` : ' · 尚未同步'}`);
const directionHint = computed(() => direction.value === 'upload' ? '本机完整配置及凭据将替换云端快照。' : direction.value === 'download' ? '云端完整配置及凭据将替换本机设置。' : direction.value === 'merge' ? '未冲突的修改已自动选择；请确认每项冲突的保留方向。' : '请先选择同步方向。');
const commitLabel = computed(() => direction.value === 'download' ? '下载并应用' : direction.value === 'merge' ? '合并并同步' : '加密并上传');
const canCommit = computed(() => Boolean(preview.value && direction.value && (preview.value.hasRemote || confirmation.value === passphrase.value) && (direction.value !== 'merge' || preview.value.changes.every(change => choices.value[change.id] === 'local' || choices.value[change.id] === 'remote'))));
let alive = true;
async function perform(operation: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {await operation();} catch (failure) {if (alive) error.value = failure instanceof Error ? failure.message : '同步未完成，请重试。';}
  finally {if (alive) busy.value = false;}
}
async function connect() {await perform(async () => {status.value = await client.connect();});}
async function disconnect() {await perform(async () => {await client.disconnect(); passphrase.value = ''; status.value = await client.status();});}
async function prepare() {
  await perform(async () => {
    const result = await client.prepare(passphrase.value);
    if (!alive) {await client.cancel(); return;}
    preview.value = result;
    choices.value = Object.fromEntries(result.changes.filter(change => change.recommended).map(change => [change.id, change.recommended!]));
    direction.value = !result.hasRemote ? 'upload' : result.hasBaseline ? 'merge' : '';
    confirmation.value = '';
    page.value = 1;
    previewVisible.value = true;
  });
}
async function commit() {
  if (!canCommit.value || !preview.value || !direction.value) return;
  if (direction.value !== 'merge' && preview.value.hasRemote && preview.value.changes.length) {
    try {await ElMessageBox.confirm(directionHint.value, '确认替换完整配置', {confirmButtonText: '确认替换', cancelButtonText: '返回预览', type: 'warning'});} catch {return;}
  }
  await perform(async () => {
    status.value = await client.commit(preview.value!.id, passphrase.value, direction.value as DriveSyncDirection, choices.value);
    previewVisible.value = false;
    ElMessage.success('Google Drive 配置同步完成');
  });
}
function clearPreview() {preview.value = null; passphrase.value = ''; confirmation.value = ''; choices.value = {}; void client.cancel().catch(() => undefined);}
onMounted(() => {void perform(async () => {
  try {status.value = await client.status();}
  catch (failure) {
    status.value = {available: false, reason: 'Google Drive 同步需要 Chrome 扩展后台；当前环境可使用完整数据备份。', account: null, lastSyncedAt: null};
    throw failure;
  }
});});
onUnmounted(() => {alive = false; clearPreview();});
</script>

<style scoped>
.drive-sync {padding: 24px; margin-bottom: 24px; border: 1px solid var(--el-border-color); border-radius: 16px; background: var(--el-bg-color); color: var(--el-text-color-primary);}
.drive-heading {display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;}
.drive-heading h2 {margin: 0; font-size: 19px;}
.drive-heading p, .drive-boundary, .drive-footnote, .drive-password small, .drive-direction p {color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.7;}
.drive-badge {white-space: nowrap; border-radius: 20px; padding: 4px 10px; font-size: 12px; color: var(--el-color-primary); background: var(--el-color-primary-light-9);}
.drive-status, .drive-preview-account {overflow-wrap: anywhere; font-size: 14px;}
.drive-error, .drive-actions {margin-top: 16px;}
.drive-password {display: grid; gap: 8px; max-width: 580px;}
.drive-password label {font-weight: 600; font-size: 14px;}
.drive-buttons {display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px;}
.drive-buttons :deep(.el-button) {margin-left: 0;}
.drive-footnote {margin-bottom: 0;}
.drive-direction {display: grid; gap: 12px; margin-top: 20px;}
.drive-differences {max-height: 42vh; overflow-y: auto; border: 1px solid var(--el-border-color); border-radius: 10px; margin-bottom: 12px;}
.drive-change {padding: 14px; border-bottom: 1px solid var(--el-border-color-lighter);}
.drive-change:last-child {border-bottom: 0;}
.drive-change strong {font-size: 14px;}
.drive-change strong span {font-size: 12px; font-weight: 400; color: var(--el-color-warning); margin-left: 8px;}
.drive-values {display: grid; grid-template-columns: 1fr 1fr; gap: 16px; overflow-wrap: anywhere;}
.drive-values p {font-size: 13px; color: var(--el-text-color-secondary);}
.drive-confirmation {margin: 18px 0;}
@media (max-width: 600px) {.drive-sync {padding: 16px;}.drive-heading {flex-wrap: wrap;}.drive-values {grid-template-columns: 1fr; gap: 0;}.drive-direction :deep(.el-radio-group) {display: flex; flex-wrap: wrap; gap: 6px;}.drive-direction :deep(.el-radio-button__inner) {border: 1px solid var(--el-border-color); border-radius: 6px;}}
</style>
