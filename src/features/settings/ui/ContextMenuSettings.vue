<!--
@file src/features/settings/ui/ContextMenuSettings.vue
文件职责：提供右键菜单的设置界面，让用户按使用习惯增删菜单入口、控制标题里出现的信息，并在同一屏看到改动后的真实菜单形态。
主要内容：渲染总开关、按右键场景分组的入口开关、目标语言与快捷键显示选项，并用与后台相同的结构推导和文案渲染生成三种右键场景的实时预览。
模块边界：本组件只读写共享配置并展示预览，不创建原生菜单、不发送运行时消息；菜单结构与标题来自 core/context-menu，真正的创建与点击路由由 app/background 负责。
-->
<template>
  <SettingsGroup :title="t('contextMenuSettings.title')" :description="t('contextMenuSettings.description')">
    <SettingsItem :label="t('contextMenuSettings.master')" :description="t('contextMenuSettings.masterDescription')">
      <el-switch v-model="config.contextMenuEnabled" class="settings-toggle" :aria-label="t('contextMenuSettings.master')" />
    </SettingsItem>

    <SettingsItem
      v-for="entry in entryRows"
      :key="entry.id"
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

    <SettingsItem :label="t('contextMenuSettings.showLanguage')" :description="t('contextMenuSettings.showLanguageDescription')">
      <el-switch v-model="config.contextMenuShowTargetLanguage" class="settings-toggle" :aria-label="t('contextMenuSettings.showLanguage')" :disabled="!config.contextMenuEnabled" />
    </SettingsItem>
    <SettingsItem :label="t('contextMenuSettings.showShortcut')" :description="t('contextMenuSettings.showShortcutDescription')">
      <el-switch v-model="config.contextMenuShowShortcut" class="settings-toggle" :aria-label="t('contextMenuSettings.showShortcut')" :disabled="!config.contextMenuEnabled" />
    </SettingsItem>

    <SettingsItem :label="t('contextMenuSettings.preview')" :description="t('contextMenuSettings.previewDescription')" stacked>
      <div class="context-menu-preview" data-testid="context-menu-preview">
        <div v-for="scene in previewScenes" :key="scene.bucket" class="context-menu-preview-scene">
          <span class="context-menu-preview-scene-title">{{ scene.title }}</span>
          <ul v-if="scene.items.length > 0" class="context-menu-preview-list">
            <li v-for="item in scene.items" :key="item.id" :class="{ 'is-child': item.child }">
              <span>{{ item.title }}</span>
              <span v-if="item.child === false && item.hasChildren" class="context-menu-preview-arrow" aria-hidden="true">›</span>
            </li>
          </ul>
          <p v-else class="context-menu-preview-empty">{{ t('contextMenuSettings.sceneEmpty') }}</p>
        </div>
      </div>
    </SettingsItem>
  </SettingsGroup>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import SettingsGroup from './components/SettingsGroup.vue';
import SettingsItem from './components/SettingsItem.vue';
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
import { config } from '@/src/services/config/store';
import { useUiI18n } from '@/src/ui/i18n';

const { language, t } = useUiI18n();

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
  selectionTranslation: config.selectionTranslatorMode !== 'disabled' && config.disableSelectionTranslator !== true,
  imageTranslation: browserCapabilities.imageTranslation && config.disableImageTranslator !== true
    && config.imageTranslationContextMenuEnabled !== false,
  areaTranslation: browserCapabilities.areaTranslation && config.selectionAreaEnabled === true,
}));

function isAvailable(id: ContextMenuActionId): boolean {
  if (id === 'translateSelection') return availability.value.selectionTranslation;
  if (id === 'translateArea') return browserCapabilities.areaTranslation && config.selectionAreaEnabled === true;
  if (id === 'translateImage') return browserCapabilities.imageTranslation && config.disableImageTranslator !== true;
  return true;
}

function readEntryPreference(id: ContextMenuActionId, defaultEnabled: boolean): boolean {
  // 图片入口与图片翻译设置共用同一个开关，避免同一件事出现两个互相矛盾的选项。
  if (id === 'translateImage') return config.imageTranslationContextMenuEnabled !== false;
  return config.contextMenuEntries?.[id] ?? defaultEnabled;
}

function writeEntryPreference(id: ContextMenuActionId, value: boolean): void {
  if (id === 'translateImage') {
    config.imageTranslationContextMenuEnabled = value;
    return;
  }
  config.contextMenuEntries = {...config.contextMenuEntries, [id]: value};
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
  const hotkey = resolveConfiguredHotkey(config.floatingBallHotkey, config.customFloatingBallHotkey);
  const parsed = hotkey && hotkey !== 'none' ? parseHotkey(hotkey) : null;
  return {
    language: uiLanguage,
    targetLanguage: config.contextMenuShowTargetLanguage !== false ? getContextMenuTargetLanguage(config.to, uiLanguage) : '',
    shortcut: config.contextMenuShowShortcut !== false && parsed?.isValid ? parsed.displayName : '',
  };
});

const previewScenes = computed(() => {
  const display = {
    showTargetLanguage: config.contextMenuShowTargetLanguage !== false,
    showShortcut: config.contextMenuShowShortcut !== false,
  };
  const plan = config.contextMenuEnabled === false
    ? []
    : buildContextMenuPlan(resolveContextMenuEntryToggles(config.contextMenuEntries, availability.value));
  const presentations = resolveContextMenuPresentation(plan, {isTranslated: false, isSiteDisabled: false}, display);
  return (Object.keys(SCENE_TITLE_KEYS) as ContextMenuBucket[]).map((bucket) => ({
    bucket,
    title: t(SCENE_TITLE_KEYS[bucket]),
    items: plan.flatMap((item, index) => {
      const presentation = presentations[index];
      if (item.bucket !== bucket || !presentation.visible) return [];
      return [{
        id: item.menuItemId,
        child: item.role === 'child',
        hasChildren: item.role === 'parent',
        title: renderContextMenuTitle(presentation, titleContext.value),
      }];
    }),
  }));
});
</script>

<style scoped>
.context-menu-preview {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  width: 100%;
}

.context-menu-preview-scene {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-soft);
}

.context-menu-preview-scene-title {
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 700;
}

.context-menu-preview-list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 4px 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  list-style: none;
}

.context-menu-preview-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  color: var(--ink);
  font-size: 11.5px;
  line-height: 1.4;
}

.context-menu-preview-list li.is-child { padding-left: 22px; }
.context-menu-preview-arrow { color: var(--muted); }

.context-menu-preview-empty {
  margin: 0;
  color: var(--muted);
  font-size: 10.5px;
}
</style>
