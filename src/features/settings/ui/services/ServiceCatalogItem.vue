<!--
 * @file src/features/settings/ui/services/ServiceCatalogItem.vue
 * 文件职责：为完整服务目录渲染紧凑的服务选择行。
 * 主要内容：本地图标、完整名称提示、默认标记、可访问的选中状态。
 * 模块边界：只发出选择事件，不修改配置、不测试连接、不发起翻译。
 -->
<template>
  <div class="library-item" :class="{ active: selected, compact }">
    <button type="button" class="library-select" :data-service-value="item.value"
      :aria-pressed="selected" :title="item.label" @click="$emit('select', item.value)">
      <ServiceIcon :service="item.value" :label="item.label" size="small" />
      <span class="library-copy"><strong>{{ item.label }}</strong><small v-if="!compact && status">{{ status }}</small></span>
      <span v-if="isDefault" class="library-default">{{ t('settings.services.library.defaultBadge') }}</span>
    </button>

  </div>
</template>
<script setup lang="ts">
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue'
import { useUiI18n } from '@/src/ui/i18n'
import type { ServiceOption } from '@/src/ui/view-model/serviceCatalog'
defineProps<{ item: ServiceOption; selected: boolean; isDefault: boolean; compact?: boolean; status?: string }>()
defineEmits<{ select: [service: string] }>()
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
.compact { border-color: transparent; background: transparent; }
.compact .library-select { min-height: 38px; padding: 3px 4px 3px 8px; gap: 8px; }
button:focus-visible { outline: 2px solid var(--brand-strong, #bd2853); outline-offset: 2px; }

</style>
