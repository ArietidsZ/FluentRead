<!--
 * @file src/features/settings/ui/InterfaceSettings.vue
 * 文件职责：提供 FluentRead 的界面皮肤选择和 Popup 栏目可见性设置，作为“界面设置”导航分区的业务 UI。
 * 主要内容：展示可扩展皮肤卡片、简约风格预览以及快捷功能栏、当前网站栏目和底部信息栏开关；配置修改直接交给父级 SettingsSections 的统一保存链路。
 * 模块边界：本组件只负责界面配置的展示与双向绑定，不直接读写浏览器存储、不负责主题模式，也不关闭翻译功能本身；界面皮肤由 Options composition root 统一应用。
-->
<template>
  <div class="interface-settings-content">
    <SettingsGroup
      title="界面皮肤"
      description="默认风格保留当前界面；选择其他皮肤只改变扩展页面的布局装饰，不影响网页翻译效果。"
    >
      <div class="interface-skin-picker" role="radiogroup" aria-label="界面皮肤">
        <button
          v-for="skin in interfaceSkinOptions"
          :key="skin.value"
          class="interface-skin-card"
          :class="{ selected: props.config.interfaceSkin === skin.value }"
          type="button"
          role="radio"
          :aria-checked="props.config.interfaceSkin === skin.value"
          :data-skin="skin.value"
          @click="props.config.interfaceSkin = skin.value"
        >
          <span class="interface-skin-preview" :class="`preview-${skin.value}`" aria-hidden="true">
            <span class="preview-header"><i /><b /></span>
            <span class="preview-hero"><i /><i /></span>
            <span class="preview-features"><i /><i /><i /></span>
          </span>
          <span class="interface-skin-copy">
            <strong>{{ skin.label }}</strong>
            <small>{{ skin.description }}</small>
          </span>
          <span v-if="props.config.interfaceSkin === skin.value" class="interface-skin-check" aria-hidden="true">✓</span>
        </button>
      </div>
    </SettingsGroup>

    <SettingsGroup
      title="弹窗栏目"
      description="关闭后只隐藏工具栏 Popup 中对应的栏目，不会停用相关翻译能力；需要时可以随时恢复。"
    >
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

    <p class="interface-settings-note" role="note">
      皮肤和栏目设置会同步应用到 Popup；后续新增皮肤或可选栏目时，也会沿用这里的配置入口。
    </p>
  </div>
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
.interface-settings-content {
  width: min(100%, 1080px);
  margin: 0 auto;
}

.interface-skin-picker {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 16px;
}

.interface-skin-card {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 16px;
  color: var(--ink);
  background: var(--surface);
  text-align: left;
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}

.interface-skin-card:hover {
  border-color: rgba(239, 71, 118, .38);
  background: var(--surface-soft);
  transform: translateY(-1px);
}

.interface-skin-card.selected {
  border-color: var(--brand);
  background: var(--brand-soft);
  box-shadow: 0 8px 20px rgba(239, 71, 118, .1);
}

.interface-skin-preview {
  display: grid;
  grid-column: 1 / -1;
  gap: 7px;
  min-height: 104px;
  padding: 11px;
  overflow: hidden;
  border: 1px solid #e7e9f0;
  border-radius: 12px;
  background: #f7f8fb;
}

.interface-skin-preview > span {
  display: flex;
  align-items: center;
}

.preview-header {
  justify-content: space-between;
}

.preview-header i {
  width: 42px;
  height: 7px;
  border-radius: 99px;
  background: #ef4776;
  opacity: .82;
}

.preview-header b {
  width: 20px;
  height: 7px;
  border-radius: 99px;
  background: #d9dde7;
}

.preview-hero {
  gap: 7px;
  height: 37px;
  padding: 7px;
  border: 1px solid #e4e7ef;
  border-radius: 9px;
  background: #fff;
}

.preview-hero i:first-child {
  width: 42%;
  height: 8px;
  border-radius: 99px;
  background: #263044;
  opacity: .78;
}

.preview-hero i:last-child {
  width: 22%;
  height: 18px;
  margin-left: auto;
  border-radius: 99px;
  background: #ef4776;
  opacity: .78;
}

.preview-features {
  gap: 5px;
}

.preview-features i {
  flex: 1;
  height: 20px;
  border: 1px solid #e0e4ed;
  border-radius: 6px;
  background: #fff;
}

.preview-minimal {
  gap: 6px;
  border-color: #e0e3e9;
  border-radius: 8px;
  background: #f4f5f7;
}

.preview-minimal .preview-header i {
  width: 34px;
  height: 6px;
  background: #303641;
}

.preview-minimal .preview-hero {
  border-color: #dfe2e8;
  border-radius: 6px;
  background: transparent;
}

.preview-minimal .preview-hero i:last-child {
  width: 18%;
  height: 14px;
  border-radius: 5px;
  background: #303641;
}

.preview-minimal .preview-features i {
  border-color: #dfe2e8;
  border-radius: 4px;
  background: #fafafa;
}

.interface-skin-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.interface-skin-copy strong {
  font-size: 13px;
}

.interface-skin-copy small {
  color: var(--muted);
  font-size: 10.5px;
  line-height: 1.5;
}

.interface-skin-check {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  color: #fff;
  background: var(--brand);
  font-size: 14px;
  font-weight: 800;
}

.interface-settings-note {
  width: min(100%, 1080px);
  margin: -4px auto 20px;
  padding: 10px 14px;
  border: 1px solid rgba(239, 71, 118, .16);
  border-radius: 12px;
  color: var(--muted);
  background: var(--brand-soft);
  font-size: 10.5px;
  line-height: 1.55;
}

@media (max-width: 700px) {
  .interface-skin-picker {
    grid-template-columns: minmax(0, 1fr);
    padding: 12px;
  }
}
</style>
