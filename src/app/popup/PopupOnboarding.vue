<!--
 * @file src/app/popup/PopupOnboarding.vue
 * 文件职责：作为 Popup 首启专用根组件，展示引导并在语言确认后接入完整主菜单。
 * 主要内容：复用共享配置、语言选择和主题字体；保存成功后预加载主菜单，成功反馈结束再切换，加载失败可重试。
 * 模块边界：不读取当前标签页、不实现主菜单交互、不另存配置；主菜单仅通过动态 import 加载，持久化仍由共享 i18n/config store 负责。
-->
<template>
  <component :is="mainApp" v-if="mainApp" />
  <main v-else class="popup-shell language-onboarding-shell" data-config-ready="true" :data-interface-skin="config.interfaceSkin">
    <UiLanguageOnboarding
      :initial-language="initialLanguage"
      @saved="prepareMain"
      @confirmed="openMain"
    />
    <div v-if="loadFailed" class="onboarding-load-error" role="alert" data-i18n-ignore>
      <p>{{ onboardingLoadError['zh-CN'] }}<br />{{ onboardingLoadError['en-US'] }}</p>
      <button type="button" @click="reloadMain">{{ onboardingChineseMessages['common.retry'] }} / {{ onboardingEnglishMessages['common.retry'] }}</button>
    </div>
  </main>
</template>

<script setup lang="ts">
import {onBeforeUnmount, ref, shallowRef, type Component} from 'vue';
import browser from 'webextension-polyfill';
import {config, subscribeConfig} from '@/src/services/config/store';
import {resolveUiLanguageFromLocale} from '@/src/core/i18n/language';
import {onboardingChineseMessages, onboardingEnglishMessages, onboardingLoadError} from '@/src/core/i18n/messages/onboarding';
import {applyInterfaceSkin, applyInterfaceFont, applyInterfaceTheme} from '@/src/ui/interfaceAppearance';
import UiLanguageOnboarding from '@/src/ui/components/UiLanguageOnboarding.vue';

const initialLanguage = resolveUiLanguageFromLocale(readLocale());
const mainApp = shallowRef<Component | null>(null);
const loadFailed = ref(false);
const darkMode = matchMedia('(prefers-color-scheme: dark)');
let pendingMain: Promise<Component> | undefined;
let disposed = false;

function readLocale(): unknown {
  try {
    return browser.i18n.getUILanguage() || navigator.languages?.[0] || navigator.language;
  } catch {
    return navigator.languages?.[0] || navigator.language;
  }
}

function applyAppearance(): void {
  if (mainApp.value) return;
  applyInterfaceSkin(config.interfaceSkin);
  applyInterfaceFont(config.interfaceFont);
  applyInterfaceTheme(config.theme === 'dark' || (config.theme === 'auto' && darkMode.matches));
}
applyAppearance();
const unsubscribe = subscribeConfig(applyAppearance);
darkMode.addEventListener('change', applyAppearance);

function loadMain(): Promise<Component> {
  return pendingMain ??= import('./PopupApp.vue').then(module => module.default).catch(error => {
    pendingMain = undefined;
    throw error;
  });
}
function prepareMain(): void {
  void loadMain().catch(() => {});
}
async function openMain(): Promise<void> {
  loadFailed.value = false;
  try {
    const app = await loadMain();
    if (!disposed) mainApp.value = app;
  } catch {
    if (!disposed) loadFailed.value = true;
  }
}
function reloadMain(): void {
  // 浏览器会缓存失败的模块 import；重开文档才能重新加载，已保存的语言由正常入口恢复。
  location.reload();
}
onBeforeUnmount(() => {
  disposed = true;
  unsubscribe();
  darkMode.removeEventListener('change', applyAppearance);
});
</script>

<style scoped>
.onboarding-load-error { padding: 0 20px 16px; color: var(--muted); font-size: 12px; }
.onboarding-load-error p { margin: 0 0 8px; }
.onboarding-load-error button { padding: 6px 12px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink); background: var(--surface); cursor: pointer; }
</style>
