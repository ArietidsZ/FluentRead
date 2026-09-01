<!--
 @file src/app/options/OptionsApp.vue
 文件职责：实现扩展 Options 页的顶层布局，组织设置导航、全局搜索结果和生词本入口，并把选中分区交给对应 feature UI。
 主要内容：渲染品牌侧栏、版本信息、搜索框与主内容区，复用 settingsNavigation 的项目解析/过滤逻辑，在 SettingsSections 与 VocabularyBook 之间切换，并从 URL hash 恢复目标分区。
 模块边界：组件只负责页面壳与导航状态，不定义具体配置字段、不直接写 browser.storage，也不实现词汇仓库；设置表单和生词本业务由各 feature 组件拥有。
-->
<template>
  <div class="settings-app">
    <aside class="sidebar">
      <div class="brand">
        <img src="/icon/128.png" alt="" />
        <div><strong>流畅阅读</strong></div>
      </div>

      <nav ref="navigationElement" :aria-label="t('options.navLabel')">
        <section v-for="group in localizedNavigationGroups" :key="group.label" class="nav-group">
          <span class="nav-group-label">{{ group.label }}</span>
          <button
            v-for="item in group.items"
            :key="item.id"
            type="button"
            :data-section="item.id"
            :class="{ active: activeSection === item.id }"
            :aria-current="activeSection === item.id ? 'page' : undefined"
            @click="selectSection(item.id)"
          >
            <span class="nav-icon">{{ item.icon }}</span>
            <strong>{{ item.label }}</strong>
          </button>
        </section>
      </nav>
    </aside>

    <main class="workspace">
      <header class="topbar">
        <div>
          <h1>{{ activeItem.title }}</h1>
          <p>{{ activeItem.detail }}</p>
        </div>
        <div class="topbar-tools">
          <UiLanguageSelector />
          <label class="search-box">
            <span aria-hidden="true">⌕</span>
            <input v-model.trim="query" type="search" :placeholder="t('options.searchPlaceholder')" />
          </label>
        </div>
      </header>

      <div v-if="query && filteredResults.length" class="search-results">
        <button v-for="result in filteredResults" :key="result.id" type="button" @click="selectResult(result.id)">
          <span><strong>{{ result.label }}</strong><small>{{ result.searchDescription }}</small></span><b>打开 →</b>
        </button>
      </div>
      <div v-else-if="query" class="search-empty">{{ t('options.searchEmpty', {query}) }}</div>

      <section class="settings-card" :class="{ 'services-view': activeSection === 'settings-services', 'translation-center-view': activeSection === 'settings-translation-center', 'vocabulary-view': activeSection === 'settings-vocabulary' }" :aria-label="activeItem.heading">
        <section v-if="activeSection === 'settings-about'" id="settings-about" class="about-page" aria-labelledby="about-title">
          <div class="about-hero">
            <img class="about-logo" src="/icon/128.png" alt="流畅阅读图标" />
            <div>
              <h3 id="about-title">让双语阅读自然发生</h3>
              <p>流畅阅读是一款开源浏览器翻译插件，帮助你在阅读网页时更自然地理解不同语言的内容。</p>
              <span class="about-version">FluentRead · V{{ version }}</span>
            </div>
          </div>

          <div class="about-grid">
            <article class="about-panel">
              <span class="about-panel-kicker">核心体验</span>
              <h3>为阅读而生</h3>
              <p>从网页翻译到划词、悬浮与快捷键，把常用能力放在真正需要的位置。</p>
              <div class="about-feature-list">
                <span><b>译</b>网页双语阅读</span>
                <span><b>⌘</b>顺手的阅读工具</span>
                <span><b>AI</b>灵活的翻译服务</span>
              </div>
            </article>

            <article class="about-panel about-links-panel">
              <span class="about-panel-kicker">了解更多</span>
              <h3>一起让它变得更好</h3>
              <p>查看项目代码、使用文档，或反馈你在阅读中的想法。</p>
              <div class="about-links">
                <a href="https://github.com/Bistutu/FluentRead" target="_blank" rel="noreferrer">开源项目 <span>↗</span></a>
                <a href="https://fluent.thinkstu.com/" target="_blank" rel="noreferrer">使用文档 <span>↗</span></a>
                <a href="https://github.com/Bistutu/FluentRead/issues" target="_blank" rel="noreferrer">问题反馈 <span>↗</span></a>
              </div>
            </article>
          </div>

          <p class="about-footer">感谢你使用流畅阅读。</p>
        </section>
        <VocabularyBook v-else-if="activeSection === 'settings-vocabulary'" @navigate="selectSection" />
        <SettingsSections v-else :active-section="activeSection" />
      </section>

    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SettingsSections from '@/src/features/settings/ui/SettingsSections.vue'
import VocabularyBook from '@/src/features/vocabulary/ui/VocabularyBook.vue'
import UiLanguageSelector from '@/src/ui/components/UiLanguageSelector.vue'
import {useUiI18n} from '@/src/ui/i18n'
import {
  navigationGroups,
  navigationItems,
  resolveNavigationItem,
  resolveRequestedSection,
} from '@/src/features/settings/model/navigation'

const version = process.env.VUE_APP_VERSION
const {t, translateLegacy} = useUiI18n()
const query = ref('')
const activeSection = ref('settings-general')
const navigationElement = ref<HTMLElement | null>(null)
const mobileNavigationMedia = window.matchMedia('(max-width: 700px)')

const navigation = navigationItems
const localizedNavigationGroups = computed(() => navigationGroups.map((group) => ({
  ...group,
  label: translateLegacy(group.label),
  items: group.items.map((item) => ({
    ...item,
    label: translateLegacy(item.label),
    description: translateLegacy(item.description),
    heading: translateLegacy(item.heading),
    summary: translateLegacy(item.summary),
    kicker: translateLegacy(item.kicker),
    title: translateLegacy(item.title),
    detail: translateLegacy(item.detail),
    searchDescription: translateLegacy(item.searchDescription),
  })),
})))
const localizedNavigationItems = computed(() => localizedNavigationGroups.value.flatMap((group) => group.items))
const activeItem = computed(() => localizedNavigationItems.value.find((item) => item.id === resolveNavigationItem(activeSection.value).id)
  || localizedNavigationItems.value[0])

const filteredResults = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase()
  if (!keyword) return []
  return localizedNavigationItems.value.filter((item) => (
    `${item.label}${item.description}${item.heading}${item.summary}${item.searchDescription}`
      .toLocaleLowerCase()
      .includes(keyword)
  ))
})

function selectSection(id: string) {
  if (!navigation.some((item) => item.id === id)) return
  activeSection.value = id
  query.value = ''
  history.replaceState(null, '', `#${id}`)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function selectResult(id: string) {
  selectSection(id)
}

async function revealActiveNavigation() {
  await nextTick()
  navigationElement.value
    ?.querySelector<HTMLElement>(`button[data-section="${activeSection.value}"]`)
    ?.scrollIntoView({
      block: 'nearest',
      inline: mobileNavigationMedia.matches ? 'center' : 'nearest',
    })
}

watch(activeSection, () => {
  void revealActiveNavigation()
})

function handleMobileNavigationChange() {
  void revealActiveNavigation()
}

onMounted(() => {
  activeSection.value = resolveRequestedSection(window.location.hash)
  mobileNavigationMedia.addEventListener('change', handleMobileNavigationChange)
  void revealActiveNavigation()
})

onBeforeUnmount(() => {
  mobileNavigationMedia.removeEventListener('change', handleMobileNavigationChange)
})
</script>
