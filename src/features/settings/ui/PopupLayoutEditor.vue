<!--
 * @file src/features/settings/ui/PopupLayoutEditor.vue
 * 文件职责：提供可复用的设置页排序与显隐编辑器，供 Popup 顶层区域和快捷功能卡片两级布局共同使用。
 * 主要内容：消费外部注册表投影，支持拖放、上下移动、单项开关、默认顺序恢复和无障碍状态播报，并保留稳定的测试定位契约。
 * 模块边界：组件只编辑传入的纯布局数据，不认识具体业务功能、不读写浏览器存储，也不渲染真实 Popup。
-->
<template>
  <div
    class="popup-layout-editor"
    :data-popup-layout-editor="props.scope === 'popupModule' ? '' : undefined"
    :data-popup-quick-feature-editor="props.scope === 'quickFeature' ? '' : undefined"
  >
    <div class="popup-layout-toolbar">
      <span>{{ copy('orderHint') }}</span>
      <button type="button" :disabled="isDefaultOrder" @click="restoreDefaultOrder">
        {{ copy('restoreDefault') }}
      </button>
    </div>

    <ol class="popup-layout-list" :aria-label="copy('listAria')">
      <li
        v-for="(item, index) in orderedItems"
        :key="item.id"
        class="popup-layout-item"
        :class="{
          dragging: draggedItem === item.id,
          hidden: !item.visible,
          'drop-before': dropTarget === item.id && dropPosition === 'before',
          'drop-after': dropTarget === item.id && dropPosition === 'after',
        }"
        :data-popup-layout-module="props.scope === 'popupModule' ? item.id : undefined"
        :data-popup-quick-feature-layout="props.scope === 'quickFeature' ? item.id : undefined"
        @dragover="handleDragOver($event, item.id)"
        @drop="handleDrop($event, item.id)"
      >
        <button
          class="popup-layout-handle"
          type="button"
          draggable="true"
          :aria-label="copy('handleAria', {label: item.label})"
          :aria-pressed="draggedItem === item.id"
          @dragstart="handleDragStart($event, item.id)"
          @dragend="finishDrag"
          @keydown.up.prevent="moveItem(item.id, -1)"
          @keydown.down.prevent="moveItem(item.id, 1)"
        >
          <span aria-hidden="true">⠿</span>
        </button>

        <span class="popup-layout-copy">
          <strong>{{ item.label }}</strong>
          <small>{{ item.description }}</small>
        </span>

        <div class="popup-layout-actions">
          <span v-if="item.required" class="popup-layout-required">
            {{ copy('required') }}
          </span>
          <el-switch
            v-else
            :model-value="item.visible"
            class="settings-toggle"
            :aria-label="copy('showAria', {label: item.label})"
            @update:model-value="setItemVisibility(item, $event === true)"
          />
          <span class="popup-layout-move-buttons">
            <button
              type="button"
              :disabled="index === 0"
              :aria-label="copy('moveUp', {label: item.label})"
              @click="moveItem(item.id, -1)"
            >↑</button>
            <button
              type="button"
              :disabled="index === orderedItems.length - 1"
              :aria-label="copy('moveDown', {label: item.label})"
              @click="moveItem(item.id, 1)"
            >↓</button>
          </span>
        </div>
      </li>
    </ol>

    <p class="popup-layout-help">
      {{ copy('help') }}
    </p>
    <p class="popup-layout-announcement" aria-live="polite">{{ announcement }}</p>
  </div>
</template>

<script lang="ts" setup>
import {computed, ref} from 'vue'
import {useUiI18n} from '@/src/ui/i18n'

export interface PopupLayoutEditorItem {
  id: string
  label: string
  description: string
  visible: boolean
  required?: boolean
}

const props = defineProps<{
  items: readonly PopupLayoutEditorItem[]
  order: readonly string[]
  defaultOrder: readonly string[]
  scope: 'popupModule' | 'quickFeature'
  copyPrefix: string
}>()

const emit = defineEmits<{
  'update:order': [value: string[]]
  'update:visibility': [id: string, value: boolean]
}>()
const {t} = useUiI18n()

const draggedItem = ref<string | null>(null)
const dropTarget = ref<string | null>(null)
const dropPosition = ref<'before' | 'after'>('before')
const announcement = ref('')

const itemById = computed(() => new Map(props.items.map((item) => [item.id, item])))
const normalizedOrder = computed(() => {
  const registered = new Set(itemById.value.keys())
  const seen = new Set<string>()
  const saved = props.order.filter((id) => {
    if (!registered.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })
  return [...saved, ...props.items.map((item) => item.id).filter((id) => !seen.has(id))]
})
const orderedItems = computed(() => normalizedOrder.value
  .map((id) => itemById.value.get(id))
  .filter((item): item is PopupLayoutEditorItem => Boolean(item)))
const isDefaultOrder = computed(() => normalizedOrder.value.every(
  (id, index) => id === props.defaultOrder[index],
) && normalizedOrder.value.length === props.defaultOrder.length)

function copy(suffix: string, params?: Record<string, string | number>): string {
  return t(`${props.copyPrefix}.${suffix}`, params)
}

function setItemVisibility(item: PopupLayoutEditorItem, visible: boolean) {
  emit('update:visibility', item.id, visible)
  announcement.value = copy(visible ? 'shown' : 'hidden', {label: item.label})
}

function emitOrder(nextOrder: string[], movedItem: string) {
  emit('update:order', nextOrder)
  const item = itemById.value.get(movedItem)
  const position = nextOrder.indexOf(movedItem) + 1
  announcement.value = copy('moved', {
    label: item?.label ?? movedItem,
    position,
  })
}

function moveItem(itemId: string, offset: -1 | 1) {
  const nextOrder = [...normalizedOrder.value]
  const currentIndex = nextOrder.indexOf(itemId)
  const targetIndex = Math.min(nextOrder.length - 1, Math.max(0, currentIndex + offset))
  if (currentIndex < 0 || currentIndex === targetIndex) return
  nextOrder.splice(currentIndex, 1)
  nextOrder.splice(targetIndex, 0, itemId)
  emitOrder(nextOrder, itemId)
}

function restoreDefaultOrder() {
  emit('update:order', [...props.defaultOrder])
  announcement.value = copy('restored')
}

function handleDragStart(event: DragEvent, itemId: string) {
  draggedItem.value = itemId
  event.dataTransfer?.setData('text/plain', itemId)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function handleDragOver(event: DragEvent, itemId: string) {
  if (!draggedItem.value || draggedItem.value === itemId) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const target = event.currentTarget as HTMLElement
  const bounds = target.getBoundingClientRect()
  dropTarget.value = itemId
  dropPosition.value = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
}

function handleDrop(event: DragEvent, targetId: string) {
  event.preventDefault()
  const sourceId = draggedItem.value
  if (!sourceId || sourceId === targetId) {
    finishDrag()
    return
  }

  const withoutSource = normalizedOrder.value.filter((id) => id !== sourceId)
  const targetIndex = withoutSource.indexOf(targetId)
  const insertionIndex = targetIndex + (dropPosition.value === 'after' ? 1 : 0)
  withoutSource.splice(insertionIndex, 0, sourceId)
  emitOrder(withoutSource, sourceId)
  finishDrag()
}

function finishDrag() {
  draggedItem.value = null
  dropTarget.value = null
  dropPosition.value = 'before'
}
</script>

<style scoped>
.popup-layout-editor {
  width: 100%;
}

.popup-layout-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  color: var(--muted);
  font-size: 10px;
}

.popup-layout-toolbar button {
  flex: none;
  padding: 4px 7px;
  border: 0;
  border-radius: 7px;
  color: var(--brand-strong);
  background: var(--brand-soft);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.popup-layout-toolbar button:disabled {
  color: var(--muted);
  background: var(--surface-soft);
  cursor: default;
  opacity: .65;
}

.popup-layout-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.popup-layout-item {
  position: relative;
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  min-height: 58px;
  padding: 7px 8px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: var(--surface);
  transition: border-color 140ms ease, background 140ms ease, opacity 140ms ease;
}

.popup-layout-item:hover {
  border-color: rgba(239, 71, 118, .3);
}

.popup-layout-item.dragging {
  opacity: .45;
}

.popup-layout-item.hidden .popup-layout-copy {
  opacity: .58;
}

.popup-layout-item.drop-before::before,
.popup-layout-item.drop-after::after {
  position: absolute;
  right: 8px;
  left: 8px;
  height: 2px;
  border-radius: 99px;
  background: var(--brand);
  content: '';
}

.popup-layout-item.drop-before::before {
  top: -5px;
}

.popup-layout-item.drop-after::after {
  bottom: -5px;
}

.popup-layout-handle {
  display: grid;
  place-items: center;
  width: 32px;
  height: 38px;
  padding: 0;
  border: 0;
  border-radius: 9px;
  color: var(--muted);
  background: var(--surface-soft);
  cursor: grab;
}

.popup-layout-handle:active {
  cursor: grabbing;
}

.popup-layout-handle:focus-visible,
.popup-layout-move-buttons button:focus-visible,
.popup-layout-toolbar button:focus-visible {
  outline: 2px solid rgba(239, 71, 118, .4);
  outline-offset: 2px;
}

.popup-layout-handle span {
  font-size: 19px;
  line-height: 1;
  transform: rotate(90deg);
}

.popup-layout-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.popup-layout-copy strong {
  color: var(--ink);
  font-size: 11px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.popup-layout-copy small {
  color: var(--muted);
  font-size: 9px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.popup-layout-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.popup-layout-required {
  padding: 3px 6px;
  border-radius: 999px;
  color: var(--muted);
  background: var(--surface-soft);
  font-size: 8px;
  font-weight: 700;
  white-space: nowrap;
}

.popup-layout-move-buttons {
  display: inline-flex;
  gap: 3px;
}

.popup-layout-move-buttons button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 7px;
  color: var(--muted);
  background: var(--surface);
  font-size: 12px;
  cursor: pointer;
}

.popup-layout-move-buttons button:hover:not(:disabled) {
  border-color: rgba(239, 71, 118, .35);
  color: var(--brand-strong);
  background: var(--brand-soft);
}

.popup-layout-move-buttons button:disabled {
  cursor: default;
  opacity: .28;
}

.popup-layout-help {
  margin: 7px 1px 0;
  color: var(--muted);
  font-size: 9px;
  line-height: 1.45;
}

.popup-layout-announcement {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 620px) {
  .popup-layout-toolbar {
    align-items: flex-start;
  }

  .popup-layout-item {
    grid-template-columns: 32px minmax(0, 1fr);
  }

  .popup-layout-actions {
    grid-column: 2;
    justify-content: space-between;
  }
}
</style>
