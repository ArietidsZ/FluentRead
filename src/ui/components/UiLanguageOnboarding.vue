<!--
 * @file src/ui/components/UiLanguageOnboarding.vue
 * 文件职责：承载 FluentRead Popup 首次打开时的欢迎与界面语言选择引导。
 * 主要内容：先展示多语言欢迎画面，再进入符合 Popup 风格的语言卡片选择；确认后显示成功动效并把控制权交回真正 Popup。
 * 模块边界：组件只负责首次引导的呈现与确认，不读取配置、不决定浏览器 locale 映射；配置保存由 src/ui/i18n.ts 负责，语言规则由 src/core/i18n 提供。
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

        <div v-else-if="step === 'welcome'" key="welcome" class="onboarding-welcome" data-testid="onboarding-welcome">
          <div class="onboarding-brand">
            <img src="/icon/128.png" alt="" />
            <strong>{{ message('common.brand') }}</strong>
          </div>

          <div class="welcome-art" aria-hidden="true">
            <span
              v-for="greeting in WELCOME_GREETING_WORDS"
              :key="greeting"
              class="welcome-word"
            >{{ greeting }}</span>
          </div>

          <div class="onboarding-copy welcome-copy">
            <span class="eyebrow">{{ message('language.onboardingWelcomeEyebrow') }}</span>
            <h1 id="language-onboarding-title">{{ message('language.onboardingWelcomeTitle') }}</h1>
            <p>{{ message('language.onboardingWelcomeDescription') }}</p>
          </div>

          <button
            ref="welcomeNextButton"
            class="onboarding-confirm onboarding-next"
            data-testid="onboarding-language-next"
            type="button"
            @click="goToLanguage"
          >
            <span>{{ message('language.onboardingWelcomeNext') }}</span>
            <span class="onboarding-next-arrow" aria-hidden="true">→</span>
          </button>
        </div>

        <div v-else key="setup" class="onboarding-form" data-testid="onboarding-language-step">
          <button class="onboarding-back" type="button" @click="goToWelcome">
            <span aria-hidden="true">←</span>
            <span>{{ message('language.onboardingBack') }}</span>
          </button>

          <div class="onboarding-copy">
            <span class="eyebrow">{{ message('language.onboardingEyebrow') }}</span>
            <h1 id="language-onboarding-title">{{ message('language.onboardingTitle') }}</h1>
            <p>{{ message('language.onboardingDescription') }}</p>
          </div>

          <div class="onboarding-language-field">
            <span class="onboarding-field-label">{{ message('language.onboardingLabel') }}</span>
            <div
              class="onboarding-language-options"
              role="radiogroup"
              :aria-label="message('language.onboardingLabel')"
            >
              <button
                v-for="(option, index) in UI_LANGUAGE_OPTIONS"
                :key="option.value"
                ref="languageOptionButtons"
                class="onboarding-language-option"
                :class="{ selected: selectedLanguage === option.value }"
                type="button"
                role="radio"
                :aria-checked="selectedLanguage === option.value"
                :data-language="option.value"
                @click="selectedLanguage = option.value"
              >
                <span class="onboarding-language-name">{{ getUiLanguageDisplayLabel(option.value, selectedLanguage) }}</span>
                <span class="onboarding-language-code">{{ option.value }}</span>
                <span v-if="index === 0" class="onboarding-language-note">{{ message('language.onboardingRecommended') }}</span>
                <span class="onboarding-language-check" aria-hidden="true">✓</span>
              </button>
            </div>
          </div>

          <p class="onboarding-browser-hint">{{ message('language.onboardingBrowserHint') }}</p>

          <div class="onboarding-confirm-guide" aria-hidden="true">
            <span>{{ message('language.onboardingConfirmHint') }}</span>
            <span class="onboarding-guide-arrow">↘</span>
          </div>

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
  getUiLanguageDisplayLabel,
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
const WELCOME_GREETING_WORDS = [
  '你好',
  'Welcome',
  'こんにちは',
  '안녕하세요',
  'Bonjour',
  'Привет',
  'Hola',
  'Hallo',
  'Olá',
  'Ciao',
] as const;
type OnboardingStep = 'welcome' | 'language';
const selectedLanguage = ref<UiLanguage>(props.initialLanguage);
const step = ref<OnboardingStep>('welcome');
const welcomeNextButton = ref<HTMLButtonElement | null>(null);
const languageOptionButtons = ref<HTMLButtonElement[]>([]);
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

function focusCurrentStep(): void {
  void nextTick(() => {
    if (step.value === 'welcome') welcomeNextButton.value?.focus();
    else languageOptionButtons.value[0]?.focus();
  });
}

function goToLanguage(): void {
  if (confirming.value || celebrating.value) return;
  step.value = 'language';
  focusCurrentStep();
}

function goToWelcome(): void {
  if (confirming.value || celebrating.value) return;
  step.value = 'welcome';
  focusCurrentStep();
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
    }, 1200);
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

watch(step, focusCurrentStep);
onMounted(focusCurrentStep);
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
  padding: 20px 18px 18px;
  border: 1px solid var(--line);
  border-radius: 24px;
  background: var(--surface);
  box-shadow: 0 16px 36px rgba(27, 36, 57, .1);
  animation: onboarding-card-in 360ms cubic-bezier(.2, .8, .2, 1) both;
}

.onboarding-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
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

.welcome-art {
  position: relative;
  height: 142px;
  margin: 0 -4px 20px;
  border: 1px solid rgba(239, 71, 118, .12);
  border-radius: 22px;
  background:
    radial-gradient(circle at 18% 30%, rgba(239, 71, 118, .18), transparent 24%),
    radial-gradient(circle at 82% 70%, rgba(95, 155, 243, .16), transparent 28%),
    linear-gradient(135deg, var(--brand-soft), var(--surface-soft));
  overflow: hidden;
}

.welcome-art::before,
.welcome-art::after {
  position: absolute;
  border-radius: 50%;
  content: '';
  opacity: .5;
}

.welcome-art::before {
  top: -32px;
  right: 18px;
  width: 88px;
  height: 88px;
  border: 1px solid rgba(243, 191, 69, .48);
}

.welcome-art::after {
  bottom: -42px;
  left: 42px;
  width: 104px;
  height: 104px;
  border: 1px solid rgba(106, 199, 185, .42);
}

.welcome-word {
  position: absolute;
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 5px 10px;
  border: 1px solid rgba(255, 255, 255, .7);
  border-radius: 999px;
  color: var(--ink);
  background: rgba(255, 255, 255, .7);
  box-shadow: 0 7px 16px rgba(31, 40, 61, .08);
  font-size: 11px;
  font-weight: 760;
  white-space: nowrap;
  animation: onboarding-word-float 3.8s ease-in-out infinite;
}

.welcome-word:nth-child(1) { top: 16px; left: 12px; color: #db3865; transform: rotate(-9deg); }
.welcome-word:nth-child(2) { top: 12px; left: 116px; animation-delay: -.7s; transform: rotate(5deg); }
.welcome-word:nth-child(3) { top: 54px; left: 44px; animation-delay: -1.4s; transform: rotate(7deg); }
.welcome-word:nth-child(4) { top: 48px; right: 20px; color: #567ed2; animation-delay: -2.1s; transform: rotate(-7deg); }
.welcome-word:nth-child(5) { right: 98px; bottom: 14px; color: #a37b0e; animation-delay: -.3s; transform: rotate(5deg); }
.welcome-word:nth-child(6) { bottom: 20px; left: 10px; color: #657080; animation-delay: -1.8s; transform: rotate(-5deg); }
.welcome-word:nth-child(7) { top: 84px; left: 150px; color: #d63868; animation-delay: -2.7s; transform: rotate(-3deg); }
.welcome-word:nth-child(8) { top: 80px; right: 90px; color: #4a9d91; animation-delay: -1.1s; transform: rotate(8deg); }
.welcome-word:nth-child(9) { right: 10px; bottom: 16px; color: #597fcc; animation-delay: -2.4s; transform: rotate(-6deg); }
.welcome-word:nth-child(10) { bottom: 50px; left: 94px; color: #bb6f45; animation-delay: -.9s; transform: rotate(6deg); }

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

.welcome-copy h1 {
  font-size: 26px;
}

.onboarding-copy p,
.onboarding-browser-hint,
.onboarding-error {
  margin: 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.55;
}

.welcome-copy p {
  max-width: 280px;
}

.onboarding-confirm {
  width: 100%;
  min-height: 42px;
  margin-top: 0;
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

.onboarding-next {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 20px;
  padding: 0 15px 0 17px;
  text-align: left;
}

.onboarding-next-arrow {
  font-size: 22px;
  line-height: 1;
  animation: onboarding-arrow-nudge 1.15s ease-in-out infinite;
}

.onboarding-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: -2px 0 18px;
  padding: 0;
  border: 0;
  color: var(--muted);
  background: transparent;
  font-size: 10px;
  cursor: pointer;
}

.onboarding-back:hover {
  color: var(--brand-strong);
}

.onboarding-language-field {
  margin-top: 22px;
}

.onboarding-field-label {
  display: block;
  margin: 0 0 8px 3px;
  color: var(--ink);
  font-size: 11px;
  font-weight: 750;
}

.onboarding-language-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.onboarding-language-option {
  position: relative;
  display: grid;
  min-height: 48px;
  padding: 8px 27px 7px 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--ink);
  background: var(--surface-soft);
  text-align: left;
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease, box-shadow 160ms ease;
}

.onboarding-language-option:hover {
  border-color: rgba(239, 71, 118, .42);
  transform: translateY(-1px);
}

.onboarding-language-option.selected {
  border-color: var(--brand);
  background: var(--brand-soft);
  box-shadow: 0 0 0 3px rgba(239, 71, 118, .1);
}

.onboarding-language-name {
  font-size: 12px;
  font-weight: 760;
  line-height: 1.3;
}

.onboarding-language-code {
  margin-top: 2px;
  color: var(--muted);
  font-size: 9px;
  line-height: 1.2;
}

.onboarding-language-note {
  position: absolute;
  right: 26px;
  bottom: 7px;
  color: var(--brand-strong);
  font-size: 8px;
  font-weight: 700;
}

.onboarding-language-check {
  position: absolute;
  top: 50%;
  right: 9px;
  display: grid;
  width: 16px;
  height: 16px;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 50%;
  color: transparent;
  background: var(--surface);
  font-size: 10px;
  font-weight: 800;
  transform: translateY(-50%);
}

.onboarding-language-option.selected .onboarding-language-check {
  border-color: var(--brand);
  color: #fff;
  background: var(--brand);
}

.onboarding-browser-hint {
  margin-top: 9px;
  font-size: 10px;
}

.onboarding-confirm-guide {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-height: 34px;
  margin-top: 10px;
  margin-bottom: 0;
  color: var(--brand-strong);
  font-size: 10px;
  font-weight: 760;
}

.onboarding-guide-arrow {
  font-size: 27px;
  line-height: .8;
  transform: rotate(8deg);
  animation: onboarding-point 1.05s ease-in-out infinite;
}

.onboarding-error {
  margin-top: 10px;
  color: #c52f58;
}

.onboarding-success {
  position: relative;
  min-height: 216px;
  padding: 20px 0 7px;
  text-align: center;
  overflow: hidden;
}

.onboarding-success::before,
.onboarding-success::after {
  position: absolute;
  z-index: 0;
  width: 8px;
  height: 18px;
  border-radius: 4px;
  content: '';
  opacity: .8;
  animation: onboarding-confetti 900ms ease-out 120ms both;
}

.onboarding-success::before {
  top: 26px;
  left: 12px;
  background: #ef4776;
  box-shadow: 30px -10px #f3bf45, 70px 4px #5f9bf3, 238px -8px #6ac7b9, 280px 18px #ef4776;
  transform: rotate(-22deg);
}

.onboarding-success::after {
  right: 18px;
  bottom: 54px;
  background: #6ac7b9;
  box-shadow: -35px 14px #ef4776, -78px -8px #f3bf45, -125px 16px #5f9bf3;
  transform: rotate(24deg);
}

.onboarding-success .eyebrow {
  position: relative;
  z-index: 1;
  margin-top: 20px;
}

.onboarding-success h1 {
  position: relative;
  z-index: 1;
  margin: 0 0 8px;
  color: var(--ink);
  font-size: 24px;
  line-height: 1.2;
}

.onboarding-success p {
  position: relative;
  z-index: 1;
  margin: 0;
  color: var(--muted);
  font-size: 11px;
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
  position: relative;
  z-index: 1;
  display: block;
  font-size: 34px;
  font-weight: 800;
  line-height: 1;
  animation: onboarding-check-in 420ms ease-out both;
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

@keyframes onboarding-word-float {
  0%, 100% { translate: 0 0; }
  50% { translate: 0 -4px; }
}

@keyframes onboarding-arrow-nudge {
  0%, 100% { translate: 0 0; }
  50% { translate: 4px 0; }
}

@keyframes onboarding-point {
  0%, 100% { translate: 0 0; rotate: 0deg; }
  50% { translate: 4px 4px; rotate: 8deg; }
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

@media (max-width: 360px) {
  .language-onboarding { padding: 10px; }
  .language-onboarding-card { padding-right: 14px; padding-left: 14px; }
  .welcome-art { height: 132px; }
  .onboarding-language-options { gap: 5px; }
  .onboarding-language-option { padding-right: 24px; padding-left: 8px; }
  .onboarding-language-code { font-size: 8px; }
}

@media (prefers-reduced-motion: reduce) {
  .language-onboarding-backdrop,
  .language-onboarding-card,
  .onboarding-success::before,
  .onboarding-success::after,
  .onboarding-success-mark,
  .onboarding-success-mark span,
  .welcome-word,
  .onboarding-next-arrow,
  .onboarding-guide-arrow {
    animation: none;
  }
}
</style>
