<!--
@file src/features/settings/ui/components/WritingFlowDemo.vue
文件职责：用一段可控的分步动画演示写作助手在真实网页中的完整流程，让没用过的用户先看懂效果再决定是否开启。
主要内容：以模拟的 Issue 回复区呈现入口出现、读取讨论、逐字起草和插回回复框四个阶段，提供步骤直达、暂停继续，并在关闭动画或系统减弱动态时改为静态展示。
模块边界：本组件只播放示意动画，不读取网页、不请求模型、不修改配置；真实入口放置与草稿生成仍由写作助手功能模块负责。
-->
<template>
  <div class="writing-flow" :class="{'is-static': !motion}">
    <ol class="flow-rail" :aria-label="'演示步骤'">
      <li v-for="(step, index) in steps" :key="step.title">
        <button
          type="button"
          :class="{active: index === active}"
          :aria-current="index === active ? 'step' : undefined"
          @click="select(index)"
        >
          <b aria-hidden="true">{{ index + 1 }}</b><span>{{ step.title }}</span>
        </button>
      </li>
    </ol>

    <div class="flow-stage" :data-step="active" aria-hidden="true">
      <div class="stage-thread">
        <span class="thread-tag">Issue</span>
        <span class="thread-title">长页面滚动时偶尔整段没有翻译</span>
      </div>

      <div class="stage-reply" :class="{filled: active === 3}">
        <p v-if="active === 3" class="reply-text" data-i18n-ignore>{{ draftText }}</p>
        <p v-else class="reply-placeholder">写下你的回复…</p>
      </div>

      <div class="stage-actions">
        <span class="entry-chip" :class="{shown: active >= 0}"><i>A中</i>写作助手</span>
        <span class="send-button" :class="{ready: active === 3}">发送</span>
      </div>

      <div class="stage-card" :class="{shown: active === 1 || active === 2}">
        <header><i>A中</i><strong>写作助手</strong><span class="card-model">deepseek-v4-flash</span></header>
        <ul v-if="active === 1" class="card-reference">
          <li v-for="(item, index) in reference" :key="item" :class="{shown: index < revealed}">
            <b aria-hidden="true">✓</b>{{ item }}
          </li>
        </ul>
        <div v-else class="card-draft">
          <p data-i18n-ignore>{{ typed }}<i v-if="typing" class="caret" /></p>
        </div>
        <footer><span class="card-hint">回复草稿</span><span class="card-apply">插入回复</span></footer>
      </div>
    </div>

    <p class="flow-caption">{{ steps[active].caption }}</p>

    <button v-if="motion" type="button" class="flow-toggle" @click="playing = !playing">
      {{ playing ? '暂停演示' : '继续演示' }}
    </button>
  </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import {useUiI18n} from '@/src/ui/i18n';
import {writingPreviewParagraphs} from '@/src/core/config/writingPreview';

const props = defineProps<{animated: boolean}>();
const {translateLegacy} = useUiI18n();

const steps = [
  {title: '入口出现在回复框旁', caption: '打开 GitHub 或 Gmail 的回复框，入口就停在原生发送按钮旁边，不插进网页自己的按钮组。'},
  {title: '先读懂这条讨论', caption: '点开之后，卡片会把标题、主楼正文和最近的讨论作为参考，你可以先核对再起草。'},
  {title: '按你的偏好起草', caption: '按当前的语言、长度、风格、语气和角色逐字生成，可以随时停止、改写或换一版。'},
  {title: '由你确认后再发送', caption: '草稿只会插回回复框，扩展永远不会替你点发送。'},
] as const;
const reference = ['标题与主楼正文', '最近 3 条讨论', '你已经写下的草稿'] as const;
const durations = [2600, 3600, 4600, 3200] as const;

// 逐字动画切的是译文，避免非中文界面里出现半句中文。
const draftText = computed(() => writingPreviewParagraphs({length: 'short', style: 'neutral', tone: 'professional', role: 'auto'})
  .map(item => translateLegacy(item.text)).join(''));

const active = ref(0);
const playing = ref(true);
const revealed = ref(0);
const typedLength = ref(0);
const reduced = ref(false);
const motion = computed(() => props.animated && !reduced.value);
const typed = computed(() => motion.value ? draftText.value.slice(0, typedLength.value) : draftText.value);
const typing = computed(() => motion.value && active.value === 2 && typedLength.value < draftText.value.length);

let stepTimer: ReturnType<typeof setTimeout> | undefined;
let tickTimer: ReturnType<typeof setInterval> | undefined;
function clearTimers() {
  if (stepTimer) { clearTimeout(stepTimer); stepTimer = undefined; }
  if (tickTimer) { clearInterval(tickTimer); tickTimer = undefined; }
}
function select(index: number) { active.value = index; }

const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
const onQueryChange = () => { reduced.value = Boolean(query?.matches); };
onQueryChange();
query?.addEventListener?.('change', onQueryChange);

watch([active, playing, motion], () => {
  clearTimers();
  revealed.value = motion.value && active.value === 1 ? 0 : reference.length;
  typedLength.value = motion.value && active.value === 2 ? 0 : draftText.value.length;
  if (!motion.value) return;
  if (active.value === 1) tickTimer = setInterval(() => { if (revealed.value < reference.length) revealed.value++; }, 620);
  if (active.value === 2) tickTimer = setInterval(() => {
    if (typedLength.value < draftText.value.length) typedLength.value += 2; else typedLength.value = draftText.value.length;
  }, 55);
  if (playing.value) stepTimer = setTimeout(() => { active.value = (active.value + 1) % steps.length; }, durations[active.value]);
}, {immediate: true});

onBeforeUnmount(() => { clearTimers(); query?.removeEventListener?.('change', onQueryChange); });
</script>

<style scoped>
.writing-flow { padding: 4px 18px 18px; }

.flow-rail {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 0 0 14px;
  padding: 0;
  list-style: none;
}

.flow-rail button {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 9px;
  color: var(--muted);
  background: var(--surface);
  font: inherit;
  font-size: 11.5px;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  transition: border-color .2s ease, color .2s ease, background .2s ease;
}

.flow-rail button:hover { border-color: color-mix(in srgb, var(--brand) 40%, var(--line)); }
.flow-rail button:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }

.flow-rail button.active {
  border-color: color-mix(in srgb, var(--brand) 55%, var(--line));
  color: var(--ink);
  background: var(--brand-soft);
}

.flow-rail b {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: var(--muted);
  background: var(--surface-soft);
  font-size: 10px;
  font-weight: 600;
}

.flow-rail button.active b { color: #fff; background: var(--brand); }

.flow-stage {
  position: relative;
  overflow: hidden;
  /* 固定高度让四步之间不跳动，并为浮起的卡片留出不遮住标题的空间。 */
  min-height: 200px;
  padding: 14px 14px 12px;
  border: 1px solid var(--line);
  border-radius: 13px;
  background: var(--surface-soft);
}

.stage-thread { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }

.thread-tag {
  padding: 2px 7px;
  border-radius: 20px;
  color: #fff;
  background: color-mix(in srgb, var(--brand) 78%, #6b7280);
  font-size: 10px;
}

.thread-title { color: var(--ink); font-size: 12px; font-weight: 600; }

.stage-reply {
  min-height: 62px;
  padding: 10px 11px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--surface);
  transition: border-color .3s ease, box-shadow .3s ease;
}

.stage-reply.filled {
  border-color: color-mix(in srgb, var(--brand) 45%, var(--line));
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.reply-placeholder, .reply-text { margin: 0; font-size: 11.5px; line-height: 1.75; }
.reply-placeholder { color: color-mix(in srgb, var(--muted) 72%, transparent); }
.reply-text { color: var(--ink); animation: flow-rise .4s ease both; }

.stage-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 10px; }

.entry-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: 1px solid color-mix(in srgb, var(--brand) 42%, var(--line));
  border-radius: 8px;
  color: var(--brand);
  background: var(--surface);
  font-size: 11px;
  opacity: 0;
  transform: translateX(6px);
  transition: opacity .35s ease, transform .35s ease;
}

.entry-chip.shown { opacity: 1; transform: none; }

.entry-chip i, .stage-card header i {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 4px;
  color: #fff;
  background: var(--brand);
  font-size: 8px;
  font-style: normal;
}

.send-button {
  padding: 5px 12px;
  border-radius: 8px;
  color: #fff;
  background: color-mix(in srgb, var(--muted) 70%, var(--ink));
  font-size: 11px;
  transition: background .3s ease, box-shadow .3s ease;
}

.send-button.ready {
  background: #2c974b;
  box-shadow: 0 0 0 3px color-mix(in srgb, #2c974b 18%, transparent);
}

.stage-card {
  position: absolute;
  right: 14px;
  bottom: 12px;
  left: 14px;
  padding: 10px 11px;
  border: 1px solid color-mix(in srgb, var(--brand) 32%, var(--line));
  border-radius: 11px;
  background: var(--surface);
  box-shadow: 0 10px 26px rgba(23, 32, 51, .12);
  opacity: 0;
  transform: translateY(10px);
  pointer-events: none;
  transition: opacity .3s ease, transform .3s ease;
}

.stage-card.shown { opacity: 1; transform: none; }
.stage-card header { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.stage-card header strong { color: var(--ink); font-size: 11.5px; }
.card-model { margin-left: auto; color: var(--muted); font-size: 10px; }
.card-reference { margin: 0; padding: 0; list-style: none; }

.card-reference li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  color: var(--muted);
  font-size: 11px;
  opacity: .28;
  transition: opacity .3s ease, color .3s ease;
}

.card-reference li.shown { color: var(--ink); opacity: 1; }
.card-reference b { color: #2c974b; font-size: 10px; }
.card-draft p { margin: 0; min-height: 34px; color: var(--ink); font-size: 11.5px; line-height: 1.75; }

.caret {
  display: inline-block;
  width: 1px;
  height: 11px;
  margin-left: 1px;
  background: var(--brand);
  vertical-align: -1px;
  animation: flow-caret .9s steps(2) infinite;
}

.stage-card footer { display: flex; align-items: center; justify-content: space-between; margin-top: 9px; }
.card-hint { color: var(--muted); font-size: 10px; }

.card-apply {
  padding: 4px 9px;
  border-radius: 7px;
  color: #fff;
  background: var(--brand);
  font-size: 10.5px;
}

.flow-caption { margin: 11px 0 0; color: var(--muted); font-size: 11.5px; line-height: 1.75; }

.flow-toggle {
  margin-top: 8px;
  border: 0;
  padding: 0;
  background: none;
  color: var(--brand);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}

.flow-toggle:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; }

@keyframes flow-rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes flow-caret { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }

.writing-flow.is-static .entry-chip,
.writing-flow.is-static .stage-card,
.writing-flow.is-static .stage-reply,
.writing-flow.is-static .send-button,
.writing-flow.is-static .card-reference li,
.writing-flow.is-static .reply-text { transition: none; animation: none; }

@media (max-width: 700px) {
  .writing-flow { padding: 4px 12px 14px; }
  .flow-rail { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (prefers-reduced-motion: reduce) {
  .entry-chip, .stage-card, .stage-reply, .send-button, .card-reference li, .reply-text { transition: none; animation: none; }
  .caret { animation: none; }
}
</style>
