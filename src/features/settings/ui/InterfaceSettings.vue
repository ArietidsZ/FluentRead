<!--
 * @file src/features/settings/ui/InterfaceSettings.vue
 * 文件职责：提供 FluentRead 的弹窗风格选择和 Popup 栏目可见性设置，作为“通用设置”中的紧凑偏好分组。
 * 主要内容：用随当前选择即时变化的真实 DOM Popup 范例辅助判断，再按效率和氛围两组渲染十套注册皮肤，并提供快捷功能栏、当前网站栏目和底部信息栏开关。
 * 模块边界：本组件只负责界面配置的展示与双向绑定，不直接读写浏览器存储、不负责主题模式，也不关闭翻译功能本身；界面皮肤由 Options composition root 统一应用。
-->
<template>
  <SettingsGroup
    :title="translateLegacy('界面与弹窗')"
    :description="translateLegacy('从效率布局、趣味配色到夜间和护眼方案，选择适合自己的界面；也可以只留下常用栏目。')"
  >
    <SettingsItem
      :label="translateLegacy('弹窗风格')"
      :description="translateLegacy('风格只改变扩展界面的呈现，不影响网页翻译效果。')"
    >
      <template #copy>
        <InterfaceSkinPreview
          :skin="selectedSkinOption"
          :skin-label="translateLegacy(selectedSkinOption.label)"
          :preview-label="`${translateLegacy('弹窗风格')}: ${translateLegacy(selectedSkinOption.label)}`"
        />
      </template>
      <div class="interface-skin-picker" role="radiogroup" :aria-label="translateLegacy('弹窗风格')">
        <div
          v-for="group in groupedSkinOptions"
          :key="group.value"
          class="interface-skin-group"
          role="group"
          :aria-labelledby="`interface-skin-group-${group.value}`"
        >
          <div class="interface-skin-group-heading">
            <strong :id="`interface-skin-group-${group.value}`">{{ translateLegacy(group.label) }}</strong>
            <small>{{ translateLegacy(group.description) }}</small>
          </div>
          <div class="interface-skin-grid">
            <button
              v-for="skin in group.options"
              :key="skin.value"
              class="interface-skin-option"
              :class="{ selected: props.config.interfaceSkin === skin.value }"
              type="button"
              role="radio"
              :aria-checked="props.config.interfaceSkin === skin.value"
              :aria-label="`${translateLegacy(skin.label)}: ${translateLegacy(skin.description)}`"
              :data-skin="skin.value"
              @click="props.config.interfaceSkin = skin.value"
            >
              <span
                class="interface-skin-preview"
                :style="{
                  '--skin-preview-canvas': skin.preview.canvas,
                  '--skin-preview-surface': skin.preview.surface,
                  '--skin-preview-accent': skin.preview.accent,
                  '--skin-preview-ink': skin.preview.ink,
                }"
                aria-hidden="true"
              >
                <i /><i /><i />
              </span>
              <span class="interface-skin-copy">
                <strong>{{ translateLegacy(skin.label) }}</strong>
                <small>{{ translateLegacy(skin.description) }}</small>
              </span>
              <span class="interface-skin-radio" aria-hidden="true"><i /></span>
            </button>
          </div>
        </div>
      </div>
    </SettingsItem>

    <SettingsItem
      v-for="item in interfaceVisibilityOptions"
      :key="item.key"
      :label="translateLegacy(item.label)"
      :description="translateLegacy(item.description)"
    >
      <el-switch
        v-model="props.config.interfaceVisibility[item.key]"
        class="settings-toggle"
        :data-interface-visibility="item.key"
        :aria-label="translateLegacy(item.label)"
      />
    </SettingsItem>
  </SettingsGroup>
</template>

<script lang="ts" setup>
import {computed} from 'vue'
import type {Config} from '@/src/core/config/model'
import {
  getInterfaceSkinOption,
  interfaceSkinGroups,
  interfaceSkinOptions,
  interfaceVisibilityOptions,
} from '@/src/core/config/interfaceAppearance'
import {useUiI18n} from '@/src/ui/i18n'
import InterfaceSkinPreview from './components/InterfaceSkinPreview.vue'
import SettingsGroup from './components/SettingsGroup.vue'
import SettingsItem from './components/SettingsItem.vue'

const props = defineProps<{
  config: Config
}>()
const {translateLegacy} = useUiI18n()
const selectedSkinOption = computed(() => getInterfaceSkinOption(props.config.interfaceSkin))

const groupedSkinOptions = interfaceSkinGroups.map((group) => ({
  ...group,
  options: interfaceSkinOptions.filter((skin) => skin.group === group.value),
}))
</script>

<style scoped>
.interface-skin-picker {
  display: grid;
  width: 100%;
  gap: 12px;
}

.interface-skin-group {
  display: grid;
  gap: 7px;
}

.interface-skin-group-heading {
  display: flex;
  min-width: 0;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  padding: 0 2px;
}

.interface-skin-group-heading strong {
  flex: none;
  color: var(--ink);
  font-size: 9.5px;
}

.interface-skin-group-heading small {
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.interface-skin-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.interface-skin-option {
  position: relative;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) 14px;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 62px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 11px;
  color: var(--ink);
  background: var(--surface);
  text-align: left;
  cursor: pointer;
  transition: border-color 150ms ease, background 150ms ease, box-shadow 150ms ease;
}

.interface-skin-option:hover {
  border-color: var(--brand);
  background: var(--surface-soft);
}

.interface-skin-option.selected {
  border-color: var(--brand);
  background: var(--brand-soft);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--brand) 10%, transparent);
}

.interface-skin-preview {
  display: flex;
  width: 36px;
  height: 38px;
  flex-direction: column;
  gap: 4px;
  justify-content: center;
  padding: 6px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--skin-preview-ink) 18%, transparent);
  border-radius: 9px;
  background: var(--skin-preview-canvas);
}

.interface-skin-preview > i {
  display: block;
  width: 100%;
  height: 5px;
  border-radius: 3px;
  background: var(--skin-preview-surface);
}

.interface-skin-preview > i:first-child {
  width: 48%;
  height: 3px;
  background: var(--skin-preview-ink);
}

.interface-skin-preview > i:last-child {
  width: 72%;
  height: 4px;
  align-self: flex-end;
  background: var(--skin-preview-accent);
}

.interface-skin-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.interface-skin-copy strong {
  font-size: 11.5px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.interface-skin-copy small {
  color: var(--muted);
  font-size: 8.5px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.interface-skin-radio {
  display: grid;
  place-items: center;
  width: 14px;
  height: 14px;
  border: 1px solid #b9c0cd;
  border-radius: 999px;
  background: var(--surface);
}

.interface-skin-option.selected .interface-skin-radio {
  border-color: var(--brand);
  background: var(--brand);
}

.interface-skin-radio > i {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: #fff;
  opacity: 0;
}

.interface-skin-option.selected .interface-skin-radio > i {
  opacity: 1;
}

@media (max-width: 520px) {
  .interface-skin-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .interface-skin-group-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 2px;
  }

  .interface-skin-group-heading small {
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
  }
}
</style>
