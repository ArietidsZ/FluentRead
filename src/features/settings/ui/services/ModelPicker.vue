<!--
 * @file src/features/settings/ui/services/ModelPicker.vue
 * 文件职责：为翻译服务提供紧凑、有界的模型选择与自定义模型增删界面。
 * 主要内容：使用 Teleport 弹层搜索和选择模型，以局部草稿提交新增模型，并为可删除模型提供独立操作。
 * 模块边界：组件只发出选择、添加和删除事件，不直接修改 Config 或持久化数据；模型容量和规范化由 core/config 负责。
 -->
<template>
  <div class="model-picker" data-testid="model-picker" @keydown.esc.stop="closePicker">
    <ElPopover
      :key="pickerContentKey"
      v-model:visible="pickerOpen"
      placement="bottom-start"
      trigger="click"
      transition="model-picker-instant"
      :width="440"
      :teleported="true"
      :persistent="false"
      popper-class="model-picker-popper"
    >
      <template #reference>
        <button
          ref="pickerTrigger"
          type="button"
          class="model-picker-trigger"
          data-testid="model-picker-trigger"
          aria-haspopup="dialog"
          :aria-expanded="pickerOpen"
          :aria-label="`选择模型，当前模型：${selectedModel || '未选择'}`"
        >
          <span>
            <strong :title="selectedModel || '未选择模型'">{{ selectedModel || '未选择模型' }}</strong>
            <small>{{ options.length }} 个模型，点击切换</small>
          </span>
          <b aria-hidden="true">⌄</b>
        </button>
      </template>

      <section class="model-picker-panel" role="dialog" aria-label="选择模型" @keydown.esc.stop="closePicker">
        <header class="model-picker-heading">
          <div>
            <strong>选择模型</strong>
            <small>{{ options.length }} 个可用模型</small>
          </div>
          <button
            type="button"
            class="model-add-button"
            data-testid="add-custom-model"
            :disabled="addDisabled"
            :aria-describedby="addDisabled ? limitDescriptionId : undefined"
            @click="beginAddModel"
          >
            + 添加模型
          </button>
        </header>

        <p v-if="addDisabled" :id="limitDescriptionId" class="model-limit" data-testid="custom-model-limit" role="status">
          已达到 {{ maximumModels }} 个模型上限
        </p>

        <form v-if="addingModel" class="model-add-form" data-testid="custom-model-form" @submit.prevent="submitModel">
          <label :for="modelInputId">模型标识</label>
          <div>
            <input
              :id="modelInputId"
              ref="modelInput"
              v-model="modelDraft"
              type="text"
              autocomplete="off"
              spellcheck="false"
              data-testid="custom-model-input"
              placeholder="例如：gpt-4.1-mini"
              :maxlength="maximumModelLength"
              :aria-invalid="Boolean(modelError)"
              :aria-describedby="modelError ? modelErrorId : undefined"
              @input="modelError = ''"
              @keydown.esc.prevent.stop="cancelAddModel"
            />
            <button type="submit" data-testid="custom-model-submit">添加</button>
            <button type="button" class="plain-button" @click="cancelAddModel">取消</button>
          </div>
          <p v-if="modelError" :id="modelErrorId" class="model-error" role="alert">{{ modelError }}</p>
        </form>

        <label class="model-picker-search">
          <span class="sr-only">搜索模型</span>
          <span aria-hidden="true">⌕</span>
          <input v-model.trim="query" type="search" aria-label="搜索模型" placeholder="搜索模型" />
        </label>

        <div v-if="filteredOptions.length" class="model-picker-list" aria-label="可用模型">
          <div
            v-for="option in filteredOptions"
            :key="option.value"
            class="model-picker-chip"
            :class="{ active: selectedModel === option.value }"
            :data-model-id="option.value"
          >
            <button
              type="button"
              class="model-picker-option"
              :aria-pressed="selectedModel === option.value"
              :title="option.value"
              @click="selectModel(option.value)"
            >
              <strong>{{ option.label || option.value }}</strong>
              <span v-if="selectedModel === option.value" class="model-check" aria-hidden="true">✓</span>
            </button>
            <button
              v-if="option.removable"
              type="button"
              class="model-remove-button"
              :aria-label="`删除模型 ${option.label || option.value}`"
              :data-testid="`remove-custom-model-${option.value}`"
              @click.stop="removeModel(option.value)"
            >
              ×
            </button>
          </div>
        </div>
        <p v-else class="model-picker-empty" role="status">没有匹配的模型</p>
      </section>
    </ElPopover>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import {ElPopover} from 'element-plus'
import {CUSTOM_OPENAI_RESERVED_MODEL_ID} from '@/src/core/config/customOpenAI'

interface ModelPickerOption {
  value: string
  label?: string
  removable?: boolean
}

const props = withDefaults(defineProps<{
  options: ModelPickerOption[]
  selectedModel?: string
  maximumModels?: number
  maximumModelLength?: number
  customModelCount?: number
}>(), {
  selectedModel: '',
  maximumModels: 50,
  maximumModelLength: 256,
  customModelCount: 0,
})

const emit = defineEmits<{
  select: [value: string]
  add: [value: string]
  remove: [value: string]
}>()

const pickerOpen = ref(false)
const addingModel = ref(false)
const query = ref('')
const modelDraft = ref('')
const modelError = ref('')
const modelInput = ref<HTMLInputElement | null>(null)
const pickerTrigger = ref<HTMLButtonElement | null>(null)
const modelInputId = `model-input-${useId()}`
const modelErrorId = `model-error-${useId()}`
const limitDescriptionId = `model-limit-${useId()}`

const filteredOptions = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  if (!keyword) return props.options
  return props.options.filter((option) => `${option.label || ''}${option.value}`.toLocaleLowerCase().includes(keyword))
})
// Element Plus caches the teleported slot while open. Remount the popover when
// the parent's saved option list changes so a removed model cannot survive in DOM.
const pickerContentKey = computed(() => props.options
  .map((option) => `${option.value}\u0000${option.label || ''}\u0000${option.removable ? '1' : '0'}`)
  .join('\u0001'))
const addDisabled = computed(() => props.customModelCount >= props.maximumModels)

async function beginAddModel(): Promise<void> {
  if (addDisabled.value) return
  addingModel.value = true
  modelDraft.value = ''
  modelError.value = ''
  await nextTick()
  modelInput.value?.focus()
}

function cancelAddModel(): void {
  addingModel.value = false
  modelDraft.value = ''
  modelError.value = ''
}

function submitModel(): void {
  const model = modelDraft.value.trim()
  if (!model) {
    modelError.value = '请输入模型标识'
    return
  }
  if (model === CUSTOM_OPENAI_RESERVED_MODEL_ID) {
    modelError.value = `“${CUSTOM_OPENAI_RESERVED_MODEL_ID}”是界面保留名称，请换一个模型标识`
    return
  }
  if (props.options.some((option) => option.value === model)) {
    modelError.value = '该模型已经存在'
    return
  }
  emit('add', model)
  cancelAddModel()
}

function selectModel(model: string): void {
  emit('select', model)
  closePicker()
}

function removeModel(model: string): void {
  // Element Plus keeps a teleported popover slot mounted while it is open. Closing
  // before the parent replaces its config snapshot prevents the old slot from lingering.
  closePicker()
  emit('remove', model)
}

function closePicker(): void {
  // Move focus out of the panel before Element Plus applies aria-hidden. Focusing
  // after the visibility update is too late and causes an accessibility warning.
  pickerTrigger.value?.focus({preventScroll: true})
  pickerOpen.value = false
  query.value = ''
  cancelAddModel()
}

watch(() => props.selectedModel, () => {
  query.value = ''
})

watch(pickerOpen, (open) => {
  if (open) return
  query.value = ''
  cancelAddModel()
})
</script>

<style scoped>
.model-picker { width: 100%; min-width: 0; }
.model-picker-trigger {
  display: flex; align-items: center; justify-content: space-between; gap: 14px; width: 100%; min-height: 48px; padding: 8px 13px;
  border: 1px solid #dfe3eb; border-radius: 12px; color: #172033; background: #fff; text-align: left; cursor: pointer;
}
.model-picker-trigger:hover { border-color: #ef9ab1; background: #fff8fa; }
.model-picker-trigger > span { display: flex; min-width: 0; flex-direction: column; }
.model-picker-trigger small { margin-top: 2px; color: #8b93a4; font-size: 10px; }
.model-picker-trigger strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.model-picker-trigger b { color: #c72a56; font-size: 14px; }
:global(.model-picker-popper.el-popper) {
  isolation: isolate;
  max-width: calc(100vw - 24px) !important;
  padding: 0 !important;
  border: 1px solid #dfe3eb !important;
  border-radius: 14px !important;
  overflow: hidden;
  background: #fff !important;
  box-shadow: 0 18px 46px rgba(20, 29, 48, .18), 0 4px 14px rgba(20, 29, 48, .1) !important;
}
:global(.model-picker-popper.el-popper:not([aria-hidden="true"])) { opacity: 1 !important; }
:global(.model-picker-popper.el-popper .el-popper__arrow::before) {
  border-color: #dfe3eb !important;
  background: #fff !important;
}
.model-picker-panel { box-sizing: border-box; width: 100%; padding: 14px; color: #172033; background: #fff; }
.model-picker-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.model-picker-heading > div { display: flex; min-width: 0; flex-direction: column; }
.model-picker-heading strong { font-size: 14px; }
.model-picker-heading small { margin-top: 2px; color: #8b93a4; font-size: 10px; }
.model-add-button, .model-add-form button {
  padding: 7px 10px; border: 1px solid #ef4776; border-radius: 9px; color: #c72a56; background: #fff4f7; font-size: 11px; font-weight: 750; cursor: pointer;
}
.model-add-button:disabled { border-color: #dfe3eb; color: #9aa2b1; background: #f5f6f8; cursor: not-allowed; }
.model-limit { margin: -2px 0 9px; color: #8b5b00; font-size: 10px; }
.model-add-form { margin-bottom: 10px; padding: 10px; border: 1px solid #f2c0ce; border-radius: 11px; background: #fff7f9; }
.model-add-form > label { display: block; margin-bottom: 6px; color: #46526a; font-size: 11px; font-weight: 700; }
.model-add-form > div { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 7px; }
.model-add-form input, .model-picker-search input {
  min-width: 0; height: 34px; padding: 0 10px; border: 1px solid #dfe3eb; border-radius: 9px; color: #172033; background: #fff; outline: none; font-size: 12px;
}
.model-add-form input:focus, .model-picker-search input:focus { border-color: #ef4776; box-shadow: 0 0 0 3px rgba(239, 71, 118, .1); }
.model-add-form .plain-button { border-color: transparent; color: #697386; background: transparent; }
.model-error { margin: 7px 0 0; color: #c52f58; font-size: 10px; }
.model-picker-search { display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: center; gap: 5px; margin-bottom: 9px; color: #8b93a4; }
.model-picker-search input { width: 100%; }
.model-picker-list { display: flex; max-height: min(240px, 40vh); overflow-y: auto; padding: 1px; gap: 7px; flex-wrap: wrap; align-content: flex-start; scrollbar-width: thin; }
.model-picker-chip {
  display: inline-flex; width: fit-content; max-width: 100%; min-height: 32px; border: 1px solid #e4e7ee; border-radius: 9px; overflow: hidden; background: #f8f9fb;
}
.model-picker-chip:hover { border-color: #efb1c2; background: #fff7f9; }
.model-picker-chip.active { border-color: #ef8eaa; background: #fff0f4; box-shadow: 0 0 0 2px rgba(239, 71, 118, .08); }
.model-picker-option {
  display: inline-flex; align-items: center; gap: 6px; max-width: min(260px, calc(100vw - 96px)); min-height: 30px; padding: 5px 9px;
  border: 0; color: #263044; background: transparent; text-align: left; cursor: pointer;
}
.model-picker-option strong { overflow: hidden; font-size: 11px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.model-check { color: #d72f5f; font-size: 11px; }
.model-remove-button { width: 28px; padding: 0; border: 0; border-left: 1px solid #efd6dd; color: #a84a62; background: transparent; font-size: 15px; cursor: pointer; }
.model-remove-button:hover { background: #fff0f4; }
.model-picker-empty { margin: 18px 0 8px; color: #9299a8; font-size: 11px; text-align: center; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
:global(:root.dark .model-picker-popper.el-popper),
:global(:root.dark .model-picker-panel) { border-color: var(--line); color: var(--ink); background: var(--surface); }
:global(:root.dark .model-picker-popper.el-popper) { background: var(--surface) !important; box-shadow: 0 20px 50px rgba(0, 0, 0, .48) !important; }
:global(:root.dark .model-picker-popper.el-popper .el-popper__arrow::before) { border-color: var(--line) !important; background: var(--surface) !important; }
:global(:root.dark .model-picker-trigger),
:global(:root.dark .model-add-form),
:global(:root.dark .model-add-form input),
:global(:root.dark .model-picker-search input) { border-color: var(--line); color: var(--ink); background: var(--surface-soft); }
:global(:root.dark .model-picker-option) { color: var(--ink); }
:global(:root.dark .model-picker-chip) { border-color: var(--line); background: var(--surface-soft); }
:global(:root.dark .model-picker-chip.active) { border-color: rgba(255, 138, 171, .45); background: var(--brand-soft); }
@media (max-width: 480px) {
  :global(.model-picker-popper.el-popper) { width: calc(100vw - 24px) !important; }
  .model-add-form > div { grid-template-columns: minmax(0, 1fr) auto; }
  .model-add-form .plain-button { grid-column: 1 / -1; justify-self: start; }
}
</style>
