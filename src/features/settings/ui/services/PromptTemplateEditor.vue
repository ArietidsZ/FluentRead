<!--
 * @file src/features/settings/ui/services/PromptTemplateEditor.vue
 * 文件职责：为 AI 翻译服务提供统一的 system/user 提示词编辑器，并把可用模板变量变成可点击插入的快捷操作。
 * 主要内容：渲染角色提示词编辑器，保留光标和选区；输入法组合结束后才提交最终值，并支持点击 {{to}}、{{origin}} 按钮插入变量。
 * 模块边界：组件只管理编辑器展示、光标位置和 update:modelValue 事件，不解释翻译协议、不保存配置；父级 ServiceConfiguration 负责服务映射与持久化。
 -->
<template>
  <section
    class="prompt-template-field"
    role="group"
    :data-testid="`prompt-editor-${role}`"
    :data-prompt-role="role"
    :aria-labelledby="headingId"
  >
    <header class="prompt-template-header">
      <div class="prompt-template-role">
        <span class="prompt-role-badge" aria-hidden="true">{{ role }}</span>
        <div class="prompt-role-copy">
          <strong :id="headingId">{{ definition.title }}</strong>
          <small>{{ definition.description }}</small>
        </div>
      </div>
      <span class="prompt-template-limit">最多 {{ maxLength }} 字符</span>
    </header>

    <textarea
      ref="textarea"
      class="prompt-template-textarea"
      :value="modelValue"
      :aria-label="`${role} 提示词`"
      :maxlength="maxLength"
      :placeholder="definition.placeholder"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      rows="6"
      @click="rememberSelection"
      @focus="rememberSelection"
      @input="handleInput"
      @compositionstart="handleCompositionStart"
      @compositionend="handleCompositionEnd"
      @keyup="rememberSelection"
      @mouseup="rememberSelection"
      @select="rememberSelection"
    />

    <footer v-if="promptTokens.length" class="prompt-template-footer">
      <span class="prompt-template-hint">快速插入变量</span>
      <div class="prompt-token-list" aria-label="可插入的提示词变量">
        <button
          v-for="token in promptTokens"
          :key="token.value"
          type="button"
          class="prompt-token"
          :data-prompt-token="token.value"
          :aria-label="`插入 ${token.value}（${token.label}）`"
          @mousedown.prevent
          @click="insertToken(token.value)"
        >
          <code>{{ token.value }}</code>
          <span>{{ token.label }}</span>
        </button>
      </div>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'

type PromptRole = 'system' | 'user'

const props = withDefaults(defineProps<{
  role: PromptRole
  modelValue: string
  maxLength?: number
}>(), {
  maxLength: 8192,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const textarea = ref<HTMLTextAreaElement | null>(null)
const selection = ref({start: props.modelValue.length, end: props.modelValue.length})
const isComposing = ref(false)
const lastEmittedValue = ref(props.modelValue)
const headingId = `fluentread-${props.role}-prompt-${useId()}`

watch(() => props.modelValue, (value) => {
  if (!isComposing.value) lastEmittedValue.value = value
}, {flush: 'sync'})

const promptTokens = computed(() => props.role === 'user'
  ? [
      {value: '{{to}}', label: '目标语言'},
      {value: '{{origin}}', label: '待翻译原文'},
    ] as const
  : [])

const definition = computed(() => props.role === 'system'
  ? {
      title: '系统提示词',
      description: '定义翻译角色、语气与输出规则。',
      placeholder: '例如：You are a professional translator.',
    }
  : {
      title: '用户提示词',
      description: '描述翻译任务，可引用原文和目标语言。',
      placeholder: '例如：Translate {{origin}} into {{to}}.',
    })

function rememberSelection(): void {
  const input = textarea.value
  if (!input) return
  selection.value = {
    start: input.selectionStart,
    end: input.selectionEnd,
  }
}

function handleInput(event: Event): void {
  const input = event.currentTarget
  if (!(input instanceof HTMLTextAreaElement)) return
  if ((event as InputEvent).isComposing === true) {
    isComposing.value = true
    rememberSelection()
    return
  }
  if (isComposing.value) {
    rememberSelection()
    return
  }
  if (input.value === props.modelValue || input.value === lastEmittedValue.value) {
    rememberSelection()
    return
  }
  lastEmittedValue.value = input.value
  emit('update:modelValue', input.value)
  rememberSelection()
}

function handleCompositionStart(): void {
  isComposing.value = true
}

function handleCompositionEnd(event: CompositionEvent): void {
  isComposing.value = false
  handleInput(event)
}

function insertToken(token: string): void {
  const input = textarea.value
  const value = props.modelValue
  const start = Math.max(0, Math.min(selection.value.start, value.length))
  const end = Math.max(start, Math.min(selection.value.end, value.length))
  const nextValue = `${value.slice(0, start)}${token}${value.slice(end)}`
  lastEmittedValue.value = nextValue
  emit('update:modelValue', nextValue)

  void nextTick(() => {
    const cursor = start + token.length
    input?.focus({preventScroll: true})
    input?.setSelectionRange(cursor, cursor)
    rememberSelection()
  })
}
</script>

<style scoped>
.prompt-template-field {
  display: grid;
  gap: 0;
  padding: 15px 16px 13px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface-soft);
  transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;
}

.prompt-template-field:hover {
  border-color: #efb5c5;
  background: var(--surface);
  box-shadow: 0 8px 22px rgba(31, 40, 61, .045);
}

.prompt-template-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.prompt-template-role {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  min-width: 0;
}

.prompt-role-badge {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  min-width: 58px;
  min-height: 27px;
  padding: 3px 8px;
  border: 1px solid #f2c4d1;
  border-radius: 8px;
  color: var(--brand-strong);
  background: var(--brand-soft);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  font-weight: 750;
  letter-spacing: .01em;
}

.prompt-role-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.prompt-role-copy strong {
  color: var(--ink);
  font-size: 12.5px;
  font-weight: 700;
  line-height: 1.45;
}

.prompt-role-copy small,
.prompt-template-limit,
.prompt-template-hint {
  color: var(--muted);
  font-size: 10.5px;
  line-height: 1.5;
}

.prompt-template-limit {
  flex: 0 0 auto;
  padding-top: 4px;
}

.prompt-template-textarea {
  display: block;
  width: 100%;
  min-height: 132px;
  margin-top: 12px;
  padding: 12px 13px;
  border: 1px solid #dfe4ed;
  border-radius: 13px;
  color: var(--ink);
  background: var(--surface);
  box-shadow: 0 1px 2px rgba(31, 40, 61, .035);
  outline: none;
  resize: vertical;
  font-family: Inter, "SF Mono", ui-monospace, Menlo, monospace;
  font-size: 13px;
  line-height: 1.65;
  transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
}

.prompt-template-textarea:hover {
  border-color: #ef9ab1;
}

.prompt-template-textarea:focus {
  border-color: var(--brand);
  background: var(--surface);
  box-shadow: 0 0 0 4px rgba(239, 71, 118, .1);
}

.prompt-template-textarea::placeholder { color: #8992a5; }

.prompt-template-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
}

.prompt-token-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.prompt-token {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 29px;
  padding: 4px 8px;
  border: 1px solid #e4d3da;
  border-radius: 8px;
  color: var(--ink);
  background: var(--surface);
  cursor: pointer;
  transition: border-color 160ms ease, color 160ms ease, background 160ms ease, transform 160ms ease;
}

.prompt-token:hover {
  border-color: #ef9ab1;
  color: var(--brand-strong);
  background: var(--brand-soft);
  transform: translateY(-1px);
}

.prompt-token:focus-visible {
  outline: 3px solid rgba(239, 71, 118, .18);
  outline-offset: 2px;
}

.prompt-token code {
  color: var(--brand-strong);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  font-weight: 750;
}

.prompt-token span {
  color: var(--muted);
  font-size: 10px;
}

:global(:root.dark) .prompt-template-field:hover { border-color: rgba(255, 138, 171, .42); }
:global(:root.dark) .prompt-role-badge { border-color: rgba(255, 138, 171, .36); }
:global(:root.dark) .prompt-template-textarea { border-color: var(--line); }
:global(:root.dark) .prompt-token { border-color: var(--line); }

@media (max-width: 700px) {
  .prompt-template-header,
  .prompt-template-footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .prompt-template-limit { padding-top: 0; }
  .prompt-template-textarea { min-height: 150px; }
  .prompt-token-list { justify-content: flex-start; }
}
</style>
