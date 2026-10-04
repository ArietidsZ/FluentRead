<script setup lang="ts">
import { computed, ref } from 'vue'
import { useData, withBase } from 'vitepress'
import BrandReader from './BrandReader.vue'
import BrowserGuide from './BrowserGuide.vue'
import FeatureDemo from './FeatureDemo.vue'
import TransferFlow from './TransferFlow.vue'
import { useDemoPlayback } from './useDemoPlayback'
const props = defineProps<{ kind: string; en?: boolean; compact?: boolean }>()
const { lang } = useData()
const english = computed(() => props.en ?? lang.value.startsWith('en'))
const t = (zh: string, en: string) => (english.value ? en : zh)
const root = ref<HTMLElement | null>(null)
const { step, playing, running, reduced, choose, replay } = useDemoPlayback(
  root,
  6,
  true,
  [300, 400, 300, 1500, 1500, 1500]
)
const changed = computed(() => step.value >= 3)
const style = computed(() => Math.max(0, step.value - 3) % 3)
const words = computed(
  () =>
    ({
      install: [
        t('固定图标，打开菜单', 'Pin the icon and open the menu'),
        t('点图标看示意', 'Open the example menu'),
      ],
      hover: [
        t('翻译鼠标所指的段落', 'Translate just this paragraph'),
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
        t('导入文档并查看双语译文', 'Import a file to read alongside its translation'),
        t('查看双语结果', 'Show bilingual result'),
      ],
      video: [
        t('视频翻译 · 双语字幕', 'VIDEO · BILINGUAL CAPTIONS'),
        t('显示双语字幕', 'Show bilingual captions'),
      ],
      input: [
        t('翻译输入框中的文字', 'Translate text in an input field'),
        t('翻译示例', 'Translate example'),
      ],
      writing: [
        t('先检查，再插入回复', 'Review the draft before inserting your reply'),
        t('查看示例草稿', 'Show example draft'),
      ],
      provider: [
        t('选择适合你的翻译服务', 'Choose your translation provider'),
        t('查看服务连接示意', 'Show a provider connection'),
      ],
      appearance: [
        t('调整译文显示样式', 'Customize translation appearance'),
        t('切换译文样式', 'Change translation style'),
      ],
      backup: [
        t('导出与恢复配置备份', 'Export and restore settings'),
        t('查看恢复流程', 'Show restore flow'),
      ],
      learning: [
        t('收藏句子并在学习中心复习', 'Save a sentence for review'),
        t('收藏示例句子', 'Save example sentence'),
      ],
      glossary: [
        t('指定专业词汇的译法', 'Set translations for your terms'),
        t('应用示例术语', 'Apply example term'),
      ],
      share: [
        t('将原文与译文制作成分享卡片', 'Create a bilingual share card'),
        t('查看分享卡', 'Show share card'),
      ],
      shortcuts: [
        t('使用快捷键翻译和恢复原文', 'Translate and restore with shortcuts'),
        t('查看操作结果', 'Show action result'),
      ],
      stats: [
        t('了解自己的翻译用量', 'See your translation activity'),
        t('切换查看范围', 'Change time range'),
      ],
      rules: [
        t('设置网站自动翻译', 'Enable automatic translation for a site'),
        t('添加示例网站', 'Add example site'),
      ],
      privacy: [
        t('翻译内容的数据传递方式', 'How translation data is transferred'),
        t('查看数据流程', 'Show data flow'),
      ],
      sync: [
        t('保存配置与恢复备份', 'Save and restore settings'),
        t('查看恢复方向', 'Show the restore direction'),
      ],
      compare: [
        t('对比不同服务的翻译结果', 'Compare translations of the same sentence'),
        t('查看对比结果', 'Show comparison'),
      ],
      userscript: [
        t('脚本管理器 → FluentRead', 'Script manager → FluentRead'),
        t('查看脚本启用示意', 'Show the enabled script'),
      ],
      email: [
        t('阅读邮件原文与译文', 'Read an email in two languages'),
        t('查看双语邮件', 'Show bilingual email'),
      ],
      settings: [
        t('搜索并修改设置', 'Find and change a setting'),
        t('查看目标语言设置', 'Show target language setting'),
      ],
    } as Record<string, string[]>)
)
const text = computed(() => words.value[props.kind] || words.value.shortcuts)
</script>
<template>
  <BrowserGuide
    v-if="
      kind === 'install' ||
      kind === 'pin' ||
      kind === 'first-translation' ||
      kind === 'hover' ||
      kind === 'selection' ||
      kind === 'chrome-local'
    "
    :key="kind"
    :kind="kind"
    :en="english"
  />
  <BrandReader v-else-if="kind === 'webpage'" :en="english" />
  <FeatureDemo v-else-if="kind === 'document'" kind="document" :en="english" />
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
      <span>{{ text[0] }}</span>
      <span class="gv-example">{{ t('操作示意', 'Walkthrough') }}</span>
    </div>
    <div class="gv-stage">
      <template v-if="kind === 'compare'">
        <div class="gv-sentence">
          <span>{{ t('原文', 'Original') }}</span>
          <p>Every language opens a new door.</p>
          <div class="gv-compare">
            <div>
              <b>{{ t('服务 A · 示例', 'Provider A · example') }}</b>
              <p>
                {{ changed ? '每一种语言都打开一扇新的门。' : t('等待翻译', 'Ready to translate') }}
              </p>
            </div>
            <div>
              <b>{{ t('服务 B · 示例', 'Provider B · example') }}</b>
              <p>
                {{ changed ? '每一门语言，都带来新的可能。' : t('等待翻译', 'Ready to translate') }}
              </p>
            </div>
          </div>
        </div>
      </template>
      <template v-else-if="kind === 'sync'">
        <TransferFlow kind="sync" :en="english" :running="running" />
        <p class="gv-flow-note">
          {{
            changed
              ? t(
                  '先预览云端配置，再确认恢复或合并到本机。',
                  'Preview the backup before restoring or merging it.'
                )
              : t(
                  '核对本机配置后，确认保存到所选云存储。',
                  'Review local settings before saving them to cloud storage.'
                )
          }}
        </p>
      </template>
      <template v-else-if="kind === 'settings' || kind === 'userscript'">
        <div class="gv-connection">
          <span>
            {{
              kind === 'settings'
                ? t('设置搜索', 'Search settings')
                : t('脚本管理器', 'Script manager')
            }}
          </span>
          <b>{{ kind === 'settings' ? t('⌕ 目标语言', '⌕ Target language') : 'FluentRead' }}</b>
          <div class="gv-rule-row">
            <span>
              {{
                kind === 'settings'
                  ? changed
                    ? t('简体中文', 'English')
                    : t('选择目标语言', 'Choose a target')
                  : changed
                  ? t('已启用', 'Enabled')
                  : t('安装后开启脚本', 'Enable after installation')
              }}
            </span>
            <span
              v-if="kind === 'userscript'"
              class="gv-toggle"
              :class="{ enabled: changed }"
              aria-hidden="true"
            ></span>
          </div>
          <small>
            {{
              kind === 'settings'
                ? t(
                    '搜索定位设置，修改后自动保存。',
                    'Search to locate a setting. Changes save automatically.'
                  )
                : t(
                    '先安装兼容的脚本管理器，再安装脚本。',
                    'Install a compatible manager, then the script.'
                  )
            }}
          </small>
        </div>
      </template>
      <template v-else-if="kind === 'email'">
        <div class="gv-sentence">
          <span>{{ t('邮件正文 · 示例', 'Email body · example') }}</span>
          <p>
            {{ t('Thanks for your help. Let’s talk tomorrow.', '谢谢你的帮助。我们明天再聊。') }}
          </p>
          <p v-if="changed" class="gv-output">
            {{ t('谢谢你的帮助。我们明天再聊。', 'Thanks for your help. Let’s talk tomorrow.') }}
          </p>
          <span class="gv-key">
            {{ t('阅读邮件 → 翻译 → 对照核对', 'Open email → translate → compare') }}
          </span>
        </div>
      </template>
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
          <small>
            {{
              changed
                ? t('原文：I found a new story!', 'Original: 我发现了一个新故事！')
                : t('英文原图', 'Chinese original')
            }}
          </small>
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
      <template v-else-if="kind === 'video'">
        <div class="gv-video">
          <span class="gv-video-tag">
            {{ t('视频 / 会议字幕示例', 'Video / meeting caption example') }}
          </span>
          <div class="gv-video-landscape" aria-hidden="true"></div>
          <span class="gv-video-play" aria-hidden="true">▷</span>
          <div class="gv-caption">
            <p>{{ t('Let’s review the plan together.', '我们一起回顾一下计划。') }}</p>
            <p v-if="changed" class="gv-local-result">
              {{ t('我们一起回顾一下计划。', 'Let’s review the plan together.') }}
            </p>
          </div>
          <span class="gv-timeline" aria-hidden="true"></span>
        </div>
      </template>
      <template v-else-if="['input', 'writing'].includes(kind)">
        <div class="gv-editor">
          <span>
            {{ kind === 'writing' ? t('回复草稿', 'Reply draft') : t('输入框', 'Input field') }}
          </span>
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
            <small>
              {{
                changed
                  ? t(
                      '检查后再插入 · 不会自动发送',
                      'Review before inserting · never sends automatically'
                    )
                  : t('输入需要翻译的文字', 'Start with your own thoughts')
              }}
            </small>
            <span aria-hidden="true">↗</span>
          </div>
        </div>
      </template>
      <template v-else-if="kind === 'share'">
        <div v-if="changed" class="gv-share-card">
          <blockquote>
            {{ t('Every language opens a new door.', '每一种语言都打开一扇新的门。') }}
          </blockquote>
          <p>{{ t('每一种语言都打开一扇新的门。', 'Every language opens a new door.') }}</p>
          <small>FluentRead / example.com</small>
        </div>
        <div v-else class="gv-sentence">
          <span>{{ t('你选中的好句子', 'Your selected sentence') }}</span>
          <p>{{ t('Every language opens a new door.', '每一种语言都打开一扇新的门。') }}</p>
          <span class="gv-key">
            {{ t('划词结果 → 制作卡片 → 保存图片', 'Selection result → Create card → Save image') }}
          </span>
        </div>
      </template>
      <template v-else-if="kind === 'learning'">
        <div class="gv-sentence">
          <span>{{ t('原文', 'Original') }}</span>
          <p>
            <mark :class="{ 'gv-selected': step >= 1 }">
              {{ t('Every language opens a new door.', '每一种语言都打开一扇新的门。') }}
            </mark>
          </p>
          <div v-if="changed" class="gv-result">
            <strong>{{ t('✓ 已收藏', '✓ Saved') }}</strong>
            <p>{{ t('每一种语言都打开一扇新的门。', 'Every language opens a new door.') }}</p>
          </div>
          <span v-else class="gv-key">
            {{
              t(
                '选中句子后在翻译结果中点击收藏',
                'Select a sentence and save it from the translation result'
              )
            }}
          </span>
        </div>
      </template>
      <template v-else-if="kind === 'provider'">
        <div class="gv-provider">
          <div>
            <span class="gv-service-icon">↔</span>
            <b>{{ changed ? 'AI' : t('免费翻译服务', 'Free translation') }}</b>
            <small>
              {{
                changed
                  ? t('已配置的服务与模型', 'Your configured provider and model')
                  : t('可直接使用', 'Ready to use')
              }}
            </small>
          </div>
          <div class="gv-connection">
            <span>{{ t('服务', 'Provider') }}</span>
            <b>
              {{
                changed
                  ? t('选择已配置的 AI 服务', 'Choose your configured AI provider')
                  : t('免费翻译服务', 'Free translation')
              }}
            </b>
            <span>
              {{
                changed
                  ? t('密钥 · 保存在浏览器中', 'API key · stored in your browser')
                  : t('目标语言 · 简体中文', 'Target language · English')
              }}
            </span>
            <strong>{{ changed ? '••••••••' : t('直接翻译', 'Start translating') }}</strong>
          </div>
        </div>
      </template>
      <template v-else-if="kind === 'appearance'">
        <div class="gv-sentence">
          <span>{{ t('原文与译文', 'Original & translation') }}</span>
          <p>Every language opens a new door.</p>
          <p class="gv-styled" :class="`gv-style-${style}`">
            {{ t('每一种语言都打开一扇新的门。', 'Every language opens a new door.') }}
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
        </div>
      </template>
      <template v-else-if="['backup', 'privacy'].includes(kind)">
        <TransferFlow
          :kind="kind === 'backup' ? 'backup' : 'privacy'"
          :en="english"
          :running="running"
        />
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
        </p>
      </template>
      <template v-else-if="kind === 'glossary'">
        <div class="gv-sentence">
          <span>{{ t('术语示例', 'Example term') }}</span>
          <p>FluentRead opens a new door.</p>
          <div class="gv-term">
            <b>FluentRead</b>
            <span aria-hidden="true">→</span>
            <b>{{ t('流畅阅读', 'FluentRead') }}</b>
          </div>
          <p class="gv-output">
            {{
              changed
                ? t('流畅阅读打开一扇新的门。', 'FluentRead opens a new door.')
                : t('添加术语后，翻译会参考指定译法。', 'Add a term to guide the translation.')
            }}
          </p>
        </div>
      </template>
      <template v-else-if="kind === 'rules'">
        <div class="gv-connection">
          <span>{{ t('网站规则', 'Site rule') }}</span>
          <b>example.com</b>
          <div class="gv-rule-row">
            <span>{{ t('自动翻译', 'Automatic translation') }}</span>
            <span class="gv-toggle" :class="{ enabled: changed }" aria-hidden="true"></span>
          </div>
          <p>
            {{
              changed
                ? t('再次打开这个网站时自动翻译', 'Translate automatically when you return')
                : t('为这个网站设置是否自动翻译', 'Set a rule for the sites you read')
            }}
          </p>
        </div>
      </template>
      <template v-else-if="kind === 'stats'">
        <div class="gv-chart" :aria-label="t('示例用量图', 'Example activity chart')">
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
        </p>
      </template>
      <template v-else>
        <div class="gv-shortcut">
          <kbd>Alt</kbd>
          <span>+</span>
          <kbd>T</kbd>
          <span>→</span>
          <b>
            {{
              changed ? t('恢复原文', 'Restore original') : t('翻译当前网页', 'Translate this page')
            }}
          </b>
        </div>
        <p class="gv-flow-note">
          {{
            t('Mac 使用 Option；可在设置中修改。', 'Use Option on Mac. Customize it in settings.')
          }}
        </p>
      </template>
    </div>
    <div v-if="kind !== 'privacy'" class="gv-controls">
      <small>{{ t('自动演示 · 示例内容', 'Auto demo · sample content') }}</small>
      <div>
        <button
          v-if="!reduced"
          type="button"
          :aria-label="
            playing ? t('暂停图解演示', 'Pause walkthrough') : t('播放图解演示', 'Play walkthrough')
          "
          @click="playing = !playing"
        >
          {{ playing ? t('暂停', 'Pause') : t('播放', 'Play') }}
        </button>
        <button type="button" @click="replay">{{ t('重播', 'Replay') }}</button>
      </div>
    </div>
  </div>
</template>
