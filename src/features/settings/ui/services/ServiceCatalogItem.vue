<!--
 * @file src/features/settings/ui/services/ServiceCatalogItem.vue
 * 文件职责：为个人列表与完整目录渲染统一的服务选择行及独立常用按钮。
 * 主要内容：本地图标、完整名称提示、默认标记、配置状态和可访问的常用切换。
 * 模块边界：只发出选择与常用事件，不修改配置、不测试连接、不发起翻译。
 -->
<template>
  <div class="library-item" :class="{ active: selected, compact }">
    <button type="button" class="library-select" :data-service-value="item.value"
      :aria-pressed="selected" :title="item.label" @click="$emit('select', item.value)">
      <ServiceIcon :service="item.value" :label="item.label" size="small" />
      <span class="library-copy"><strong>{{ item.label }}</strong><small v-if="!compact && status">{{ status }}</small></span>
      <span v-if="isDefault" class="library-default">{{ t('settings.services.library.defaultBadge') }}</span>
    </button>
    <button type="button" class="library-favorite" :class="{ starred: favorite }" :aria-pressed="favorite"
      :data-service-favorite="item.value"
      :aria-label="t(favorite ? 'settings.services.library.unfavorite' : 'settings.services.library.favorite', { service: item.label })"
      :title="t(favorite ? 'settings.services.library.unfavorite' : 'settings.services.library.favorite', { service: item.label })"
      @click="$emit('favorite', item.value)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></svg>
    </button>
  </div>
</template>
<script setup lang="ts">
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue'
import { useUiI18n } from '@/src/ui/i18n'
import type { ServiceOption } from '@/src/ui/view-model/serviceCatalog'
defineProps<{ item: ServiceOption; selected: boolean; favorite: boolean; isDefault: boolean; compact?: boolean; status?: string }>()
defineEmits<{ select: [service: string]; favorite: [service: string] }>()
const { t } = useUiI18n()
</script>
<style scoped>
.library-item { display: flex; align-items: center; min-width: 0; border: 1px solid var(--line, #e4e7ef); border-radius: 10px; background: var(--surface, #fff); }
.library-item:hover { border-color: var(--brand-strong, #bd2853); }
.library-item.active { border-color: var(--brand-strong, #bd2853); background: var(--brand-soft, #fff0f4); }
.library-select { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; min-height: 64px; padding: 10px 8px 10px 12px; border: 0; background: transparent; color: var(--ink, #172033); text-align: left; cursor: pointer; border-radius: 8px; }
.library-copy { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.library-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; }
.library-copy small { margin-top: 3px; color: var(--muted, #737c8f); font-size: 11px; }
.library-default { color: var(--brand-strong, #bd2853); font-size: 11px; flex-shrink: 0; }
.library-favorite { display: grid; place-items: center; width: 32px; height: 36px; flex-shrink: 0; margin-right: 4px; padding: 7px; border: 0; border-radius: 7px; background: transparent; color: var(--muted, #737c8f); cursor: pointer; }
.library-favorite:hover { background: var(--brand-soft, #fff0f4); color: var(--brand-strong, #bd2853); }
.library-favorite svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; }
.library-favorite.starred { color: var(--brand-strong, #bd2853); }
.library-favorite.starred svg { fill: currentColor; }
.compact { border-color: transparent; background: transparent; }
.compact .library-select { min-height: 44px; padding: 6px 4px 6px 8px; gap: 8px; }
button:focus-visible { outline: 2px solid var(--brand-strong, #bd2853); outline-offset: 2px; }
@media (pointer: coarse) { .library-favorite { width: 44px; height: 44px; } }
</style>
