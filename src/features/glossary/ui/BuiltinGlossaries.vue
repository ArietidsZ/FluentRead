<!--
 * @file src/features/glossary/ui/BuiltinGlossaries.vue
 * 文件职责：展示随扩展内嵌的主题词库，让用户先查看真实词条，再添加可编辑副本。
 * 主要内容：按领域呈现语言与条数、已添加和启停状态；本地搜索预览完整词表，说明独立整理来源及不自动覆盖的版本策略。
 * 模块边界：只读取目录和父级传入的配置，添加通过事件交给设置页既有保存队列；不写存储、不联网、不改变总开关。
 -->
<template>
  <section class="fluentread-glossary" data-testid="builtin-glossaries" data-i18n-ignore>
    <details class="glossary-card" :open="!libraries.length">
      <summary class="builtin-heading">{{ t('glossary.builtin.title') }} <small>{{ BUILTIN_GLOSSARIES.length }}</small></summary>
      <p class="glossary-help">{{ t('glossary.builtin.help') }}</p>
      <div class="builtin-grid">
        <article v-for="preset in BUILTIN_GLOSSARIES" :key="preset.id" :data-testid="`builtin-${preset.id}`" class="builtin-card">
          <h4>{{ t(preset.nameKey) }}</h4><p class="glossary-help">{{ t(preset.descriptionKey) }}</p>
          <small>{{ t('glossary.entryCount', {count: preset.terms.length}) }} · {{ t(preset.targetLanguage ? 'glossary.builtin.englishChinese' : 'glossary.builtin.allLanguages') }}</small>
          <p v-if="installed(preset.id)" class="glossary-help">{{ t('glossary.builtin.added') }} · {{ enabled && installed(preset.id)!.enabled ? t('glossary.on') : t('glossary.off') }}</p>
          <div class="glossary-actions builtin-actions">
            <button type="button" :aria-label="t('glossary.builtin.previewNamed', {name: t(preset.nameKey)})" @click="previewId = preset.id; search = ''">{{ t('glossary.builtin.preview') }}</button>
            <button type="button" :disabled="disabled" :aria-label="t(installed(preset.id) ? 'glossary.builtin.manageNamed' : 'glossary.builtin.addNamed', {name: t(preset.nameKey)})" @click="$emit('add', preset.id)">{{ t(installed(preset.id) ? 'glossary.builtin.manage' : 'glossary.builtin.add') }}</button>
          </div>
        </article>
      </div>
    </details>
    <el-dialog :model-value="Boolean(preview)" :title="preview ? t(preview.nameKey) : ''" width="min(680px, calc(100vw - 28px))" @update:model-value="previewId = ''">
      <div v-if="preview" class="fluentread-glossary" data-i18n-ignore data-testid="builtin-glossary-preview">
        <p class="glossary-help">{{ t('glossary.builtin.source', {version: preview.version}) }}</p>
        <p class="glossary-help">{{ t('glossary.builtin.previewHelp') }}</p>
        <label>{{ t('glossary.search') }}<input v-model="search" type="search" /></label>
        <p role="status">{{ t('glossary.entryCount', {count: terms.length}) }}</p>
        <div class="builtin-terms glossary-table-scroll"><table class="glossary-table"><thead><tr><th>{{ t('glossary.source') }}</th><th>{{ t('glossary.target') }}</th></tr></thead>
          <tbody><tr v-for="[source, target] in terms" :key="source"><td>{{ source }}</td><td>{{ target || t('glossary.keepOriginal') }}</td></tr></tbody>
        </table><p v-if="!terms.length" class="glossary-help">{{ t('glossary.noResults') }}</p></div>
        <div class="glossary-actions glossary-dialog-actions"><button type="button" @click="previewId = ''">{{ t('common.close') }}</button><button type="button" class="primary" :disabled="disabled" @click="$emit('add', preview.id); previewId = ''">{{ t(installed(preview.id) ? 'glossary.builtin.manage' : 'glossary.builtin.add') }}</button></div>
      </div>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';
import {BUILTIN_GLOSSARIES} from '@/src/core/glossary/builtins';
import type {GlossaryLibrary} from '@/src/core/glossary';
import {useUiI18n} from '@/src/ui/i18n';

const props = defineProps<{libraries: GlossaryLibrary[]; enabled: boolean; disabled: boolean}>();
defineEmits<{add: [id: string]}>();
const {t} = useUiI18n();
const previewId = ref('');
const search = ref('');
const preview = computed(() => BUILTIN_GLOSSARIES.find(preset => preset.id === previewId.value));
const terms = computed(() => (preview.value?.terms || []).filter(([source, target]) => `${source}\n${target}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())));
function installed(id: string): GlossaryLibrary | undefined {return props.libraries.find(library => library.preset?.id === id);}
</script>

<style scoped src="./glossary-settings.css"></style>
<style scoped>
.builtin-heading { cursor: pointer; font-weight: 600; }
.builtin-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
.builtin-card { min-width: 0; border: 1px solid var(--line, var(--el-border-color)); border-radius: 10px; padding: 13px; }
.builtin-card h4 { margin: 0; font-size: 13px; }
.builtin-actions { margin-top: 12px; }
.builtin-terms { max-height: 300px; }
@media (max-width: 620px) { .builtin-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
