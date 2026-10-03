<script setup lang="ts">
import { computed, ref } from 'vue'
import { useData, withBase } from 'vitepress'
import BrandReader from './BrandReader.vue'
import { useDemoPlayback } from './useDemoPlayback'
const props = defineProps<{ kind: string; en?: boolean; compact?: boolean }>()
const { lang } = useData()
const english = computed(() => props.en ?? lang.value.startsWith('en'))
const t = (zh: string, en: string) => (english.value ? en : zh)
const root = ref<HTMLElement | null>(null)
const { step, playing, running, reduced, choose } = useDemoPlayback(
  root,
  6,
  props.kind !== 'privacy',
  [300, 400, 300, 1500, 1500, 1500]
)
const changed = computed(() => step.value >= 3)
const style = computed(() => Math.max(0, step.value - 3) % 3)
const words = computed(
  () =>
    ({
      install: [
        t('固定图标，打开菜单', 'Pin the icon. Open the menu.'),
        t('点图标看示意', 'Open the example menu'),
      ],
      hover: [
        t('只翻译眼前这一段', 'Translate just this paragraph'),
        t('模拟按下 Control', 'Simulate Control'),
      ],
      selection: [
        t('划词翻译 · 选中句子看译文', 'SELECTION · TRANSLATE A SENTENCE'),
        t('打开示例词卡', 'Open the example card'),
      ],
      image: [
        t('图片翻译 · 原图与译文', 'IMAGE · ORIGINAL & TRANSLATION'),
        t('查看译图', 'Show translation'),
      ],
      area: [
        t('圈出需要的那一块', 'Select just the area you need'),
        t('查看圈选结果', 'Show selected-area result'),
      ],
      document: [
        t('导入文件，对照阅读', 'Import a file. Read side by side.'),
        t('查看双语结果', 'Show bilingual result'),
      ],
      video: [
        t('视频翻译 · 双语字幕', 'VIDEO · BILINGUAL CAPTIONS'),
        t('显示双语字幕', 'Show bilingual captions'),
      ],
      input: [
        t('写好想法，换一种语言', 'Your thoughts in another language'),
        t('翻译示例', 'Translate example'),
      ],
      writing: [
        t('先检查，再插入回复', 'Review it. Then insert your reply.'),
        t('查看示例草稿', 'Show example draft'),
      ],
      provider: [
        t('选择适合你的翻译服务', 'Choose your translation provider'),
        t('查看服务连接示意', 'Show a provider connection'),
      ],
      appearance: [
        t('选一种舒服的阅读方式', 'Find your reading style'),
        t('切换译文样式', 'Change translation style'),
      ],
      backup: [
        t('备份设置，换机也能继续用', 'Back up settings. Keep them on another device.'),
        t('查看恢复流程', 'Show restore flow'),
      ],
      learning: [
        t('收藏一句，留给下次复习', 'Save a sentence for your next review'),
        t('收藏示例句子', 'Save example sentence'),
      ],
      glossary: [
        t('让专有名词保持一致', 'Keep your terms consistent'),
        t('应用示例术语', 'Apply example term'),
      ],
      share: [
        t('把好句子，变成分享卡', 'Turn a sentence into a share card'),
        t('查看分享卡', 'Show share card'),
      ],
      shortcuts: [
        t('把操作变成顺手的快捷键', 'Put everyday actions on a shortcut'),
        t('查看操作结果', 'Show action result'),
      ],
      stats: [
        t('了解自己的翻译用量', 'See your translation activity'),
        t('切换查看范围', 'Change time range'),
      ],
      rules: [
        t('让常读的网站自动翻译', 'Translate your favorite sites automatically'),
        t('添加示例网站', 'Add example site'),
      ],
      privacy: [
        t('看清内容去向', 'See where your content goes'),
        t('查看数据流程', 'Show data flow'),
      ],
      sync: [
        t('手动备份，按需恢复', 'Back up manually. Restore when needed.'),
        t('查看恢复方向', 'Show the restore direction'),
      ],
      compare: [
        t('同一句，比较不同译法', 'One sentence. Compare translations.'),
        t('查看对比结果', 'Show comparison'),
      ],
      userscript: [
        t('脚本管理器 → FluentRead', 'Script manager → FluentRead'),
        t('查看脚本启用示意', 'Show the enabled script'),
      ],
      email: [
        t('在邮件里，对照阅读', 'Read an email in two languages'),
        t('查看双语邮件', 'Show bilingual email'),
      ],
      settings: [
        t('搜索设置，调整阅读习惯', 'Find a setting. Make it yours.'),
        t('查看目标语言设置', 'Show target language setting'),
      ],
    } as Record<string, string[]>)
)
const text = computed(() => words.value[props.kind] || words.value.shortcuts)
</script>
<template>
  <BrandReader v-if="kind === 'webpage'" :en="english" />
  <div
    ref="root"
    v-else
    class="gv"
    :class="[`gv-${kind}`, { compact, changed }]"
    :data-visual="kind"
    :data-step="step"
    :data-playing="playing"
    :data-running="running"
  >
    <div class="gv-heading">
      <span>{{ text[0] }}</span
      ><span class="gv-example">{{ t('操作示意', 'Walkthrough') }}</span>
    </div>
    <div class="gv-stage">
      <template v-if="kind === 'compare'"
        ><div class="gv-sentence">
          <span>{{ t('原文', 'Original') }}</span>
          <p>Every language opens a new door.</p>
          <div class="gv-compare">
            <div>
              <b>{{ t('服务 A · 示例', 'Provider A · example') }}</b>
              <p>
                {{
                  changed ? '每一种语言，都打开一扇新的门。' : t('等待翻译', 'Ready to translate')
                }}
              </p>
            </div>
            <div>
              <b>{{ t('服务 B · 示例', 'Provider B · example') }}</b>
              <p>
                {{ changed ? '每一门语言，都带来新的可能。' : t('等待翻译', 'Ready to translate') }}
              </p>
            </div>
          </div>
        </div></template
      >
      <template v-else-if="kind === 'sync'"
        ><div class="gv-flow">
          <div>
            <img :src="withBase('/brand-icon.webp')" width="48" height="48" alt="FluentRead" /><b>{{
              t('浏览器配置', 'Browser settings')
            }}</b>
          </div>
          <span aria-hidden="true">{{ changed ? '←' : '→' }}</span>
          <div>
            <span class="gv-flow-symbol" aria-hidden="true">☁</span
            ><b>{{ t('你连接的云存储', 'Your connected storage') }}</b>
          </div>
        </div>
        <p class="gv-flow-note">
          {{
            changed
              ? t('选择云端备份 → 预览 → 恢复或合并', 'Select backup → preview → restore or merge')
              : t('连接服务 → 选择内容 → 手动保存', 'Connect → choose content → save manually')
          }}
        </p></template
      >
      <template v-else-if="kind === 'settings' || kind === 'userscript'"
        ><div class="gv-connection">
          <span>{{
            kind === 'settings'
              ? t('设置搜索', 'Search settings')
              : t('脚本管理器', 'Script manager')
          }}</span
          ><b>{{ kind === 'settings' ? t('⌕ 目标语言', '⌕ Target language') : 'FluentRead' }}</b>
          <div class="gv-rule-row">
            <span>{{
              kind === 'settings'
                ? changed
                  ? t('简体中文', 'English')
                  : t('选择目标语言', 'Choose a target')
                : changed
                ? t('已启用', 'Enabled')
                : t('安装后开启脚本', 'Enable after installation')
            }}</span
            ><span
              v-if="kind === 'userscript'"
              class="gv-toggle"
              :class="{ enabled: changed }"
              aria-hidden="true"
            ></span>
          </div>
          <small>{{
            kind === 'settings'
              ? t(
                  '搜索定位设置，修改后自动保存。',
                  'Search to locate a setting. Changes save automatically.'
                )
              : t(
                  '先安装兼容的脚本管理器，再安装脚本。',
                  'Install a compatible manager, then the script.'
                )
          }}</small>
        </div></template
      >
      <template v-else-if="kind === 'email'"
        ><div class="gv-sentence">
          <span>{{ t('邮件正文 · 示例', 'Email body · example') }}</span>
          <p>
            {{ t('Thanks for your help. Let’s talk tomorrow.', '谢谢你的帮助。我们明天再聊。') }}
          </p>
          <p v-if="changed" class="gv-output">
            {{ t('谢谢你的帮助。我们明天再聊。', 'Thanks for your help. Let’s talk tomorrow.') }}
          </p>
          <span class="gv-key">{{
            t('阅读邮件 → 翻译 → 对照核对', 'Open email → translate → compare')
          }}</span>
        </div></template
      >
      <template v-else-if="kind === 'install'"
        ><div class="gv-toolbar">
          <span class="gv-url">example.com/article</span><span aria-hidden="true">☆</span
          ><button
            type="button"
            :aria-expanded="changed"
            :aria-label="t('打开 FluentRead 示例菜单', 'Open the example FluentRead menu')"
            data-demo-target
            @click="choose(changed ? 0 : 3)"
          >
            <img :src="withBase('/brand-icon.webp')" width="36" height="36" alt="FluentRead" />
          </button>
        </div>
        <div class="gv-menu" v-if="changed">
          <b>FluentRead</b
          ><span
            >{{ t('目标语言', 'Target language') }}
            <strong>{{ t('简体中文', 'English') }}</strong></span
          ><span
            >{{ t('翻译服务', 'Provider') }}
            <strong>{{ t('免费翻译服务', 'Free translation') }}</strong></span
          ><span class="gv-pill">{{ t('翻译当前网页', 'Translate this page') }}</span>
        </div>
        <div class="gv-hint" v-else>
          <span class="gv-point" aria-hidden="true">↑</span
          >{{ t('点击右上角图标', 'Click the icon above') }}
        </div></template
      >
      <template v-else-if="kind === 'image'">
        <div class="gv-comic">
          <span class="gv-comic-label">{{ t('漫画气泡翻译示例', 'Comic dialogue example') }}</span>
          <div class="gv-comic-bubble" :class="{ 'gv-local-result': changed }">
            {{
              changed
                ? t('我发现了一个新故事！', 'I found a new story!')
                : t('I found a new story!', '我发现了一个新故事！')
            }}
          </div>
          <svg viewBox="0 0 340 130" aria-hidden="true">
            <path d="M18 112h304M240 112V62h47v50M247 72h12m14 0h7m-33 15h12m14 0h7" />
            <circle cx="92" cy="38" r="20" />
            <path
              d="M73 33c4-22 38-24 40 0M86 41h1m12 0h1M87 50q6 5 11-1M81 60q-22 6-27 42m46-42q24 7 26 34M78 70l-7 42m36-42 6 42M59 91l36-3"
            />
            <path
              class="gv-comic-book"
              d="M101 82q17-8 34 0v32q-17-8-34 0-17-8-34 0V82q17-8 34 0v32"
            />
            <path d="M153 106q17-36 31-12t28 7M28 111l7-16 8 16" />
          </svg>
          <small>{{
            changed
              ? t('原文：I found a new story!', 'Original: 我发现了一个新故事！')
              : t('英文原图', 'Chinese original')
          }}</small>
        </div>
      </template>
      <template v-else-if="kind === 'area'">
        <div class="gv-poster">
          <div class="gv-poster-shape" aria-hidden="true"></div>
          <div class="gv-crop outlined">
            <span class="gv-poster-small">FIELD NOTES / 2026</span>
            <b>{{ t('Stay curious', '保持好奇') }}</b>
            <span>{{ t('The world is yours to explore.', '世界，值得探索。') }}</span>
          </div>
          <small>{{ t('圈选区域中的原文', 'Original text inside the selection') }}</small>
        </div>
        <div v-if="changed" class="gv-result">
          <strong>{{ t('识别与翻译', 'Recognition & translation') }}</strong>
          <p>Stay curious → {{ t('保持好奇', 'Stay curious') }}</p>
        </div>
      </template>
      <template v-else-if="kind === 'document'"
        ><div class="gv-file">
          <span class="gv-file-icon" aria-hidden="true">▤</span>
          <div>
            <b>explore.pdf</b
            ><small>{{
              changed
                ? t('翻译完成', 'Translation complete')
                : t('已导入 · 准备翻译', 'Imported · ready to translate')
            }}</small>
          </div>
          <span class="gv-file-check" aria-hidden="true">{{ changed ? '✓' : '→' }}</span>
        </div>
        <div class="gv-document-pages">
          <div>
            <span>01 / ORIGINAL</span>
            <h4>{{ t('The joy of reading', '阅读的乐趣') }}</h4>
            <p>{{ t('Every language opens a new door.', '每一种语言，都打开一扇新的门。') }}</p>
            <i></i><i></i><i></i>
          </div>
          <div class="gv-document-result">
            <span>01 / {{ t('译文', 'TRANSLATION') }}</span
            ><template v-if="changed"
              ><h4>{{ t('阅读的乐趣', 'The joy of reading') }}</h4>
              <p>{{ t('每一种语言，都打开一扇新的门。', 'Every language opens a new door.') }}</p>
              <i></i><i></i
            ></template>
            <p v-else class="gv-placeholder">
              {{ t('译文会出现在这里', 'Your translation appears here') }}
            </p>
          </div>
        </div></template
      >
      <template v-else-if="kind === 'video'"
        ><div class="gv-video">
          <span class="gv-video-tag">{{
            t('视频 / 会议字幕示例', 'Video / meeting caption example')
          }}</span>
          <div class="gv-video-landscape" aria-hidden="true"></div>
          <span class="gv-video-play" aria-hidden="true">▷</span>
          <div class="gv-caption">
            <p>{{ t('Let’s review the plan together.', '我们一起回顾一下计划。') }}</p>
            <p v-if="changed" class="gv-local-result">
              {{ t('我们一起回顾一下计划。', 'Let’s review the plan together.') }}
            </p>
          </div>
          <span class="gv-timeline" aria-hidden="true"></span></div
      ></template>
      <template v-else-if="['input', 'writing'].includes(kind)"
        ><div class="gv-editor">
          <span>{{
            kind === 'writing' ? t('回复草稿', 'Reply draft') : t('输入框', 'Input field')
          }}</span>
          <p>
            {{
              kind === 'writing'
                ? t('感谢你的建议，我们会在下一版改进。', '感谢你的建议，我们会在下一版改进。')
                : t('谢谢你的回复，我们明天继续讨论。', '谢谢你的回复，我们明天继续讨论。')
            }}
          </p>
          <p v-if="changed" class="gv-output">
            {{
              kind === 'writing'
                ? 'Thank you for your suggestion. We will improve this in the next update.'
                : 'Thank you for your reply. Let’s continue tomorrow.'
            }}
          </p>
          <div>
            <small>{{
              changed
                ? t(
                    '检查后再插入 · 不会自动发送',
                    'Review before inserting · never sends automatically'
                  )
                : t('先写下你的想法', 'Start with your own thoughts')
            }}</small
            ><span aria-hidden="true">↗</span>
          </div>
        </div></template
      >
      <template v-else-if="kind === 'share'">
        <div v-if="changed" class="gv-share-card">
          <blockquote>
            {{ t('Every language opens a new door.', '每一种语言，都打开一扇新的门。') }}
          </blockquote>
          <p>{{ t('每一种语言，都打开一扇新的门。', 'Every language opens a new door.') }}</p>
          <small>FluentRead / example.com</small>
        </div>
        <div v-else class="gv-sentence">
          <span>{{ t('你选中的好句子', 'Your selected sentence') }}</span>
          <p>{{ t('Every language opens a new door.', '每一种语言，都打开一扇新的门。') }}</p>
          <span class="gv-key">{{
            t('划词结果 → 制作卡片 → 保存图片', 'Selection result → Create card → Save image')
          }}</span>
        </div>
      </template>
      <template v-else-if="['selection', 'hover', 'learning'].includes(kind)"
        ><div class="gv-sentence">
          <span>{{ t('原文', 'Original') }}</span>
          <p>
            <mark v-if="kind !== 'hover'" :class="{ 'gv-selected': step >= 1 }">{{
              t('Every language opens a new door.', '每一种语言，都打开一扇新的门。')
            }}</mark
            ><template v-else>{{
              t('Every language opens a new door.', '每一种语言，都打开一扇新的门。')
            }}</template>
          </p>
          <div v-if="changed" class="gv-result">
            <strong>{{
              kind === 'learning'
                ? t('✓ 已收藏', '✓ Saved')
                : kind === 'share'
                ? t('双语分享卡', 'Bilingual share card')
                : t('译文', 'Translation')
            }}</strong>
            <p>{{ t('每一种语言，都打开一扇新的门。', 'Every language opens a new door.') }}</p>
            <small v-if="kind === 'selection'">{{
              t('切换卡片模式，还能查词与学习', 'Switch to card mode to explore the sentence')
            }}</small>
          </div>
          <span v-else class="gv-key">{{
            kind === 'hover' ? 'Control' : t('选中句子 → 点击图标', 'Select sentence → click icon')
          }}</span>
        </div></template
      >
      <template v-else-if="kind === 'provider'"
        ><div class="gv-provider">
          <div>
            <span class="gv-service-icon">↔</span
            ><b>{{ changed ? 'AI' : t('免费翻译服务', 'Free translation') }}</b
            ><small>{{
              changed
                ? t('你的服务与模型', 'Your provider and model')
                : t('无需密钥，即可开始', 'No API key needed')
            }}</small>
          </div>
          <div class="gv-connection">
            <span>{{ t('服务', 'Provider') }}</span
            ><b>{{
              changed
                ? t('选择已配置的 AI 服务', 'Choose your configured AI provider')
                : t('免费翻译服务', 'Free translation')
            }}</b
            ><span>{{
              changed
                ? t('密钥 · 保存在浏览器中', 'API key · stored in your browser')
                : t('目标语言 · 简体中文', 'Target language · English')
            }}</span
            ><strong>{{ changed ? '••••••••' : t('直接翻译', 'Start translating') }}</strong>
          </div>
        </div></template
      >
      <template v-else-if="kind === 'appearance'"
        ><div class="gv-sentence">
          <span>{{ t('原文与译文', 'Original & translation') }}</span>
          <p>Every language opens a new door.</p>
          <p class="gv-styled" :class="`gv-style-${style}`">
            {{ t('每一种语言，都打开一扇新的门。', 'Every language opens a new door.') }}
          </p>
          <div
            class="gv-swatches"
            role="group"
            :aria-label="t('示例译文样式', 'Example translation styles')"
          >
            <button
              v-for="(label, i) in [
                t('引用', 'Quote'),
                t('荧光', 'Highlight'),
                t('下划线', 'Underline'),
              ]"
              :key="label"
              type="button"
              :aria-pressed="style === i"
              @click="choose(i + 3)"
            >
              {{ label }}
            </button>
          </div>
        </div></template
      >
      <template v-else-if="['backup', 'privacy'].includes(kind)"
        ><div class="gv-flow">
          <div>
            <img :src="withBase('/brand-icon.webp')" width="48" height="48" alt="FluentRead" /><b>{{
              t('你的浏览器', 'Your browser')
            }}</b>
          </div>
          <span aria-hidden="true">{{ kind === 'backup' && changed ? '←' : '→' }}</span>
          <div>
            <span class="gv-flow-symbol" aria-hidden="true">{{
              kind === 'backup' ? '▤' : '↔'
            }}</span
            ><b>{{
              kind === 'backup'
                ? t('配置备份文件', 'Settings backup file')
                : t('你选择的服务', 'Your selected provider')
            }}</b>
          </div>
        </div>
        <p class="gv-flow-note">
          {{
            kind === 'backup'
              ? changed
                ? t('选择备份文件 → 预览 → 导入', 'Choose backup → preview → import')
                : t('选择需要备份的内容 → 导出', 'Choose data to back up → export')
              : t(
                  '使用云端翻译时，待译文字发送给所选服务。',
                  'Cloud translation sends the selected text to your chosen provider.'
                )
          }}
        </p></template
      >
      <template v-else-if="kind === 'glossary'"
        ><div class="gv-sentence">
          <span>{{ t('术语示例', 'Example term') }}</span>
          <p>FluentRead opens a new door.</p>
          <div class="gv-term">
            <b>FluentRead</b><span aria-hidden="true">→</span
            ><b>{{ t('流畅阅读', 'FluentRead') }}</b>
          </div>
          <p class="gv-output">
            {{
              changed
                ? t('流畅阅读，打开一扇新的门。', 'FluentRead opens a new door.')
                : t('添加术语后，翻译会参考指定译法。', 'Add a term to guide the translation.')
            }}
          </p>
        </div></template
      >
      <template v-else-if="kind === 'rules'"
        ><div class="gv-connection">
          <span>{{ t('网站规则', 'Site rule') }}</span
          ><b>example.com</b>
          <div class="gv-rule-row">
            <span>{{ t('自动翻译', 'Automatic translation') }}</span
            ><span class="gv-toggle" :class="{ enabled: changed }" aria-hidden="true"></span>
          </div>
          <p>
            {{
              changed
                ? t('再次打开这个网站时自动翻译', 'Translate automatically when you return')
                : t('按网站设置，保持你的阅读习惯', 'Set a rule for the sites you read')
            }}
          </p>
        </div></template
      >
      <template v-else-if="kind === 'stats'"
        ><div class="gv-chart" :aria-label="t('示例用量图', 'Example activity chart')">
          <span
            v-for="(height, i) in changed
              ? [30, 70, 50, 85, 55, 100, 65]
              : [20, 35, 55, 40, 80, 65, 95]"
            :key="i"
            :style="{ height: `${height}%` }"
          ></span>
        </div>
        <p class="gv-flow-note">
          {{
            t(
              '示例数据 · 实际统计在扩展设置中查看',
              'Example data · see actual activity in extension settings'
            )
          }}
        </p></template
      >
      <template v-else
        ><div class="gv-shortcut">
          <kbd>Alt</kbd><span>+</span><kbd>T</kbd><span>→</span
          ><b>{{
            changed ? t('恢复原文', 'Restore original') : t('翻译当前网页', 'Translate this page')
          }}</b>
        </div>
        <p class="gv-flow-note">
          {{
            t('Mac 使用 Option；可在设置中修改。', 'Use Option on Mac. Customize it in settings.')
          }}
        </p></template
      >
    </div>
    <div v-if="kind !== 'privacy'" class="gv-controls">
      <small
        >{{ t('自动演示 · ', 'Auto demo · ')
        }}{{ changed ? t('结果已显示', 'Result shown') : t('正在处理…', 'Processing…') }}</small
      ><button
        v-if="!reduced"
        type="button"
        :aria-label="
          playing ? t('暂停图解演示', 'Pause walkthrough') : t('播放图解演示', 'Play walkthrough')
        "
        @click="playing = !playing"
      >
        {{ playing ? t('暂停', 'Pause') : t('播放', 'Play') }}
      </button>
    </div>
  </div>
</template>
