<!--
@file src/features/settings/ui/ContextMenuSettings.vue
文件职责：提供右键菜单的设置界面，让用户按使用习惯增删菜单入口，并在同一屏看到改动后的真实菜单形态。
主要内容：顶部总开关独立成行，左侧用可切换的选中文字、网页与图片场景模拟菜单，右侧紧凑网格编辑各入口；预览复用后台的结构推导与标题渲染，随开关即时更新，窄屏上下排列。
模块边界：本组件只编辑父级响应式配置并展示预览，保存与跨页面同步复用父级设置流程，不创建原生菜单、不发送运行时消息；菜单结构与标题来自 core/context-menu，真正的创建与点击路由由 app/background 负责。
-->
<template>
  <SettingsGroup class="context-menu-settings" :title="t('contextMenuSettings.title')" :description="t('contextMenuSettings.description')">
    <SettingsItem :label="t('contextMenuSettings.master')" :description="t('contextMenuSettings.masterDescription')">
      <el-switch v-model="config.contextMenuEnabled" class="settings-toggle" :aria-label="t('contextMenuSettings.master')" />
    </SettingsItem>

    <div class="context-menu-workspace">
      <section class="context-menu-preview" data-testid="context-menu-preview" :aria-label="t('contextMenuSettings.preview')">
        <div class="context-menu-preview-heading">
          <h3>{{ t('contextMenuSettings.preview') }}</h3>
          <p>{{ t('contextMenuSettings.previewDescription') }}</p>
        </div>
        <SegmentedControl v-model="previewBucket" :options="sceneOptions" :label="t('contextMenuSettings.preview')" />
        <div class="context-menu-preview-stage" :data-preview-scene="previewBucket">
          <div class="context-menu-preview-document" aria-hidden="true">
            <svg v-if="previewBucket === 'image'" class="context-menu-preview-image" viewBox="0 0 160 72" fill="none">
              <rect width="160" height="72" rx="6" fill="currentColor" opacity=".09" />
              <circle cx="126" cy="20" r="8" fill="currentColor" opacity=".25" />
              <path d="M12 62 48 24 81 57 106 34 146 62Z" fill="currentColor" opacity=".2" />
            </svg>
            <span v-else class="context-menu-preview-text" :class="{'is-selected': previewBucket === 'selection'}" data-i18n-ignore>Reading brings us closer.</span>
            <i /><i /><i />
          </div>
          <ul v-if="activeScene.items.length" class="context-menu-preview-list" aria-live="polite">
            <li v-for="item in activeScene.items" :key="item.id">
              <img :src="iconUrl" width="16" height="16" alt="" aria-hidden="true" />
              <span>{{ item.title }}</span>
            </li>
          </ul>
          <p v-else class="context-menu-preview-empty" role="status">{{ t('contextMenuSettings.sceneEmpty') }}</p>
        </div>
      </section>
      <div class="context-menu-entry-grid">
        <SettingsItem
          v-for="entry in entryRows"
          :key="entry.id"
          class="context-menu-entry"
          :data-context-menu-entry="entry.id"
          :label="entry.label"
          :description="entry.description"
          :disabled="!config.contextMenuEnabled || !entry.available"
        >
          <el-switch
            :model-value="entry.enabled"
            class="settings-toggle"
            :aria-label="entry.label"
            :disabled="!config.contextMenuEnabled || !entry.available"
            @update:model-value="entry.update"
          />
        </SettingsItem>
      </div>
    </div>
  </SettingsGroup>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import SettingsGroup from './components/SettingsGroup.vue';
import SettingsItem from './components/SettingsItem.vue';
import SegmentedControl from './components/SegmentedControl.vue';
import {
  buildContextMenuPlan,
  CONTEXT_MENU_ENTRIES,
  resolveContextMenuEntryToggles,
  resolveContextMenuPresentation,
  type ContextMenuActionId,
  type ContextMenuBucket,
} from '@/src/core/context-menu/domain';
import {
  getContextMenuTargetLanguage,
  renderContextMenuTitle,
} from '@/src/core/context-menu/presentation';
import { normalizeUiLanguage } from '@/src/core/i18n';
import { parseHotkey, resolveConfiguredHotkey } from '@/src/core/hotkey';
import { browserCapabilities } from '@/src/platform/browser/capabilities';
import type { Config } from '@/src/core/config/model';
import { useUiI18n } from '@/src/ui/i18n';

const props = defineProps<{config: Config}>();
const config = computed(() => props.config);
const { language, t } = useUiI18n();
const iconUrl = globalThis.__FLUENTREAD_ICON_DATA__ || '/icon/16.png';

// 每个入口先说明“什么时候会看到它”，再说明它做什么；不可用时补上前置条件，避免只能靠猜。
const ENTRY_COPY: Readonly<Record<ContextMenuActionId, {label: string; description: string; unavailable: string}>> = {
  translateSelection: {label: 'contextMenu.translateSelection', description: 'contextMenuSettings.selectionDescription', unavailable: 'contextMenuSettings.selectionUnavailable'},
  translatePage: {label: 'contextMenu.translatePage', description: 'contextMenuSettings.pageDescription', unavailable: ''},
  translateImage: {label: 'contextMenu.translateImage', description: 'contextMenuSettings.imageDescription', unavailable: 'contextMenuSettings.imageUnavailable'},
  translateArea: {label: 'contextMenu.translateArea', description: 'contextMenuSettings.areaDescription', unavailable: 'contextMenuSettings.areaUnavailable'},
  toggleSite: {label: 'contextMenuSettings.siteToggle', description: 'contextMenuSettings.siteToggleDescription', unavailable: ''},
};

const SCENE_TITLE_KEYS: Readonly<Record<ContextMenuBucket, string>> = {
  selection: 'contextMenuSettings.sceneSelection',
  page: 'contextMenuSettings.scenePage',
  image: 'contextMenuSettings.sceneImage',
};

const availability = computed(() => ({
  selectionTranslation: config.value.selectionTranslatorMode !== 'disabled' && config.value.disableSelectionTranslator !== true,
  imageTranslation: browserCapabilities.imageTranslation && config.value.disableImageTranslator !== true
    && config.value.imageTranslationContextMenuEnabled !== false,
  areaTranslation: browserCapabilities.areaTranslation && config.value.selectionAreaEnabled === true,
}));

function isAvailable(id: ContextMenuActionId): boolean {
  if (id === 'translateSelection') return availability.value.selectionTranslation;
  if (id === 'translateArea') return browserCapabilities.areaTranslation && config.value.selectionAreaEnabled === true;
  if (id === 'translateImage') return browserCapabilities.imageTranslation && config.value.disableImageTranslator !== true;
  return true;
}

function readEntryPreference(id: ContextMenuActionId, defaultEnabled: boolean): boolean {
  // 图片入口与图片翻译设置共用同一个开关，避免同一件事出现两个互相矛盾的选项。
  if (id === 'translateImage') return config.value.imageTranslationContextMenuEnabled !== false;
  return config.value.contextMenuEntries?.[id] ?? defaultEnabled;
}

function writeEntryPreference(id: ContextMenuActionId, value: boolean): void {
  if (id === 'translateImage') {
    config.value.imageTranslationContextMenuEnabled = value;
    return;
  }
  config.value.contextMenuEntries = {...config.value.contextMenuEntries, [id]: value};
}

const entryRows = computed(() => CONTEXT_MENU_ENTRIES.map((entry) => {
  const available = isAvailable(entry.id);
  const copy = ENTRY_COPY[entry.id];
  const description = t(copy.description);
  return {
    id: entry.id,
    label: t(copy.label),
    available,
    enabled: readEntryPreference(entry.id, entry.defaultEnabled),
    description: available ? description : t('contextMenuSettings.withReason', {description, reason: t(copy.unavailable)}),
    update: (value: string | number | boolean) => writeEntryPreference(entry.id, value === true),
  };
}));

const titleContext = computed(() => {
  const uiLanguage = normalizeUiLanguage(language.value);
  const hotkey = resolveConfiguredHotkey(config.value.floatingBallHotkey, config.value.customFloatingBallHotkey);
  const parsed = hotkey && hotkey !== 'none' ? parseHotkey(hotkey) : null;
  return {
    language: uiLanguage,
    targetLanguage: config.value.contextMenuShowTargetLanguage !== false ? getContextMenuTargetLanguage(config.value.to, uiLanguage) : '',
    shortcut: config.value.contextMenuShowShortcut !== false && parsed?.isValid ? parsed.displayName : '',
  };
});

const previewScenes = computed(() => {
  const display = {
    showTargetLanguage: config.value.contextMenuShowTargetLanguage !== false,
    showShortcut: config.value.contextMenuShowShortcut !== false,
  };
  const plan = config.value.contextMenuEnabled === false
    ? []
    : buildContextMenuPlan(resolveContextMenuEntryToggles(config.value.contextMenuEntries, availability.value));
  const presentations = resolveContextMenuPresentation(plan, {isTranslated: false, isSiteDisabled: false}, display);
  return (Object.keys(SCENE_TITLE_KEYS) as ContextMenuBucket[]).map((bucket) => ({
    bucket,
    title: t(SCENE_TITLE_KEYS[bucket]),
    items: plan.flatMap((item, index) => {
      const presentation = presentations[index];
      if (item.bucket !== bucket || !presentation.visible) return [];
      return [{
        id: item.menuItemId,
        title: renderContextMenuTitle(presentation, titleContext.value),
      }];
    }),
  }));
});
const previewBucket = ref<ContextMenuBucket>('page');
const sceneOptions = computed(() => previewScenes.value.map(scene => ({value: scene.bucket, label: scene.title})));
const activeScene = computed(() => previewScenes.value.find(scene => scene.bucket === previewBucket.value)!);
</script>

<style scoped>
.context-menu-workspace {
  display: grid;
  grid-template-columns: minmax(0, .9fr) minmax(0, 1.4fr);
  align-items: start;
  gap: 20px;
  padding: 16px 20px 20px;
  border-top: 1px solid var(--line);
  container-type: inline-size;
}
.context-menu-preview { display: grid; gap: 12px; min-width: 0; }
.context-menu-preview-heading h3 { margin: 0 0 4px; color: var(--ink); font-size: 13px; font-weight: 600; }
.context-menu-preview-heading p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.55; }
.context-menu-preview-stage {
  display: grid;
  align-content: center;
  gap: 12px;
  min-height: 190px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-soft);
}
.context-menu-preview-document { display: grid; gap: 8px; color: var(--muted); }
.context-menu-preview-text { justify-self: start; padding: 2px 4px; font-size: 12px; line-height: 1.5; }
.context-menu-preview-text.is-selected { color: var(--brand-strong); background: var(--brand-soft); border-radius: 3px; }
.context-menu-preview-document i { height: 5px; width: 92%; border-radius: 3px; background: color-mix(in srgb, var(--muted) 15%, transparent); }
.context-menu-preview-document i:last-child { width: 62%; }
.context-menu-preview-image { width: min(100%, 160px); height: auto; }
.context-menu-preview-list {
  display: flex;
  flex-direction: column;
  width: min(100%, 280px);
  justify-self: end;
  margin: 0;
  padding: 4px 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  list-style: none;
  box-shadow: 0 6px 18px -8px rgba(15, 23, 42, .25);
}
.context-menu-preview-list li {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  padding: 5px 10px;
  color: var(--ink);
  font-size: 11.5px;
  line-height: 1.4;
}
.context-menu-preview-list img { flex: none; }
.context-menu-preview-list li span { min-width: 0; overflow-wrap: anywhere; }
.context-menu-preview-empty {
  margin: 0;
  color: var(--muted);
  font-size: 10.5px;
  line-height: 1.55;
}
.context-menu-entry-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; min-width: 0; }
.context-menu-entry { grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 10px; min-height: 0; padding: 12px; border: 1px solid var(--line); border-radius: 8px; }
.context-menu-entry :deep(.settings-item-copy small) { font-size: 11px; }
@container (max-width: 760px) {
  .context-menu-entry-grid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 850px) {
  .context-menu-workspace { grid-template-columns: minmax(0, 1fr); }
  .context-menu-entry-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 700px) {
  .context-menu-workspace { padding: 12px; gap: 16px; }
}
@media (max-width: 480px) {
  .context-menu-entry-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
