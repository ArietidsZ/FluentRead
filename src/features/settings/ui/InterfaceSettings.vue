<!--
 * @file src/features/settings/ui/InterfaceSettings.vue
 * 文件职责：提供 FluentRead 的弹窗风格选择和 Popup 栏目可见性设置，作为“通用设置”中的紧凑偏好分组。
 * 主要内容：从皮肤注册表渲染默认与简约风格选择器，并提供快捷功能栏、当前网站栏目和底部信息栏开关；配置修改直接交给父级 SettingsSections 的统一保存链路。
 * 模块边界：本组件只负责界面配置的展示与双向绑定，不直接读写浏览器存储、不负责主题模式，也不关闭翻译功能本身；界面皮肤由 Options composition root 统一应用。
-->
<template>
  <SettingsGroup
    title="界面与弹窗"
    description="保留熟悉的默认界面，或切换到更轻量的简约界面；也可以只留下常用栏目。"
  >
    <SettingsItem
      label="弹窗风格"
      description="风格只改变扩展界面的呈现，不影响网页翻译效果。"
    >
      <div class="interface-skin-picker" role="radiogroup" aria-label="弹窗风格">
        <button
          v-for="skin in interfaceSkinOptions"
          :key="skin.value"
          class="interface-skin-option"
          :class="{ selected: props.config.interfaceSkin === skin.value }"
          type="button"
          role="radio"
          :aria-checked="props.config.interfaceSkin === skin.value"
          :aria-label="`${skin.label}：${skin.description}`"
          :data-skin="skin.value"
          @click="props.config.interfaceSkin = skin.value"
        >
          <span class="interface-skin-preview" :class="`preview-${skin.value}`" aria-hidden="true">
            <i /><i /><i />
          </span>
          <span class="interface-skin-copy">
            <strong>{{ skin.label }}</strong>
            <small>{{ skin.description }}</small>
          </span>
          <span class="interface-skin-radio" aria-hidden="true"><i /></span>
        </button>
      </div>
    </SettingsItem>

      <SettingsItem
        v-for="item in interfaceVisibilityOptions"
        :key="item.key"
        :label="item.label"
        :description="item.description"
      >
        <el-switch
          v-model="props.config.interfaceVisibility[item.key]"
          class="settings-toggle"
          :aria-label="`显示${item.label}`"
        />
      </SettingsItem>
  </SettingsGroup>
</template>

<script lang="ts" setup>
import type {Config} from '@/src/core/config/model'
import {
  interfaceSkinOptions,
  interfaceVisibilityOptions,
} from '@/src/core/config/interfaceAppearance'
import SettingsGroup from './components/SettingsGroup.vue'
import SettingsItem from './components/SettingsItem.vue'

const props = defineProps<{
  config: Config
}>()
</script>

<style scoped>
.interface-skin-picker {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  width: 100%;
  gap: 7px;
}

.interface-skin-option {
  position: relative;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 14px;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 58px;
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
  border-color: rgba(239, 71, 118, .38);
  background: var(--surface-soft);
}

.interface-skin-option.selected {
  border-color: var(--brand);
  background: var(--brand-soft);
  box-shadow: 0 0 0 2px rgba(239, 71, 118, .08);
}

.interface-skin-preview {
  display: flex;
  width: 34px;
  height: 34px;
  flex-direction: column;
  gap: 4px;
  justify-content: center;
  padding: 6px;
  overflow: hidden;
  border: 1px solid #e1e5ed;
  border-radius: 9px;
  background: #f7f8fb;
}

.interface-skin-preview > i {
  display: block;
  width: 100%;
  height: 3px;
  border-radius: 99px;
  background: #c8ced9;
}

.interface-skin-preview > i:first-child {
  width: 58%;
  background: #ef4776;
}

.preview-minimal {
  border-radius: 6px;
  background: #fff;
}

.preview-minimal > i {
  border-radius: 1px;
  background: #aeb4bf;
}

.preview-minimal > i:first-child {
  background: #313743;
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
  .interface-skin-picker {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
