<!--
 * @file src/features/settings/ui/SitePreferencesSettings.vue
 * 文件职责：用一份按网站组织的名单管理自动翻译、禁用扩展和隐藏悬浮球三种日常偏好。
 * 主要内容：展示全局自动翻译、域名归并提示、搜索筛选、单站编辑、删除撤销与后台确认反馈，解释禁用优先级。
 * 模块边界：复用既有配置数组及异步补丁端口，不创建新配置格式、不读取当前标签页，不宣称尚未确认的保存成功。
 -->
<template>
  <div class="site-preferences rule-workspace" data-setting="site-preferences">
    <section class="rule-card preference-global">
      <div><h3>{{ tr('所有网站自动翻译') }}</h3><p>{{ tr('开启后，未禁用扩展的网站都会自动翻译。下面的始终翻译名单仍会保留。') }}</p></div>
      <el-switch :model-value="settings.autoTranslate" :disabled="saving" :aria-label="tr('所有网站自动翻译')" @update:model-value="commit({autoTranslate: Boolean($event)})" />
    </section>
    <section class="rule-card">
      <header class="rule-heading"><div><h3>{{ tr('网站偏好') }}</h3><p>{{ tr('同一网站的偏好集中在一行。禁用扩展优先，重新启用后会恢复其他偏好。') }}</p></div><span class="rule-badge">{{ rows.length }}</span></header>
      <form class="preference-add" @submit.prevent="addSite">
        <label class="rule-field"><span>{{ tr('域名或完整网址') }}</span><input v-model="input" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://docs.example.com/article" :aria-invalid="Boolean(error)" aria-describedby="site-preference-feedback" @input="error = ''" /></label>
        <label class="rule-field"><span>{{ tr('初始偏好') }}</span><select v-model="initialPreference"><option value="always">{{ tr('始终翻译') }}</option><option value="disabled">{{ tr('禁用扩展') }}</option><option value="hidden">{{ tr('隐藏悬浮球') }}</option></select></label>
        <button type="submit" class="rule-primary" :disabled="saving">{{ tr('添加网站') }}</button>
      </form>
      <p class="rule-hint" data-domain-preview><template v-if="normalized"><span>{{ tr('将保存为') }} </span><strong data-i18n-ignore>{{ normalized }}</strong><span> · {{ tr('包含主域及所有子域；路径、参数和端口不进入偏好。') }}</span></template><template v-else>{{ tr('可粘贴网址；只针对某个路径的翻译范围请在正文适配中设置。') }}</template></p>
      <div id="site-preference-feedback" aria-live="polite"><p v-if="error" class="rule-error" role="alert">{{ tr(error) }}</p><p v-else-if="status" class="rule-hint" role="status">{{ tr(status) }}</p></div>
      <label v-if="rows.length" class="rule-field preference-search"><span class="sr-only">{{ tr('搜索网站偏好') }}</span><input v-model="search" type="search" :aria-label="tr('搜索网站偏好')" :placeholder="tr('搜索域名')" /></label>
      <div class="preference-list" role="list" :aria-label="tr('网站偏好')">
        <article v-for="row in visibleRows" :key="row.domain" role="listitem" class="preference-row" :data-site-preference="row.domain">
          <div class="preference-domain"><UiIcon name="globe" :size="18" /><div><strong data-i18n-ignore>{{ row.domain }}</strong><small>{{ tr(row.extensionDisabled ? '已禁用扩展，其他偏好暂不生效' : settings.autoTranslate ? '全局自动翻译生效；名单偏好仍保留' : row.alwaysTranslate ? '进入此网站后自动翻译' : '按需手动翻译') }}</small></div></div>
          <div class="preference-options">
            <label><input type="checkbox" :checked="row.alwaysTranslate" :disabled="saving" :aria-label="`${tr('始终翻译')} ${row.domain}`" @change="change(row, 'alwaysTranslate', $event)" />{{ tr('始终翻译') }}</label>
            <label><input type="checkbox" :checked="row.extensionDisabled" :disabled="saving" :aria-label="`${tr('禁用扩展')} ${row.domain}`" @change="change(row, 'extensionDisabled', $event)" />{{ tr('禁用扩展') }}</label>
            <label><input type="checkbox" :checked="row.floatingBallHidden" :disabled="saving" :aria-label="`${tr('隐藏悬浮球')} ${row.domain}`" @change="change(row, 'floatingBallHidden', $event)" />{{ tr('隐藏悬浮球') }}</label>
            <button type="button" :disabled="saving" :aria-label="`${tr('移除网站偏好')} ${row.domain}`" @click="remove(row)">{{ tr('移除') }}</button>
          </div>
        </article>
      </div>
      <div v-if="!visibleRows.length" class="rule-empty"><UiIcon name="globe" :size="28" /><strong>{{ tr(rows.length ? '没有匹配的网站' : '尚未添加网站偏好') }}</strong><p>{{ tr(rows.length ? '试试其他关键词，或清空搜索。' : settings.autoTranslate ? '全局自动翻译已开启。可以添加网站禁用扩展，或仅隐藏悬浮球。' : '默认按需翻译。可在上方添加，也可从菜单栏为当前网站快速设置。') }}</p></div>
      <div v-if="removed" class="rule-actions"><span class="rule-hint" data-i18n-ignore>{{ removed.domain }}</span><button type="button" :disabled="saving" @click="undoRemove">{{ tr('撤销移除') }}</button></div>
      <p v-if="!settings.on" class="rule-notice">{{ tr('插件已关闭。偏好会保存，再次启动插件后生效。') }}</p>
      <p class="rule-hint">{{ tr('隐藏悬浮球不会关闭快捷键、右键菜单或其他翻译功能。取消全部偏好后，该网站会自动从名单移除。') }}</p>
    </section>
  </div>
</template>
<script setup lang="ts">
import {computed, ref} from 'vue';
import UiIcon from '@/src/ui/components/UiIcon.vue';
import {getSiteBaseDomain} from '@/src/core/site-rules/domain';
import {useUiI18n} from '@/src/ui/i18n';
import {listSitePreferences, updateSitePreference, type SitePreferences, type SitePreferenceLists, type SitePreferenceRow} from '../model/sitePreferences';
const props = defineProps<{settings: SitePreferences; savePreferences: (patch: Partial<SitePreferenceLists> & {autoTranslate?: boolean}) => Promise<void>}>();
const {translateLegacy: tr} = useUiI18n();
const input = ref('');
const initialPreference = ref('always');
const search = ref('');
const saving = ref(false);
const error = ref('');
const status = ref('');
const removed = ref<SitePreferenceRow | null>(null);
const rows = computed(() => listSitePreferences(props.settings));
const visibleRows = computed(() => listSitePreferences(props.settings, search.value));
const normalized = computed(() => getSiteBaseDomain(input.value));
async function commit(patch: Partial<SitePreferenceLists> & {autoTranslate?: boolean}): Promise<boolean> {
  if (saving.value) return false;
  saving.value = true; error.value = ''; status.value = '';
  try { await props.savePreferences(patch); status.value = '网站偏好已保存。'; return true; }
  catch { error.value = '保存失败，请重试；已有偏好未被清空。'; return false; }
  finally { saving.value = false; }
}
async function addSite() {
  const domain = normalized.value;
  if (!domain) { error.value = '请输入有效的域名或 HTTP(S) 网址。'; return; }
  const existing = rows.value.find(row => row.domain === domain);
  const field = initialPreference.value === 'disabled' ? 'extensionDisabled' : initialPreference.value === 'hidden' ? 'floatingBallHidden' : 'alwaysTranslate';
  if (existing?.[field]) { error.value = '该网站已有此偏好，可在下方直接调整。'; search.value = domain; return; }
  const row = {...existing, alwaysTranslate: existing?.alwaysTranslate ?? false, extensionDisabled: existing?.extensionDisabled ?? false, floatingBallHidden: existing?.floatingBallHidden ?? false, [field]: true};
  const patch = updateSitePreference(props.settings, domain, row)!;
  if (await commit(patch)) { input.value = ''; search.value = ''; }
}
function change(row: SitePreferenceRow, field: 'alwaysTranslate' | 'extensionDisabled' | 'floatingBallHidden', event: Event) {
  const patch = updateSitePreference(props.settings, row.domain, {...row, [field]: (event.target as HTMLInputElement).checked});
  if (patch) void commit(patch);
}
async function remove(row: SitePreferenceRow) {
  const patch = updateSitePreference(props.settings, row.domain, null)!;
  if (await commit(patch)) removed.value = {...row};
}
async function undoRemove() {
  if (!removed.value) return;
  // 撤销只补回被移除的偏好，不覆盖之后从弹窗添加的同站偏好。
  const current = rows.value.find(row => row.domain === removed.value!.domain);
  const row = {...removed.value, alwaysTranslate: removed.value.alwaysTranslate || current?.alwaysTranslate === true,
    extensionDisabled: removed.value.extensionDisabled || current?.extensionDisabled === true,
    floatingBallHidden: removed.value.floatingBallHidden || current?.floatingBallHidden === true};
  if (await commit(updateSitePreference(props.settings, row.domain, row)!)) removed.value = null;
}
</script>
<style scoped>
@import './site-rule-workspace.css';
.preference-global { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.preference-add { display: grid; grid-template-columns: minmax(0, 1fr) 150px auto; align-items: end; gap: 12px; margin-top: 20px; }
.preference-add .rule-field { margin: 0; }
.preference-search { max-width: 420px; }
.preference-row { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 17px 0; border-bottom: 1px solid var(--line); }
.preference-domain { display: flex; gap: 10px; align-items: center; min-width: 0; }
.preference-domain > div { display: grid; gap: 6px; min-width: 0; }
.preference-domain strong { overflow-wrap: anywhere; font-size: 13px; }
.preference-domain small { color: var(--muted); font-size: 11px; line-height: 1.6; }
.preference-options { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 16px; flex-shrink: 0; }
.preference-options label { display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; }
.preference-options input { accent-color: var(--brand-strong); width: 16px; height: 16px; }
@media (max-width: 1150px) { .preference-row { align-items: flex-start; flex-direction: column; gap: 12px; } .preference-options { justify-content: flex-start; } }
@media (max-width: 650px) { .preference-add { grid-template-columns: minmax(0, 1fr); } .preference-options { gap: 12px; } }
</style>
