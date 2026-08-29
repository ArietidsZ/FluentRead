'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const extensionDir = path.resolve(argument('extension-dir', '.output/chrome-mv3'));
const playwrightRoot = path.resolve(argument('playwright-root', ''));
// 统一回归 runner 使用 --focus-safe-helper；旧的 --focus-helper 仅保留为本脚本的兼容别名。
const focusHelper = path.resolve(argument('focus-safe-helper', argument('focus-helper', '')));
const artifactsDir = path.resolve(argument('artifacts-dir', '/private/tmp/fluentread-settings-center-ui'));
const browserPath = argument('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
const timeout = Number(argument('timeout', '30000'));
const expectedNavigation = [
  ['settings-general', '通用设置'],
  ['settings-services', '翻译服务'],
  ['settings-translation', '翻译设置'],
  ['settings-image-translation', '图片与圈选翻译'],
  ['settings-video', '视频字幕翻译'],
  ['settings-sites', '网站规则'],
  ['settings-translation-center', '翻译中心'],
  ['settings-vocabulary', '单词本'],
  ['settings-advanced', '高级选项'],
  ['settings-data', '配置管理'],
  ['settings-about', '关于流畅阅读'],
];
const expectedGeneralGroups = ['选择翻译服务', '译文显示', '网页辅助'];
const expectedTranslationGroups = ['鼠标悬浮翻译', '划词翻译', '输入框翻译', '全文翻译'];

if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error(`扩展产物不存在：${extensionDir}`);
if (!fs.existsSync(focusHelper)) throw new Error(`防抢焦点 helper 不存在：${focusHelper}`);
fs.mkdirSync(artifactsDir, {recursive: true});

const {chromium} = require(path.join(playwrightRoot, 'playwright'));
const {
  launchFocusSafePersistentContext,
  newPageWithoutForeground,
} = require(focusHelper);

async function screenshot(page, file) {
  const target = path.join(artifactsDir, file);
  await page.screenshot({path: target, fullPage: false});
  return target;
}

async function chooseDifferentSelectOption(page, ariaLabel) {
  const input = page.locator(`input[aria-label="${ariaLabel}"]`);
  await input.waitFor({state: 'visible', timeout});
  const wrapper = input.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " el-select__wrapper ")][1]');
  const selectedLabel = wrapper.locator('.el-select__placeholder');
  const before = (await selectedLabel.textContent())?.trim();
  await wrapper.click();
  const options = page.locator('.el-select-dropdown:visible .el-select-dropdown__item:not(.is-disabled)');
  await options.first().waitFor({state: 'visible', timeout});
  for (let index = 0; index < await options.count(); index += 1) {
    const option = options.nth(index);
    if ((await option.textContent())?.trim() !== before) {
      await option.click();
      await page.waitForFunction(
        ({label, previous}) => document.querySelector(`input[aria-label="${label}"]`)
          ?.closest('.el-select__wrapper')
          ?.querySelector('.el-select__placeholder')
          ?.textContent?.trim() !== previous,
        {label: ariaLabel, previous: before},
        {timeout},
      );
      const after = (await selectedLabel.textContent())?.trim();
      if (after === before) throw new Error(`${ariaLabel} 未切换到其他选项`);
      return {before, after};
    }
  }
  throw new Error(`${ariaLabel} 没有可切换的选项`);
}

function assertExportContainsNoDedicatedCredentials(value) {
  const credentialFields = [
    'token', 'ak', 'sk', 'appid', 'key', 'youdaoAppKey', 'youdaoAppSecret',
    'tencentSecretId', 'tencentSecretKey', 'extra',
  ];
  for (const field of credentialFields) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`导出配置仍包含专用凭据字段：${field}`);
    }
  }
}

async function main() {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-settings-center-profile-'));
  const errors = [];
  const report = {
    extensionDir,
    artifactsDir,
    launchMode: null,
    focusPolicy: null,
    windowPlacement: null,
    navigation: [],
    responsive: [],
    defaultServiceCard: {responsive: []},
    informationArchitecture: {},
    assertions: {},
    consoleErrors: errors,
    screenshots: [],
  };
  let launched;
  try {
    launched = await launchFocusSafePersistentContext({
      chromium,
      profileDir,
      browserPath,
      headless: false,
      background: true,
      browserArgs: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
      viewport: {width: 1440, height: 1000},
      timeout,
    });
    report.launchMode = launched.launchMode;
    report.focusPolicy = launched.focusPolicy;
    report.windowPlacement = launched.windowPlacement;
    const {context} = launched;
    let workers = context.serviceWorkers().filter(worker => worker.url().startsWith('chrome-extension://'));
    if (workers.length === 0) workers = [await context.waitForEvent('serviceworker', {timeout})];
    const extensionId = new URL(workers[0].url()).host;
    const page = await newPageWithoutForeground(context, timeout);
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    await page.goto(`chrome-extension://${extensionId}/options.html#settings-general`, {waitUntil: 'domcontentloaded', timeout});
    await page.locator('.settings-app').waitFor({state: 'visible', timeout});
    await page.setViewportSize({width: 1440, height: 1000});

    const navButtons = page.locator('nav[aria-label="设置分类"] button');
    const navCount = await navButtons.count();
    if (navCount !== expectedNavigation.length) throw new Error(`导航数量异常：${navCount}`);
    const ids = await navButtons.evaluateAll(buttons => buttons.map(button => button.dataset.section));
    if (new Set(ids).size !== ids.length) throw new Error('导航 section id 重复');
    const navigationContract = await navButtons.evaluateAll(buttons => buttons.map(button => [
      button.dataset.section,
      button.querySelector('strong')?.textContent?.trim(),
    ]));
    if (JSON.stringify(navigationContract) !== JSON.stringify(expectedNavigation)) {
      throw new Error(`导航顺序或名称异常：${JSON.stringify(navigationContract)}`);
    }
    report.informationArchitecture.navigation = navigationContract;

    for (let index = 0; index < navCount; index += 1) {
      const button = navButtons.nth(index);
      const id = await button.getAttribute('data-section');
      const label = (await button.locator('strong').textContent())?.trim();
      await button.click();
      const activeButtons = page.locator('nav[aria-label="设置分类"] button[aria-current="page"]');
      if (await activeButtons.count() !== 1 || await activeButtons.first().getAttribute('data-section') !== id) {
        throw new Error(`${id} 导航激活状态异常`);
      }
      const anchor = page.locator(`#${id}`);
      if (await anchor.count() !== 1 || !await anchor.isVisible()) throw new Error(`页面锚点不可见：${id}`);
      const visiblePageHeadings = await page.locator('.topbar h1:visible').count();
      if (visiblePageHeadings !== 1) throw new Error(`${id} 页面级标题数量异常：${visiblePageHeadings}`);
      if (await page.locator('.card-intro:visible').count() !== 0) throw new Error(`${id} 仍有重复 card intro`);
      const metrics = await page.evaluate(() => ({
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      if (metrics.horizontalOverflow) throw new Error(`${id} 出现横向滚动：${JSON.stringify(metrics)}`);
      const file = `settings-${String(index + 1).padStart(2, '0')}-${id}.png`;
      report.screenshots.push(await screenshot(page, file));
      report.navigation.push({id, label, title: (await page.locator('.topbar h1').textContent())?.trim(), metrics});
    }
    report.assertions.navigation = true;
    report.assertions.singlePageIntro = true;
    report.assertions.noLegacyIntros = await page.locator('.video-settings-hero, .image-ocr-kicker, .site-rules-kicker').count() === 0;
    if (!report.assertions.noLegacyIntros) throw new Error('仍存在旧的重复介绍元素');

    await page.locator('button[data-section="settings-general"]').click();
    const themeGroup = page.getByRole('radiogroup', {name: '界面主题'});
    const initialThemeRadio = themeGroup.locator('[role="radio"][aria-checked="true"]');
    await initialThemeRadio.focus();
    await initialThemeRadio.press('ArrowRight');
    await page.waitForTimeout(50);
    const keyboardSelectedTheme = themeGroup.locator('[role="radio"][aria-checked="true"]');
    if (await keyboardSelectedTheme.count() !== 1 || !await keyboardSelectedTheme.evaluate(element => element === document.activeElement)) {
      throw new Error('分段选择器没有用方向键切换并移动焦点');
    }
    await themeGroup.getByRole('radio', {name: '暗色主题', exact: true}).click();
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'), undefined, {timeout});
    const darkColors = await page.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      sidebar: getComputedStyle(document.querySelector('.sidebar')).backgroundColor,
      surface: getComputedStyle(document.querySelector('.settings-group-body')).backgroundColor,
    }));
    const isDarkColor = value => {
      const channels = value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) || [];
      return channels.length === 3 && channels.reduce((sum, channel) => sum + channel, 0) / 3 < 90;
    };
    if (!Object.values(darkColors).every(isDarkColor)) throw new Error(`暗色主题表面仍为亮色：${JSON.stringify(darkColors)}`);
    report.screenshots.push(await screenshot(page, 'settings-dark-general.png'));
    await page.locator('button[data-section="settings-services"]').click();
    report.screenshots.push(await screenshot(page, 'settings-dark-services.png'));
    await page.locator('button[data-section="settings-translation"]').click();
    report.screenshots.push(await screenshot(page, 'settings-dark-translation.png'));
    await page.locator('button[data-section="settings-data"]').click();
    report.screenshots.push(await screenshot(page, 'settings-dark-data.png'));
    await page.locator('button[data-section="settings-general"]').click();
    await themeGroup.getByRole('radio', {name: '亮色主题', exact: true}).click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark'), undefined, {timeout});
    report.assertions.segmentedKeyboard = true;
    report.assertions.darkTheme = true;

    const generalSection = page.locator('#settings-general');
    const generalGroups = (await page.locator('.settings-section:visible .settings-group-heading h2').allTextContents())
      .map(title => title.trim());
    if (JSON.stringify(generalGroups) !== JSON.stringify(expectedGeneralGroups)) {
      throw new Error(`通用设置分组异常：${JSON.stringify(generalGroups)}`);
    }
    report.informationArchitecture.generalGroups = generalGroups;

    const defaultServiceCard = generalSection.getByTestId('default-translation-service-card');
    await defaultServiceCard.waitFor({state: 'visible', timeout});
    const defaultServiceMetrics = await defaultServiceCard.evaluate(card => {
      const item = card.closest('.settings-item');
      const label = item?.querySelector('.settings-item-copy strong');
      const description = item?.querySelector('.settings-item-copy small');
      const icon = card.querySelector('.service-brand-icon');
      const selected = card.querySelector('.el-select__placeholder');
      const cardStyle = getComputedStyle(card);
      const iconRect = icon?.getBoundingClientRect();
      const selectRect = card.querySelector('.el-select')?.getBoundingClientRect();
      return {
        defaultService: card.getAttribute('data-default-service'),
        label: label?.textContent?.trim(),
        description: description?.textContent?.trim(),
        selectedService: selected?.textContent?.trim(),
        backgroundImage: cardStyle.backgroundImage,
        controlShadow: cardStyle.boxShadow,
        controlDisplay: cardStyle.display,
        iconWidth: iconRect?.width || 0,
        selectWidth: selectRect?.width || 0,
      };
    });
    if (!defaultServiceMetrics.defaultService
      || defaultServiceMetrics.label !== '默认网页翻译服务'
      || defaultServiceMetrics.description !== '全文、悬浮和划词翻译默认使用此服务。'
      || !defaultServiceMetrics.selectedService
      || defaultServiceMetrics.backgroundImage !== 'none'
      || defaultServiceMetrics.controlShadow !== 'none'
      || defaultServiceMetrics.controlDisplay !== 'grid'
      || defaultServiceMetrics.iconWidth < 39
      || defaultServiceMetrics.selectWidth < 180) {
      throw new Error(`默认翻译服务没有融入标准设置行：${JSON.stringify(defaultServiceMetrics)}`);
    }
    report.defaultServiceCard.desktop = defaultServiceMetrics;
    report.screenshots.push(await screenshot(page, 'settings-default-service-light.png'));
    report.assertions.defaultServiceHarmonious = true;

    const aiContextSwitch = page.getByRole('switch', {name: 'AI 智能上下文', exact: true});
    if (await aiContextSwitch.count() !== 1) throw new Error('通用设置没有唯一的 AI 智能上下文开关');
    if (await aiContextSwitch.isDisabled()) throw new Error('机器翻译作为默认服务时，AI 智能上下文开关不可操作');
    const aiContextControl = aiContextSwitch.locator('..');
    if (!await aiContextControl.isVisible()) throw new Error('AI 智能上下文开关没有可见的交互控件');
    const aiContextBefore = await aiContextSwitch.getAttribute('aria-checked');
    if (!['true', 'false'].includes(aiContextBefore)) throw new Error(`AI 智能上下文开关状态异常：${aiContextBefore}`);
    await aiContextControl.click();
    await page.waitForFunction(
      previous => document.querySelector('[aria-label="AI 智能上下文"]')
        ?.getAttribute('aria-checked') !== previous,
      aiContextBefore,
      {timeout},
    );
    const aiContextAfter = await aiContextSwitch.getAttribute('aria-checked');
    await aiContextControl.click();
    await page.waitForFunction(
      expected => document.querySelector('[aria-label="AI 智能上下文"]')
        ?.getAttribute('aria-checked') === expected,
      aiContextBefore,
      {timeout},
    );
    const aiContextRestored = await aiContextSwitch.getAttribute('aria-checked');

    await page.locator('button[data-section="settings-services"]').click();
    const servicesSection = page.locator('#settings-services');
    const serviceCatalog = servicesSection.locator('.service-catalog');
    await serviceCatalog.waitFor({state: 'visible', timeout});
    const serviceOnlyMetrics = {
      catalogCount: await serviceCatalog.count(),
      defaultCardCount: await servicesSection.getByTestId('default-translation-service-card').count(),
      defaultSelectCount: await servicesSection.locator('[aria-label="默认网页翻译服务"]').count(),
      settingsGroupCount: await servicesSection.locator('.settings-group').count(),
      defaultService: await serviceCatalog.getAttribute('data-default-service'),
    };
    if (serviceOnlyMetrics.catalogCount !== 1
      || serviceOnlyMetrics.defaultCardCount !== 0
      || serviceOnlyMetrics.defaultSelectCount !== 0
      || serviceOnlyMetrics.settingsGroupCount !== 0
      || serviceOnlyMetrics.defaultService !== defaultServiceMetrics.defaultService) {
      throw new Error(`翻译服务页不是纯服务目录：${JSON.stringify(serviceOnlyMetrics)}`);
    }
    const defaultServiceItem = serviceCatalog.locator(
      `.service-item[data-service-value="${defaultServiceMetrics.defaultService}"]`,
    );
    if (await defaultServiceItem.count() !== 1) throw new Error('服务目录没有显示当前默认服务');
    const defaultServiceKind = (await defaultServiceItem.locator('.service-copy small').textContent())?.trim();
    if (defaultServiceKind !== '机器翻译') {
      throw new Error(`AI 上下文开关用例没有运行在机器默认服务下：${defaultServiceKind}`);
    }
    report.informationArchitecture.services = serviceOnlyMetrics;
    report.informationArchitecture.machineDefaultAiContext = {
      defaultService: defaultServiceMetrics.defaultService,
      serviceKind: defaultServiceKind,
      before: aiContextBefore,
      after: aiContextAfter,
      restored: aiContextRestored,
    };
    report.assertions.servicesCatalogOnly = true;
    report.assertions.machineDefaultAiContextOperable = true;

    await page.locator('button[data-section="settings-translation"]').click();
    const translationSection = page.locator('#settings-translation');
    await translationSection.waitFor({state: 'visible', timeout});
    const translationGroups = (await page.locator('.settings-section:visible .settings-group-heading h2').allTextContents())
      .map(title => title.trim());
    if (JSON.stringify(translationGroups) !== JSON.stringify(expectedTranslationGroups)) {
      throw new Error(`翻译设置分组顺序异常：${JSON.stringify(translationGroups)}`);
    }
    report.informationArchitecture.translationGroups = translationGroups;
    report.assertions.translationGroupOrder = true;

    await page.locator('button[data-section="settings-general"]').click();
    const targetChange = await chooseDifferentSelectOption(page, '默认目标语言');
    await page.waitForTimeout(500);
    await page.locator('button[data-section="settings-data"]').click();
    await page.getByRole('heading', {name: '最近修改', exact: true}).waitFor({state: 'visible', timeout});
    await page.getByRole('heading', {name: '定时备份', exact: true}).waitFor({state: 'visible', timeout});
    const recentEntries = page.locator('#settings-data .version-panel').nth(0).locator('.version-entry');
    const backupEntries = page.locator('#settings-data .version-panel').nth(1).locator('.version-entry');
    if (await recentEntries.count() < 1 || await backupEntries.count() < 1) throw new Error('最近修改或定时备份没有建立基线');
    await backupEntries.first().click();
    const previewDialog = page.locator('.config-preview-dialog:visible');
    await previewDialog.waitFor({state: 'visible', timeout});
    const diffCount = await previewDialog.locator('.diff-item').count();
    if (diffCount < 1) throw new Error('配置版本详情没有显示与当前配置的差异');
    const restoreButton = previewDialog.getByRole('button', {name: '恢复此版本', exact: true});
    if (await restoreButton.isDisabled()) throw new Error('存在差异时恢复按钮仍不可用');
    await page.waitForTimeout(250);
    report.screenshots.push(await screenshot(page, 'settings-config-version-preview.png'));
    await restoreButton.click();
    const restoreConfirm = page.locator('.el-message-box:visible');
    await restoreConfirm.waitFor({state: 'visible', timeout});
    await restoreConfirm.getByRole('button', {name: '恢复', exact: true}).click();
    await previewDialog.waitFor({state: 'hidden', timeout});

    await page.locator('button[data-section="settings-general"]').click();
    const targetInput = page.locator('input[aria-label="默认目标语言"]');
    await targetInput.waitFor({state: 'visible', timeout});
    await page.waitForFunction(
      ({selector, expected}) => document.querySelector(selector)
        ?.closest('.el-select__wrapper')
        ?.querySelector('.el-select__placeholder')
        ?.textContent?.trim() === expected,
      {selector: 'input[aria-label="默认目标语言"]', expected: targetChange.before},
      {timeout},
    );

    await page.locator('button[data-section="settings-data"]').click();
    const downloadPromise = page.waitForEvent('download', {timeout});
    await page.getByRole('button', {name: '导出配置', exact: true}).click();
    const download = await downloadPromise;
    if (!/^fluentread-config-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename())) {
      throw new Error(`导出文件名异常：${download.suggestedFilename()}`);
    }
    const exportedFile = path.join(artifactsDir, download.suggestedFilename());
    await download.saveAs(exportedFile);
    const exportedConfig = JSON.parse(fs.readFileSync(exportedFile, 'utf8'));
    assertExportContainsNoDedicatedCredentials(exportedConfig);

    const legacyCredentialSentinel = 'legacy-preview-secret-sentinel';
    const importedConfig = {
      ...exportedConfig,
      to: exportedConfig.to === 'en' ? 'ja' : 'en',
      token: {openai: legacyCredentialSentinel},
    };
    await page.getByRole('button', {name: '粘贴 JSON', exact: true}).click();
    const pasteDialog = page.locator('.el-dialog:visible').filter({hasText: '粘贴配置 JSON'});
    await pasteDialog.waitFor({state: 'visible', timeout});
    await pasteDialog.getByLabel('配置 JSON').fill(JSON.stringify(importedConfig));
    await pasteDialog.getByRole('button', {name: '查看差异', exact: true}).click();
    await previewDialog.waitFor({state: 'visible', timeout});
    if (await previewDialog.locator('.diff-item').count() < 1) throw new Error('导入预览没有显示差异');
    await previewDialog.getByText('OpenAI API Key', {exact: true}).waitFor({state: 'visible', timeout});
    await previewDialog.getByText('将新增（内容已隐藏）', {exact: true}).waitFor({state: 'visible', timeout});
    if ((await previewDialog.textContent()).includes(legacyCredentialSentinel)) throw new Error('导入预览泄露了凭据内容');
    await previewDialog.getByRole('button', {name: '确认导入', exact: true}).click();
    const importConfirm = page.locator('.el-message-box:visible');
    await importConfirm.waitFor({state: 'visible', timeout});
    await importConfirm.getByRole('button', {name: '导入', exact: true}).click();
    await previewDialog.waitFor({state: 'hidden', timeout});

    await page.locator('button[data-section="settings-general"]').click();
    await page.waitForFunction(
      ({selector, expected}) => document.querySelector(selector)
        ?.closest('.el-select__wrapper')
        ?.querySelector('.el-select__placeholder')
        ?.textContent?.trim() === expected,
      {selector: 'input[aria-label="默认目标语言"]', expected: importedConfig.to === 'en' ? '英语' : '日语'},
      {timeout},
    );
    await page.locator('button[data-section="settings-data"]').click();
    report.assertions.twoBackupStreams = true;
    report.assertions.previewBeforeRestore = true;
    report.assertions.restoreWithConfirmation = true;
    report.assertions.exportDownload = true;
    report.assertions.importPreview = true;

    for (const viewport of [
      {width: 1366, height: 700},
      {width: 1024, height: 900},
      {width: 820, height: 900},
      {width: 390, height: 844},
    ]) {
      await page.setViewportSize(viewport);
      await page.locator('button[data-section="settings-general"]').click();
      await page.waitForTimeout(150);
      const serviceCardLayout = await defaultServiceCard.evaluate(card => {
        const item = card.closest('.settings-item');
        const cardRect = card.getBoundingClientRect();
        const itemRect = item?.getBoundingClientRect();
        const copyRect = item?.querySelector('.settings-item-copy')?.getBoundingClientRect();
        return {
          withinViewport: Boolean(itemRect && itemRect.left >= -1 && itemRect.right <= window.innerWidth + 1),
          stacked: Boolean(copyRect && cardRect.top >= copyRect.bottom - 1),
          controlWidth: cardRect.width,
        };
      });
      if (!serviceCardLayout.withinViewport) throw new Error(`${viewport.width}px 默认服务卡超出视口`);
      if (viewport.width <= 480 && !serviceCardLayout.stacked) throw new Error(`${viewport.width}px 默认服务设置行没有纵向排列`);
      const generalMetrics = await page.evaluate(() => ({
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        sectionWithinViewport: [...document.querySelectorAll('.settings-section')]
          .filter(section => getComputedStyle(section).display !== 'none')
          .every(section => {
            const rect = section.getBoundingClientRect();
            return rect.left >= -1 && rect.right <= window.innerWidth + 1;
          }),
        activeNavigationVisible: (() => {
          const active = document.querySelector('nav[aria-label="设置分类"] button[aria-current="page"]');
          if (!active) return false;
          const rect = active.getBoundingClientRect();
          return rect.left >= -1
            && rect.right <= window.innerWidth + 1
            && rect.top >= -1
            && rect.bottom <= window.innerHeight + 1;
        })(),
      }));
      if (generalMetrics.horizontalOverflow
        || !generalMetrics.sectionWithinViewport
        || !generalMetrics.activeNavigationVisible) {
        throw new Error(`${viewport.width}px 通用设置响应式异常：${JSON.stringify(generalMetrics)}`);
      }
      const generalFile = `settings-general-${viewport.width}.png`;
      report.screenshots.push(await screenshot(page, generalFile));
      report.defaultServiceCard.responsive.push({...viewport, ...serviceCardLayout});
      report.responsive.push({page: 'settings-general', ...viewport, ...generalMetrics});

      await page.locator('button[data-section="settings-translation"]').click();
      await page.waitForTimeout(150);
      const translationMetrics = await page.evaluate(expectedGroups => ({
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        groupOrder: [...document.querySelectorAll('.settings-section')]
          .filter(section => getComputedStyle(section).display !== 'none')
          .flatMap(section => [...section.querySelectorAll('.settings-group-heading h2')])
          .map(heading => heading.textContent?.trim()),
        groupsWithinViewport: [...document.querySelectorAll('.settings-section')]
          .filter(section => getComputedStyle(section).display !== 'none')
          .flatMap(section => [...section.querySelectorAll('.settings-group')])
          .every(group => {
            const rect = group.getBoundingClientRect();
            return rect.left >= -1 && rect.right <= window.innerWidth + 1;
          }),
        expectedOrder: JSON.stringify(expectedGroups),
        activeNavigationVisible: (() => {
          const active = document.querySelector('nav[aria-label="设置分类"] button[aria-current="page"]');
          if (!active) return false;
          const rect = active.getBoundingClientRect();
          return rect.left >= -1
            && rect.right <= window.innerWidth + 1
            && rect.top >= -1
            && rect.bottom <= window.innerHeight + 1;
        })(),
      }), expectedTranslationGroups);
      if (translationMetrics.horizontalOverflow
        || !translationMetrics.groupsWithinViewport
        || !translationMetrics.activeNavigationVisible
        || JSON.stringify(translationMetrics.groupOrder) !== translationMetrics.expectedOrder) {
        throw new Error(`${viewport.width}px 翻译设置响应式异常：${JSON.stringify(translationMetrics)}`);
      }
      const translationFile = `settings-translation-${viewport.width}.png`;
      report.screenshots.push(await screenshot(page, translationFile));
      report.responsive.push({page: 'settings-translation', ...viewport, ...translationMetrics});
    }
    report.assertions.responsive = true;
    if (errors.length) throw new Error(`浏览器控制台存在错误：${errors.join(' | ')}`);
  } finally {
    fs.writeFileSync(path.join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    await launched?.close();
    fs.rmSync(profileDir, {recursive: true, force: true});
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
