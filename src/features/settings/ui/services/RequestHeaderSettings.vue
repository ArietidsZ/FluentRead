<!--
 * @file src/features/settings/ui/services/RequestHeaderSettings.vue
 * 文件职责：在 AI 服务接口兼容区域编辑全局的按域名请求头移除名单。
 * 主要内容：默认空名单、域名校验、独立 Origin/Referer 开关、删除与自动保存；不支持的运行环境提供明确说明。
 * 模块边界：只修改父级配置，由既有配置 store 持久化和后台 DNR 安装；不读取密钥、不直接发起连接测试。
 -->
<template>
  <div class="connection-field" data-testid="request-header-rules">
    <div class="connection-field-label"><strong>{{ t('settings.headers.title') }}</strong></div>
    <div class="connection-field-control">
      <p class="provider-field-help">{{ t('settings.headers.help') }}</p>
      <p v-if="!supported" class="provider-field-help">{{ t('settings.headers.unsupported') }}</p>
      <template v-else>
        <div class="fluentread-header-add">
          <el-input v-model="domain" :aria-label="t('settings.headers.domain')" placeholder="api.example.com" data-testid="request-header-domain" :maxlength="253" @keyup.enter="add" />
          <el-button :disabled="!normalizedDomain || config.requestHeaderRules.length >= MAX_REQUEST_HEADER_RULES" data-testid="request-header-add" @click="add">{{ t('settings.headers.add') }}</el-button>
        </div>
        <p v-if="domain && !normalizedDomain" class="error-text">{{ t('settings.headers.invalid') }}</p>
        <div v-for="rule in config.requestHeaderRules" :key="rule.domain" class="fluentread-header-rule" :data-header-rule-domain="rule.domain">
          <strong>{{ rule.domain }}</strong>
          <div class="fluentread-header-controls">
            <el-checkbox v-model="rule.removeOrigin" :aria-label="t('settings.headers.origin')">{{ t('settings.headers.origin') }}</el-checkbox>
            <el-checkbox v-model="rule.removeReferer" :aria-label="t('settings.headers.referer')">{{ t('settings.headers.referer') }}</el-checkbox>
            <el-button link type="danger" :aria-label="t('settings.headers.removeDomain', {domain: rule.domain})" @click="remove(rule.domain)">{{ t('settings.headers.remove') }}</el-button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
<script setup lang="ts">
import {computed, ref} from 'vue';
import {ElButton, ElCheckbox, ElInput} from 'element-plus';
import 'element-plus/es/components/checkbox/style/css';
import browser from 'webextension-polyfill';
import type {Config} from '@/src/core/config/model';
import {MAX_REQUEST_HEADER_RULES, normalizeRequestHeaderDomain} from '@/src/core/config/requestHeaders';
import {useUiI18n} from '@/src/ui/i18n';
const props = defineProps<{config: Config}>();
const {t} = useUiI18n();
const domain = ref('');
const normalizedDomain = computed(() => normalizeRequestHeaderDomain(domain.value));
const supported = Boolean(browser.declarativeNetRequest?.updateDynamicRules);
function add() {
    const host = normalizedDomain.value;
    if (!host || props.config.requestHeaderRules.length >= MAX_REQUEST_HEADER_RULES) return;
    if (!props.config.requestHeaderRules.some(rule => rule.domain === host)) {
        props.config.requestHeaderRules.push({domain: host, removeOrigin: true, removeReferer: false});
    }
    domain.value = '';
}
function remove(host: string) {
    props.config.requestHeaderRules = props.config.requestHeaderRules.filter(rule => rule.domain !== host);
}
</script>
<style scoped>
.fluentread-header-add, .fluentread-header-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.fluentread-header-add .el-input { flex: 1; min-width: 160px; }
.fluentread-header-rule { margin-top: 12px; padding: 12px; border: 1px solid var(--el-border-color); border-radius: 8px; }
.fluentread-header-rule > strong { display: block; overflow-wrap: anywhere; }
.fluentread-header-controls .el-checkbox { margin-right: 8px; }
</style>
