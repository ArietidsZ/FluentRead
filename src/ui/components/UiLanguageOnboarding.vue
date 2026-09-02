<!--
 * @file src/ui/components/UiLanguageOnboarding.vue
 * 文件职责：承载 FluentRead Popup 首次打开时的一次性界面语言选择引导。
 * 主要内容：以浏览器语言作为初始选项，允许用户在进入真正的 Popup 前调整并确认；确认后由共享 i18n 上下文持久化语言和完成状态。
 * 模块边界：组件只负责首次语言选择的呈现与确认，不读取配置、不决定浏览器 locale 映射；配置保存由 src/ui/i18n.ts 负责，语言规则由 src/core/i18n 提供。
-->
<template>
  <section
    class="language-onboarding"
    data-testid="ui-language-onboarding"
    data-i18n-ignore
    role="dialog"
    aria-modal="true"
    aria-labelledby="language-onboarding-title"
  >
    <div class="language-onboarding-backdrop" aria-hidden="true" />
    <div class="language-onboarding-card">
      <Transition name="onboarding-content" mode="out-in">
        <div v-if="celebrating" key="success" class="onboarding-success">
          <div class="onboarding-success-mark" aria-hidden="true"><span>✓</span></div>
          <span class="eyebrow">{{ message('language.onboardingSuccessEyebrow') }}</span>
          <h1 id="language-onboarding-title">{{ message('language.onboardingSuccessTitle') }}</h1>
          <p>{{ message('language.onboardingSuccessDescription') }}</p>
        </div>

        <div v-else key="setup" class="onboarding-form">
          <div class="onboarding-brand">
            <img src="/icon/128.png" alt="" />
            <strong>{{ message('common.brand') }}</strong>
          </div>

          <div class="onboarding-copy">
            <span class="eyebrow">{{ message('language.onboardingEyebrow') }}</span>
            <h1 id="language-onboarding-title">{{ message('language.onboardingTitle') }}</h1>
            <p>{{ message('language.onboardingDescription') }}</p>
          </div>

          <label class="onboarding-language-field">
            <span>{{ message('language.onboardingLabel') }}</span>
            <select
              ref="languageSelect"
              v-model="selectedLanguage"
              data-testid="onboarding-language-select"
              :aria-label="message('language.onboardingLabel')"
            >
              <option
                v-for="option in UI_LANGUAGE_OPTIONS"
                :key="option.value"
                :value="option.value"
                data-i18n-ignore
              >
                {{ message(option.labelKey) }}
              </option>
            </select>
          </label>

          <p class="onboarding-browser-hint">{{ message('language.onboardingBrowserHint') }}</p>

          <button
            class="onboarding-confirm"
            type="button"
            :disabled="confirming"
            @click="confirm"
          >
            {{ confirming ? message('common.loading') : message('language.onboardingConfirm') }}
          </button>

          <p v-if="errorMessage" class="onboarding-error" role="alert">{{ errorMessage }}</p>
        </div>
      </Transition>
    </div>
  </section>
</template>

<script setup lang="ts">
import {nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {
  UI_LANGUAGE_OPTIONS,
  translate,
  type TranslationParams,
  type UiLanguage,
} from '@/src/core/i18n';
import {useUiI18n} from '@/src/ui/i18n';

const props = defineProps<{
  initialLanguage: UiLanguage;
}>();

const emit = defineEmits<{
  confirmed: [language: UiLanguage];
}>();

const {language, setLanguage} = useUiI18n();
const selectedLanguage = ref<UiLanguage>(props.initialLanguage);
const languageSelect = ref<HTMLSelectElement | null>(null);
const confirming = ref(false);
const celebrating = ref(false);
const errorMessage = ref('');
let transitionTimer: ReturnType<typeof setTimeout> | undefined;

watch(() => props.initialLanguage, value => {
  if (!confirming.value) selectedLanguage.value = value;
});

watch(selectedLanguage, value => {
  document.documentElement.lang = value;
}, {immediate: true});

function message(key: string, params?: TranslationParams): string {
  return translate(key, selectedLanguage.value, params);
}

async function confirm(): Promise<void> {
  if (confirming.value) return;
  confirming.value = true;
  errorMessage.value = '';
  try {
    await setLanguage(selectedLanguage.value);
    celebrating.value = true;
    transitionTimer = setTimeout(() => {
      emit('confirmed', selectedLanguage.value);
    }, 760);
  } catch {
    document.documentElement.lang = language.value;
    errorMessage.value = translate('language.saveFailed', selectedLanguage.value);
  } finally {
    confirming.value = false;
  }
}

onBeforeUnmount(() => {
  if (transitionTimer) clearTimeout(transitionTimer);
});

onMounted(() => {
  void nextTick(() => languageSelect.value?.focus());
});
</script>

<style scoped>
.language-onboarding {
  position: absolute;
  z-index: 20;
  inset: 0;
  display: grid;
  min-height: 100%;
  padding: 14px;
  place-items: center;
  overflow: hidden;
  isolation: isolate;
}

.language-onboarding-backdrop {
  position: absolute;
  z-index: -1;
  inset: 0;
  background: rgba(17, 20, 29, .52);
  backdrop-filter: blur(7px);
  animation: onboarding-backdrop-in 260ms ease-out both;
}

.language-onboarding-card {
  position: relative;
  z-index: 1;
  width: 100%;
  padding: 24px 20px 20px;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--surface);
  box-shadow: 0 16px 36px rgba(27, 36, 57, .1);
  animation: onboarding-card-in 360ms cubic-bezier(.2, .8, .2, 1) both;
}

.language-onboarding-card::before,
.language-onboarding-card::after {
  position: absolute;
  z-index: -1;
  width: 8px;
  height: 18px;
  border-radius: 4px;
  content: '';
  opacity: .8;
  animation: onboarding-confetti 900ms ease-out 120ms both;
}

.language-onboarding-card::before {
  top: 26px;
  left: 12px;
  background: #ef4776;
  box-shadow: 30px -10px #f3bf45, 70px 4px #5f9bf3, 238px -8px #6ac7b9, 280px 18px #ef4776;
  transform: rotate(-22deg);
}

.language-onboarding-card::after {
  right: 18px;
  bottom: 54px;
  background: #6ac7b9;
  box-shadow: -35px 14px #ef4776, -78px -8px #f3bf45, -125px 16px #5f9bf3;
  transform: rotate(24deg);
}

.onboarding-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 34px;
}

.onboarding-brand img {
  width: 42px;
  height: 42px;
  border-radius: 13px;
  box-shadow: 0 8px 18px rgba(239, 71, 118, .2);
}

.onboarding-brand strong {
  color: var(--ink);
  font-size: 17px;
  font-weight: 760;
}

.onboarding-copy .eyebrow {
  margin-bottom: 7px;
}

.onboarding-copy h1 {
  margin: 0 0 8px;
  color: var(--ink);
  font-size: 24px;
  line-height: 1.2;
  letter-spacing: -.025em;
}

.onboarding-copy p,
.onboarding-browser-hint,
.onboarding-error {
  margin: 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.55;
}

.onboarding-language-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin-top: 27px;
  color: var(--ink);
  font-size: 11px;
  font-weight: 700;
}

.onboarding-language-field select {
  width: 100%;
  height: 42px;
  padding: 0 30px 0 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--ink);
  background: var(--surface-soft);
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.onboarding-browser-hint {
  margin-top: 9px;
  font-size: 10px;
}

.onboarding-confirm {
  width: 100%;
  min-height: 42px;
  margin-top: 24px;
  border: 0;
  border-radius: 12px;
  color: #fff;
  background: var(--brand);
  font-size: 12px;
  font-weight: 760;
  cursor: pointer;
  transition: background 160ms ease, transform 160ms ease;
}

.onboarding-confirm:hover:not(:disabled) {
  background: var(--brand-strong);
  transform: translateY(-1px);
}

.onboarding-confirm:disabled {
  cursor: wait;
  opacity: .65;
}

.onboarding-error {
  margin-top: 10px;
  color: #c52f58;
}

.onboarding-success {
  padding: 16px 0 7px;
  text-align: center;
}

.onboarding-success .eyebrow {
  margin-top: 20px;
}

.onboarding-success h1 {
  margin-bottom: 8px;
}

.onboarding-success-mark {
  display: grid;
  width: 70px;
  height: 70px;
  margin: 0 auto;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: linear-gradient(145deg, #ef4776, #dc315f);
  box-shadow: 0 12px 24px rgba(239, 71, 118, .28), 0 0 0 10px rgba(239, 71, 118, .1);
  animation: onboarding-success-pop 600ms cubic-bezier(.2, .8, .2, 1) both;
}

.onboarding-success-mark span {
  font-size: 34px;
  font-weight: 800;
  line-height: 1;
  animation: onboarding-check-in 420ms ease-out 140ms both;
}

.onboarding-content-enter-active,
.onboarding-content-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.onboarding-content-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(.98);
}

.onboarding-content-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(.98);
}

@keyframes onboarding-backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes onboarding-card-in {
  from { opacity: 0; transform: translateY(16px) scale(.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes onboarding-confetti {
  from { opacity: 0; transform: translateY(12px) rotate(0); }
  to { opacity: .8; transform: translateY(0) rotate(24deg); }
}

@keyframes onboarding-success-pop {
  0% { transform: scale(.5) rotate(-12deg); }
  65% { transform: scale(1.08) rotate(3deg); }
  100% { transform: scale(1) rotate(0); }
}

@keyframes onboarding-check-in {
  from { opacity: 0; transform: scale(.4); }
  to { opacity: 1; transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .language-onboarding-backdrop,
  .language-onboarding-card,
  .language-onboarding-card::before,
  .language-onboarding-card::after,
  .onboarding-success-mark,
  .onboarding-success-mark span {
    animation: none;
  }
}
</style>
