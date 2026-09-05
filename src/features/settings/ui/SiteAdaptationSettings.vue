<!--
 * @file src/features/settings/ui/SiteAdaptationSettings.vue
 * 文件职责：展示内置网站适配并编辑本地 JSON 自定义规则。
 * 主要内容：提供搜索、单条停用、展开规则、模板复制、草稿校验、文件导入导出和网址匹配预览。
 * 模块边界：组件经父级提供的异步保存端口提交合法配置，等待后台确认；不请求预览网址，不执行规则代码。
 -->
<template>
  <details class="adaptation-card" data-setting="site-adaptation">
    <summary class="adaptation-summary">
      <span><strong>{{ tr('网站适配') }}</strong><small>{{ tr('自动识别正文，保留按钮、代码与页面控件。') }}</small></span>
      <span class="adaptation-count">{{ tr('内置规则') }} {{ builtinSiteRulePack.rules.length }}</span>
    </summary>
    <div class="adaptation-body">
      <label class="adaptation-toggle">
        <span><strong>{{ tr('启用网站适配') }}</strong><small>{{ tr('内置规则默认生效，也可添加自己的规则。') }}</small></span>
        <el-switch :model-value="modelValue.enabled" :disabled="saving" :aria-label="tr('启用网站适配')" @update:model-value="setEnabled(Boolean($event))" />
      </label>

      <details class="adaptation-section">
        <summary>{{ tr('查看内置规则') }}</summary>
        <label class="adaptation-field">
          <span>{{ tr('搜索网站') }}</span>
          <input v-model="search" type="search" :placeholder="tr('输入网站名称或域名')" autocomplete="off" @input="visibleLimit = 30" />
        </label>
        <div class="adaptation-rule-list" role="list" :aria-label="tr('内置规则')">
          <article v-for="rule in visibleRules" :key="rule.id" role="listitem" class="adaptation-rule" :data-adaptation-rule="rule.id">
            <button class="adaptation-rule-name" type="button" @click="selectedRule = rule">
              <strong data-i18n-ignore>{{ rule.name }}</strong><small data-i18n-ignore>{{ rule.match.hosts.join(', ') }}</small>
              <small v-if="customIds.has(rule.id)">{{ tr('已由自定义规则覆盖') }}</small>
            </button>
            <el-switch :model-value="!modelValue.disabledRuleIds.includes(rule.id)" :disabled="saving" :aria-label="`${tr('启用规则')} ${rule.name}`"
              @update:model-value="toggleRule(rule.id, Boolean($event))" />
          </article>
        </div>
        <p v-if="!matchingRules.length" class="adaptation-hint">{{ tr('没有匹配的网站规则。') }}</p>
        <button v-if="visibleRules.length < matchingRules.length" type="button" @click="visibleLimit += 30">{{ tr('显示更多') }} ({{ visibleRules.length }}/{{ matchingRules.length }})</button>
        <div v-if="selectedRule" class="adaptation-rule-detail">
          <div class="adaptation-actions"><strong data-i18n-ignore>{{ selectedRule.name }}</strong><button type="button" @click="selectedRule = null">{{ tr('关闭') }}</button></div>
          <pre data-i18n-ignore>{{ selectedRuleJson }}</pre>
          <button type="button" @click="copyRule(selectedRule)">{{ tr('复制到自定义草稿') }}</button>
        </div>
        <div class="adaptation-actions"><button type="button" @click="downloadPack(builtinSiteRulePack, 'fluentread-builtin-sites.json')">{{ tr('导出内置规则') }}</button></div>
      </details>

      <section class="adaptation-section" aria-labelledby="adaptation-custom-heading">
        <h4 id="adaptation-custom-heading">{{ tr('自定义规则') }} <span class="adaptation-count">{{ modelValue.custom.rules.length }}</span></h4>
        <p class="adaptation-hint">{{ tr('编辑后点击保存。同 ID 的自定义规则会完整替换内置规则；删除后恢复内置规则。') }}</p>
        <div class="adaptation-actions">
          <button type="button" @click="insertExample">{{ tr('插入示例') }}</button>
          <button type="button" @click="fileInput?.click()">{{ tr('导入 JSON') }}</button>
          <button type="button" :disabled="saving" @click="downloadPack(modelValue.custom, 'fluentread-custom-sites.json')">{{ tr('导出已保存规则') }}</button>
          <input ref="fileInput" hidden type="file" accept=".json,application/json" @change="importFile" />
        </div>
        <label class="adaptation-field">
          <span>{{ tr('JSON 编辑草稿') }} <small v-if="isDirty">{{ tr('未保存') }}</small></span>
          <textarea v-model="draft" data-i18n-ignore rows="15" spellcheck="false" autocomplete="off"
            :aria-invalid="issues.length > 0" aria-describedby="adaptation-editor-feedback" @input="markDraftEdited" />
        </label>
        <div id="adaptation-editor-feedback" aria-live="polite">
          <ul v-if="issues.length" class="adaptation-errors" role="alert"><li v-for="(issue, index) in issues" :key="index"><code data-i18n-ignore>{{ issue.path }}</code> {{ tr(issue.message) }}</li></ul>
          <p v-else-if="status" class="adaptation-hint" role="status">{{ tr(status) }}</p>
        </div>
        <div class="adaptation-actions">
          <button type="button" class="adaptation-primary" :disabled="!isDirty || saving" :aria-busy="saving" @click="saveDraft">{{ tr(saving ? '正在保存' : '保存规则') }}</button>
          <button type="button" :disabled="!isDirty || saving" @click="restoreSaved">{{ tr('恢复已保存草稿') }}</button>
          <button type="button" @click="clearCustom">{{ tr('清空自定义草稿') }}</button>
          <button v-if="undoDraft !== null" type="button" @click="undoReplacement">{{ tr('撤销草稿替换') }}</button>
        </div>
        <details class="adaptation-guide">
          <summary>{{ tr('如何编写规则') }}</summary>
          <p><a href="https://fluent.thinkstu.com/guide/custom-site-rules" target="_blank" rel="noopener noreferrer">{{ tr('查看完整自定义教程') }}</a></p>
          <dl>
            <dt><code>match</code></dt><dd>{{ tr('hosts 指定域名；*.example.com 包含主域名与子域。paths 和 excludePaths 按网址路径匹配，* 表示任意字符。') }}</dd>
            <dt><code>mode</code></dt><dd>{{ tr('augment 在通用识别上补充正文；focus 只翻译 content 选中的区域。') }}</dd>
            <dt><code>content</code></dt><dd>{{ tr('css 填写 CSS 选择器。atomic 为 true 时将区域作为整体翻译，false 时继续发现内部明确声明的正文目标。focus 模式需同时声明段落选择器。') }}</dd>
            <dt><code>protect / exclude</code></dt><dd>{{ tr('protect 保留区域原文；exclude 同时排除该区域的正文扫描。') }}</dd>
            <dt><code>watchIgnore</code></dt><dd>{{ tr('忽略指定区域的动态变化，仅用于时钟、计数器等持续更新的非正文。') }}</dd>
            <dt><code>priority</code></dt><dd>{{ tr('正文候选优先使用数字较大的规则，同值按规则顺序。所有命中规则的保护区域共同生效；任一 focus 规则会限制通用正文识别。') }}</dd>
          </dl>
        </details>
      </section>

      <section class="adaptation-section" aria-labelledby="adaptation-preview-heading">
        <h4 id="adaptation-preview-heading">{{ tr('网址匹配预览') }}</h4>
        <p class="adaptation-hint">{{ tr('按已保存规则预览；仅检查网址匹配，实际内容以网页结构为准。') }}</p>
        <label class="adaptation-field"><span>{{ tr('输入完整网址') }}</span><input v-model="previewUrl" type="url" placeholder="https://example.com/articles/hello" autocomplete="off" spellcheck="false" /></label>
        <div v-if="previewUrl" class="adaptation-preview" aria-live="polite">
          <p v-if="!preview.ok">{{ tr('请输入以 http:// 或 https:// 开头的完整网址。') }}</p>
          <template v-else>
            <p v-if="!preview.rules.length">{{ tr('未命中专属规则，将使用通用正文识别。') }}</p>
            <p v-else-if="!preview.rules.some(item => item.enabled)">{{ tr('匹配规则均已停用，将使用通用正文识别。') }}</p>
            <ol v-if="preview.rules.length"><li v-for="item in preview.rules" :key="item.rule.id"><strong data-i18n-ignore>{{ item.rule.name }}</strong> · {{ tr(item.source === 'custom' ? '自定义' : '内置') }} · {{ tr(item.enabled ? '已启用' : '已停用') }}</li></ol>
          </template>
        </div>
      </section>
    </div>
  </details>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {builtinSiteRulePack} from '@/src/core/site-adaptation/catalog';
import {resolveSiteRule} from '@/src/core/site-adaptation/compiler';
import {SITE_RULE_LIMITS} from '@/src/core/site-adaptation/schema';
import type {SiteAdaptationSettings, SiteRule, SiteRuleIssue, SiteRulePack} from '@/src/core/site-adaptation/types';
import {
  completeSiteRuleDraftSave, copySiteRuleToDraft, createSiteAdaptationCommitter, createSiteRuleDraftImportGuard,
  formatSiteRulePack, parseSiteAdaptationDraft, previewSiteRules,
  reconcileSiteRuleDraft, searchSiteRules, setSiteRuleEnabled, SITE_ADAPTATION_EXAMPLE,
} from '../model/siteAdaptationEditor';
import {useUiI18n} from '@/src/ui/i18n';

const props = defineProps<{
  modelValue: SiteAdaptationSettings;
  saveSettings: (value: SiteAdaptationSettings) => Promise<void>;
}>();
const {translateLegacy: tr} = useUiI18n();
const search = ref('');
const visibleLimit = ref(30);
const selectedRule = ref<SiteRule | null>(null);
const draft = ref(formatSiteRulePack(props.modelValue.custom));
const draftOwned = ref(false);
const saving = ref(false);
const committer = createSiteAdaptationCommitter(value => props.saveSettings(value));
const importGuard = createSiteRuleDraftImportGuard();
const undoDraft = ref<string | null>(null);
const issues = ref<SiteRuleIssue[]>([]);
const status = ref('');
const previewUrl = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const isDirty = computed(() => draft.value !== formatSiteRulePack(props.modelValue.custom));
const matchingRules = computed(() => searchSiteRules(builtinSiteRulePack.rules, search.value));
const visibleRules = computed(() => matchingRules.value.slice(0, visibleLimit.value));
const customIds = computed(() => new Set(props.modelValue.custom.rules.map(rule => rule.id)));
const selectedRuleJson = computed(() => selectedRule.value ? JSON.stringify(resolveSiteRule(builtinSiteRulePack, selectedRule.value), null, 2) : '');
const preview = computed(() => previewSiteRules(previewUrl.value, builtinSiteRulePack, props.modelValue));

watch(() => props.modelValue.custom, (incoming, previous) => {
  draft.value = reconcileSiteRuleDraft(draft.value, previous, incoming, draftOwned.value || saving.value);
});

function clearFeedback() { issues.value = []; status.value = ''; }
function markDraftEdited() { draftOwned.value = true; clearFeedback(); }
async function commitSettings(value: SiteAdaptationSettings): Promise<boolean> {
  if (saving.value) return false;
  clearFeedback(); saving.value = true;
  const result = await committer.commit(value);
  saving.value = false;
  if (result !== 'saved') {
    issues.value = [{path: '$', message: '保存失败，草稿仍保留；请重试。'}];
    return false;
  }
  return true;
}
function setEnabled(enabled: boolean) { return commitSettings({...props.modelValue, enabled}); }
function toggleRule(id: string, enabled: boolean) { return commitSettings(setSiteRuleEnabled(props.modelValue, id, enabled)); }
async function saveDraft() {
  if (saving.value) return;
  clearFeedback();
  const submitted = draft.value;
  const result = parseSiteAdaptationDraft(submitted, document);
  if (!result.ok) { issues.value = result.issues; return; }
  draftOwned.value = true;
  if (!await commitSettings({...props.modelValue, custom: result.pack})) return;
  const completed = completeSiteRuleDraftSave(draft.value, submitted, result.pack);
  draft.value = completed.draft;
  if (completed.clearUndo) { undoDraft.value = null; draftOwned.value = false; }
  status.value = completed.clearUndo
    ? '规则已应用；正在翻译的页面会恢复原文，请重新触发翻译。'
    : '已保存提交的规则，新的草稿修改尚未保存。';
}
function replaceDraft(value: string) { undoDraft.value = draft.value; draft.value = value; markDraftEdited(); }
function restoreSaved() { replaceDraft(formatSiteRulePack(props.modelValue.custom)); }
function clearCustom() { replaceDraft(formatSiteRulePack({version: 1, rules: []})); status.value = '已清空草稿，点击保存后生效。'; }
function undoReplacement() {
  if (undoDraft.value === null) return;
  draft.value = undoDraft.value; undoDraft.value = null; markDraftEdited();
}
function copyRule(rule: SiteRule, source = builtinSiteRulePack) {
  const result = copySiteRuleToDraft(draft.value, source, rule, document);
  clearFeedback();
  if (!result.ok) { issues.value = result.issues; return; }
  replaceDraft(result.draft);
  status.value = '已加入草稿，编辑后点击保存。';
}
function insertExample() { copyRule(SITE_ADAPTATION_EXAMPLE.rules[0]!, SITE_ADAPTATION_EXAMPLE); }
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const importTicket = importGuard.begin(draft.value);
  clearFeedback();
  if (file.size > SITE_RULE_LIMITS.bytes) { issues.value = [{path: '$', message: '规则包不能超过 2 MB'}]; return; }
  try {
    const text = await file.text();
    const state = importGuard.check(importTicket, draft.value);
    if (state === 'superseded') return;
    if (state === 'edited') { status.value = '读取文件期间草稿已更改，请重新导入以替换当前草稿。'; return; }
    replaceDraft(text);
    const result = parseSiteAdaptationDraft(text, document);
    if (!result.ok) issues.value = result.issues;
    else status.value = '已导入草稿，检查后点击保存。';
  } catch {
    if (importGuard.check(importTicket, draft.value) === 'current') {
      issues.value = [{path: '$', message: '无法读取文件，请重新选择本地 JSON 文件。'}];
    }
  }
}
function downloadPack(pack: SiteRulePack, filename: string) {
  const url = URL.createObjectURL(new Blob([formatSiteRulePack(pack)], {type: 'application/json;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>

<style scoped>
.adaptation-card { width: min(100%, 1080px); margin: 0 auto 16px; overflow: hidden; border: 1px solid var(--line); border-radius: 20px; background: var(--surface-soft); color: var(--ink); }
.adaptation-summary { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 20px; cursor: pointer; }
.adaptation-summary > span:first-child { display: grid; gap: 6px; }
.adaptation-summary strong { font-size: 18px; }
.adaptation-summary small, .adaptation-toggle small { color: var(--muted); font-size: 11px; line-height: 1.55; }
.adaptation-summary::after { content: '+'; color: var(--muted); font-size: 20px; }
.adaptation-card[open] > .adaptation-summary::after { content: '−'; }
.adaptation-count { flex-shrink: 0; color: var(--muted); font-size: 11px; font-weight: 500; }
.adaptation-body { padding: 0 20px 20px; }
.adaptation-toggle { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 0; border-top: 1px solid var(--line); }
.adaptation-toggle > span { display: grid; gap: 5px; font-size: 13px; }
.adaptation-section { padding-top: 16px; margin-top: 16px; border-top: 1px solid var(--line); }
.adaptation-section > summary, .adaptation-guide > summary { cursor: pointer; font-size: 13px; font-weight: 600; }
h4 { display: flex; gap: 10px; align-items: center; margin: 0 0 8px; font-size: 14px; }
.adaptation-field { display: grid; gap: 7px; margin: 14px 0; font-size: 12px; }
.adaptation-field span { display: flex; gap: 10px; }
.adaptation-field small { color: var(--brand-strong); }
input:not([type=file]), textarea { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink); padding: 11px 12px; font: inherit; }
textarea { resize: vertical; min-height: 230px; font: 12px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; tab-size: 2; }
button { min-height: 32px; padding: 6px 11px; border: 1px solid var(--line); border-radius: 9px; color: var(--ink); background: var(--surface); font: inherit; font-size: 12px; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
button:hover:not(:disabled) { border-color: var(--brand-strong); }
button:focus-visible, input:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid var(--brand-strong); outline-offset: 3px; }
.adaptation-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
.adaptation-primary { background: var(--brand-strong); border-color: var(--brand-strong); color: white; }
.adaptation-rule-list { max-height: 350px; overflow: auto; margin-bottom: 10px; }
.adaptation-rule { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--line); padding: 7px 0; }
.adaptation-rule-name { display: grid; gap: 4px; min-width: 0; border: 0; background: transparent; text-align: left; }
.adaptation-rule-name small { overflow-wrap: anywhere; color: var(--muted); font-size: 10px; }
.adaptation-rule-detail { padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
.adaptation-rule-detail .adaptation-actions { justify-content: space-between; margin-top: 0; font-size: 13px; }
pre { max-height: 320px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 11px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; }
.adaptation-hint, .adaptation-guide, .adaptation-preview { margin: 8px 0; color: var(--muted); font-size: 11px; line-height: 1.65; }
.adaptation-errors { padding-left: 18px; font-size: 12px; line-height: 1.7; color: var(--danger, #bb233b); overflow-wrap: anywhere; }
.adaptation-guide { margin-top: 16px; }
dl { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 9px 14px; }
dd { margin: 0; }
ol { padding-left: 22px; }
@media (max-width: 700px) {
  .adaptation-summary { padding: 16px; gap: 8px; }
  .adaptation-summary strong { font-size: 16px; }
  .adaptation-body { padding: 0 16px 16px; }
  .adaptation-summary .adaptation-count { max-width: 75px; font-size: 10px; }
  dl { grid-template-columns: 1fr; gap: 5px; } dd { margin-bottom: 9px; }
}
</style>
