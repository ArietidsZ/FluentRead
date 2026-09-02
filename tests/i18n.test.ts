import {describe, expect, it} from 'vitest';

import {
  DEFAULT_UI_LANGUAGE,
  getUiLanguageBilingualLabel,
  getUiLanguageDisplayLabel,
  UI_LANGUAGE_OPTIONS,
  normalizeUiLanguage,
  resolveUiLanguageFromLocale,
  translate,
  translateLegacyText,
} from '@/src/core/i18n';
import {enUSLegacyText, enUSMessages} from '@/src/core/i18n/messages/en-US';
import {esESLegacyText, esESMessages} from '@/src/core/i18n/messages/es-ES';
import {frFRLegacyText, frFRMessages} from '@/src/core/i18n/messages/fr-FR';
import {jaJPLegacyText, jaJPMessages} from '@/src/core/i18n/messages/ja-JP';
import {koKRLegacyText, koKRMessages} from '@/src/core/i18n/messages/ko-KR';
import {ruRULegacyText, ruRUMessages} from '@/src/core/i18n/messages/ru-RU';
import {zhCNMessages} from '@/src/core/i18n/messages/zh-CN';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {translationLoadingStyleOptions} from '@/src/core/config/translationLoadingStyle';
import {popupModuleOptions, popupQuickFeatureOptions} from '@/src/core/config/interfaceAppearance';
import {buildConfigDiff} from '@/src/core/config/diff';
import {getMultilingualTargetLanguageLabel, options} from '@/src/core/config/catalog';
import {prepareConfigForExport, prepareConfigForImport} from '@/src/core/config/transfer';
import {toRestorableConfig} from '@/src/services/config/history';
import {getContextMenuTitle} from '@/src/app/background/contextMenuUi';
import {navigationItems} from '@/src/features/settings/model/navigation';

describe('界面 i18n 契约', () => {
  const translatedCatalogs: ReadonlyArray<Readonly<Record<string, string>>> = [
    enUSMessages,
    jaJPMessages,
    koKRMessages,
    frFRMessages,
    ruRUMessages,
    esESMessages,
  ];

  const translatedLegacyCatalogs = [
    jaJPLegacyText,
    koKRLegacyText,
    frFRLegacyText,
    ruRULegacyText,
    esESLegacyText,
  ];

  const placeholders = (message: string) => (
    [...message.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort()
  );

  it('保留中文默认值，并只接受受支持的界面语言', () => {
    expect(DEFAULT_UI_LANGUAGE).toBe('zh-CN');
    expect(new Config().uiLanguage).toBe('zh-CN');
    expect(normalizeUiLanguage('en-US')).toBe('en-US');
    expect(normalizeUiLanguage('ja-JP')).toBe('ja-JP');
    expect(normalizeUiLanguage('ko-KR')).toBe('ko-KR');
    expect(normalizeUiLanguage('fr-FR')).toBe('fr-FR');
    expect(normalizeUiLanguage('ru-RU')).toBe('ru-RU');
    expect(normalizeUiLanguage('es-ES')).toBe('es-ES');
    expect(normalizeConfig({uiLanguage: 'en-US'}).uiLanguage).toBe('en-US');
    expect(normalizeConfig({uiLanguage: 'invalid'}).uiLanguage).toBe('zh-CN');
    expect(new Config().uiLanguageSetupCompleted).toBe(false);
    expect(normalizeConfig({uiLanguageSetupCompleted: true}).uiLanguageSetupCompleted).toBe(true);
    expect(normalizeConfig({uiLanguageSetupCompleted: 'true'}).uiLanguageSetupCompleted).toBe(false);
  });

  it('按浏览器 locale 选择首次界面语言，并为目标语言保留原生名称', () => {
    expect(resolveUiLanguageFromLocale('en-US')).toBe('en-US');
    expect(resolveUiLanguageFromLocale('en-GB')).toBe('en-US');
    expect(resolveUiLanguageFromLocale('ja-JP')).toBe('ja-JP');
    expect(resolveUiLanguageFromLocale('ko-KR')).toBe('ko-KR');
    expect(resolveUiLanguageFromLocale('fr-FR')).toBe('fr-FR');
    expect(resolveUiLanguageFromLocale('ru-RU')).toBe('ru-RU');
    expect(resolveUiLanguageFromLocale('zh-CN')).toBe('zh-CN');
    expect(resolveUiLanguageFromLocale('zh-TW')).toBe('zh-CN');
    expect(resolveUiLanguageFromLocale('es-ES')).toBe('es-ES');
    expect(resolveUiLanguageFromLocale(null)).toBe('zh-CN');
    expect(options.to.map(item => item.label)).toEqual([
      '中文', 'English', '日本語', '한국어', 'Français', 'Русский', 'Español',
    ]);
    expect(translate('settings.general.defaultTargetLanguage', 'zh-CN')).toBe('语言');
    expect(translate('settings.general.defaultTargetLanguage', 'en-US')).toBe('language');
  });

  it('为目标语言选择器提供中文、英文和原生名称的组合标签', () => {
    expect(options.to.map(item => getMultilingualTargetLanguageLabel(item.value, item.label))).toEqual([
      '中文 / Chinese',
      'English / 英语',
      '日本語 / Japanese / 日语',
      '한국어 / Korean / 韩语',
      'Français / French / 法语',
      'Русский / Russian / 俄语',
      'Español / Spanish / 西班牙语',
    ]);
    expect(getMultilingualTargetLanguageLabel('de', 'Deutsch')).toBe('Deutsch / German / 德语');
    expect(getMultilingualTargetLanguageLabel('ja', '日本語', 'en-US')).toBe('Japanese');
    expect(getMultilingualTargetLanguageLabel('unknown', 'Custom language', 'en-US')).toBe('Custom language');
    expect(getMultilingualTargetLanguageLabel('unknown', '自定义语言')).toBe('自定义语言');
  });

  it('完整本地化 Chrome 具体语言对准备流程及参数化状态', () => {
    const actionByLanguage = {
      'zh-CN': '准备 Chrome 本地翻译',
      'en-US': 'Prepare Chrome local translation',
      'ja-JP': 'Chrome ローカル翻訳を準備',
      'ko-KR': 'Chrome 로컬 번역 준비',
      'fr-FR': 'Préparer la traduction locale de Chrome',
      'ru-RU': 'Подготовить локальный перевод Chrome',
      'es-ES': 'Preparar la traducción local de Chrome',
    } as const;
    for (const [language, expectedAction] of Object.entries(actionByLanguage)) {
      expect(translate('settings.services.chromePreparation.action', language as keyof typeof actionByLanguage))
        .toBe(expectedAction);
      const status = translate(
        'settings.services.chromePreparation.statusDownloadingProgress',
        language as keyof typeof actionByLanguage,
        {model: 'MODEL', percentage: 42, sourceLanguage: 'fr', targetLanguage: 'en'},
      );
      expect(status).toContain('MODEL');
      expect(status).toContain('42');
      expect(status).toContain('fr');
      expect(status).toContain('en');
      expect(status).not.toMatch(/\{(?:model|percentage|sourceLanguage|targetLanguage)\}/u);

      const activationError = translate(
        'settings.services.chromePreparation.error.userActivationRequired',
        language as keyof typeof actionByLanguage,
        {sourceLanguage: 'fr', targetLanguage: 'en'},
      );
      expect(activationError).toContain('fr');
      expect(activationError).toContain('en');
    }

    const englishChromeMessages = Object.entries(enUSMessages).filter(([key]) => (
      key.startsWith('settings.services.chromePreparation.')
    ));
    expect(englishChromeMessages.length).toBeGreaterThan(20);
    expect(englishChromeMessages.filter(([, value]) => /[\u3400-\u9fff]/u.test(value))).toEqual([]);
  });

  it('提供可继续扩展的语言选择器和参数插值', () => {
    expect(UI_LANGUAGE_OPTIONS.map((item) => item.value)).toEqual([
      'zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES',
    ]);
    expect(UI_LANGUAGE_OPTIONS.map((item) => getUiLanguageDisplayLabel(item.value, 'zh-CN'))).toEqual([
      '中文 / Chinese',
      'English / 英语',
      '日本語 / Japanese / 日语',
      '한국어 / Korean / 韩语',
      'Français / French / 法语',
      'Русский / Russian / 俄语',
      'Español / Spanish / 西班牙语',
    ]);
    expect(UI_LANGUAGE_OPTIONS.map((item) => getUiLanguageDisplayLabel(item.value, 'en-US'))).toEqual([
      'Chinese', 'English', 'Japanese', 'Korean', 'French', 'Russian', 'Spanish',
    ]);
    expect(UI_LANGUAGE_OPTIONS.map((item) => getUiLanguageBilingualLabel(item.value))).toEqual([
      '中文 / Chinese',
      '英语 / English',
      '日语 / Japanese',
      '韩语 / Korean',
      '法语 / French',
      '俄语 / Russian',
      '西班牙语 / Spanish',
    ]);
    expect(getUiLanguageDisplayLabel('ja-JP', 'es-ES')).toBe('Japonés / Japanese / 日本語');
    expect(translate('popup.current', 'en-US', {value: 'Ctrl'})).toBe('Current: Ctrl');
    expect(translate('popup.current', 'zh-CN', {value: 'Ctrl'})).toBe('当前：Ctrl');
    expect(translate('popup.current', 'es-ES', {value: 'Ctrl'})).toBe('Actual: Ctrl');
    expect(translate('popup.current', 'ja-JP', {value: 'Ctrl'})).toBe('現在：Ctrl');
    expect(translate('popup.current', 'ko-KR', {value: 'Ctrl'})).toBe('현재: Ctrl');
    expect(translate('popup.current', 'fr-FR', {value: 'Ctrl'})).toBe('Actuel : Ctrl');
    expect(translate('popup.current', 'ru-RU', {value: 'Ctrl'})).toBe('Текущее: Ctrl');
    expect(translate('settings.general.bilingualSentenceHighlight', 'en-US')).toBe('Bilingual sentence highlighting');
    expect(translate('settings.general.bilingualSentenceHighlight', 'ja-JP')).toBe('二言語の文をハイライト');
    expect(translate('settings.general.bilingualSentenceHighlight', 'ko-KR')).toBe('이중 언어 문장 강조');
    expect(translate('settings.general.bilingualSentenceHighlight', 'fr-FR')).toBe('Surlignage bilingue par phrase');
    expect(translate('settings.general.bilingualSentenceHighlight', 'ru-RU')).toBe('Подсветка двуязычных предложений');
    expect(translate('settings.general.bilingualSentenceHighlight', 'es-ES')).toBe('Resaltado bilingüe por oración');
    expect(translate('language.onboardingTitle', 'es-ES')).toBe('Elige el idioma de la interfaz');
    expect(translate('language.onboardingTitle', 'ja-JP')).toBe('インターフェースの言語を選択');
    expect(translate('contextMenu.translate', 'en-US')).toBe('Translate with FluentRead');
    expect(getContextMenuTitle(false, true, 'en-US')).toBe('FluentRead (disabled on this website)');
    expect(Object.keys(enUSMessages).sort()).toEqual(Object.keys(zhCNMessages).sort());
    expect(Object.keys(esESMessages).sort()).toEqual(Object.keys(enUSMessages).sort());
    for (const catalog of [jaJPMessages, koKRMessages, frFRMessages, ruRUMessages]) {
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(enUSMessages).sort());
    }
  });

  it('每种正式语言目录都完整，并保留相同的插值参数', () => {
    const chineseCatalog: Readonly<Record<string, string>> = zhCNMessages;
    for (const catalog of translatedCatalogs) {
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(chineseCatalog).sort());
      for (const key of Object.keys(chineseCatalog)) {
        expect(placeholders(catalog[key]), key).toEqual(placeholders(chineseCatalog[key]));
      }
    }
  });

  it('用稳定 key 为七种语言提供完整的翻译加载动画文案', () => {
    const expectedStyleLabels = {
      'zh-CN': ['简洁', '柔和圆环', '跳跃圆点', '行星轨道', '星光'],
      'en-US': ['Minimal', 'Soft ring', 'Bouncing dots', 'Planet orbit', 'Sparkle'],
      'ja-JP': ['シンプル', 'やわらかなリング', '跳ねるドット', '惑星の軌道', 'きらめき'],
      'ko-KR': ['간결', '부드러운 원형', '통통 튀는 점', '행성 궤도', '별빛'],
      'fr-FR': ['Minimal', 'Anneau discret', 'Points bondissants', 'Orbite planétaire', 'Étincelles'],
      'ru-RU': ['Минимальный', 'Мягкое кольцо', 'Прыгающие точки', 'Планетарная орбита', 'Искры'],
      'es-ES': ['Minimalista', 'Anillo suave', 'Puntos saltarines', 'Órbita planetaria', 'Destellos'],
    } as const;

    for (const language of Object.keys(expectedStyleLabels) as Array<keyof typeof expectedStyleLabels>) {
      expect(translationLoadingStyleOptions.map((option) => translate(option.labelKey, language)))
        .toEqual(expectedStyleLabels[language]);
      for (const option of translationLoadingStyleOptions) {
        expect(translate(option.descriptionKey, language)).not.toBe(option.descriptionKey);
      }
      expect(translate('settings.advanced.performanceDescription', language))
        .not.toBe('settings.advanced.performanceDescription');
      expect(translate('settings.advanced.animationsAria', language))
        .not.toBe('settings.advanced.animationsAria');
      expect(translate('settings.advanced.translationLoadingStyleAria', language))
        .not.toBe('settings.advanced.translationLoadingStyleAria');
      expect(translate('settings.advanced.translationLoadingStyleOptionAria', language, {
        label: 'Style', description: 'Description',
      })).not.toMatch(/\{(?:label|description)\}/u);
    }

    for (const option of translationLoadingStyleOptions) {
      expect(translate(option.labelKey, 'zh-CN')).toBe(option.label);
      expect(translate(option.descriptionKey, 'zh-CN')).toBe(option.description);
    }
  });

  it('翻译动画导航关键词和配置差异文案在非中文 legacy 界面中不回显中文源文案', () => {
    const advancedNavigation = navigationItems.find((item) => item.id === 'settings-advanced');
    const diff = buildConfigDiff(
      {translationLoadingStyle: 'minimal'},
      {translationLoadingStyle: 'sparkle'},
    );
    const loadingStyleChange = diff.groups
      .flatMap((group) => group.changes)
      .find((change) => change.key === 'translationLoadingStyle');
    expect(advancedNavigation).toBeDefined();
    expect(loadingStyleChange).toBeDefined();

    const sourceCopy = [
      advancedNavigation!.summary,
      advancedNavigation!.searchDescription,
      loadingStyleChange!.label,
      ...translationLoadingStyleOptions.map((option) => option.label),
    ];
    for (const language of ['en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'] as const) {
      for (const source of sourceCopy) {
        expect(translateLegacyText(source, language), `${language}: ${source}`).not.toBe(source);
      }
    }
    for (const language of ['en-US', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'] as const) {
      for (const source of sourceCopy) {
        expect(translateLegacyText(source, language), `${language}: ${source}`)
          .not.toMatch(/[\u3400-\u9fff]/u);
      }
    }
  });

  it('完整本地化 Popup 布局编辑器与布局差异顺序', () => {
    const layoutKeys = [
      'settings.interface.popupLayout.label',
      'settings.interface.popupLayout.description',
      'settings.interface.popupLayout.orderHint',
      'settings.interface.popupLayout.restoreDefault',
      'settings.interface.popupLayout.listAria',
      'settings.interface.popupLayout.handleAria',
      'settings.interface.popupLayout.showAria',
      'settings.interface.popupLayout.required',
      'settings.interface.popupLayout.moveUp',
      'settings.interface.popupLayout.moveDown',
      'settings.interface.popupLayout.help',
      'settings.interface.popupLayout.shown',
      'settings.interface.popupLayout.hidden',
      'settings.interface.popupLayout.moved',
      'settings.interface.popupLayout.restored',
      ...popupModuleOptions.flatMap((module) => [module.labelKey, module.descriptionKey]),
      'settings.interface.popupQuickFeatures.label',
      'settings.interface.popupQuickFeatures.description',
      ...popupQuickFeatureOptions.flatMap((feature) => [feature.labelKey, feature.descriptionKey]),
    ];
    const diff = buildConfigDiff(
      {popupModuleOrder: ['translation', 'siteRule', 'quickFeatures', 'footer']},
      {popupModuleOrder: ['quickFeatures', 'translation', 'siteRule', 'footer']},
    );
    const layoutChange = diff.groups
      .flatMap((group) => group.changes)
      .find((change) => change.key === 'popupModuleOrder');
    expect(layoutChange).toBeDefined();

    for (const language of ['en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'] as const) {
      for (const key of layoutKeys) {
        expect(translate(key, language, {label: 'Module', position: 2}), `${language}: ${key}`)
          .not.toBe(key);
      }
      expect(translateLegacyText(layoutChange!.label, language)).not.toBe(layoutChange!.label);
      expect(translateLegacyText(layoutChange!.before, language)).not.toBe(layoutChange!.before);
      expect(translateLegacyText(layoutChange!.after, language)).not.toBe(layoutChange!.after);
    }
    for (const language of ['en-US', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'] as const) {
      expect(translateLegacyText(layoutChange!.before, language)).not.toMatch(/[\u3400-\u9fff]/u);
      expect(translateLegacyText(layoutChange!.after, language)).not.toMatch(/[\u3400-\u9fff]/u);
    }
  });

  it('每种旧界面词典都覆盖 English 基线，且 English 界面不夹杂中文', () => {
    for (const catalog of translatedLegacyCatalogs) {
      expect(Object.keys(enUSLegacyText).filter((key) => !catalog[key])).toEqual([]);
    }

    const allowedNativeLabels = new Set(['中文', '日本語']);
    const unexpectedHan = Object.entries(enUSLegacyText).filter(([, value]) => (
      /[\u3400-\u9fff]/u.test(value) && !allowedNativeLabels.has(value)
    ));
    expect(unexpectedHan).toEqual([]);
  });

  it('逐段翻译复合状态，不把整行回退成 English', () => {
    const offWithIcon = {
      'en-US': 'Off · Show icon',
      'ja-JP': 'オフ · アイコンを表示',
      'ko-KR': '끔 · 아이콘 표시',
      'fr-FR': 'Désactivé · Afficher l’icône',
      'ru-RU': 'Выключено · Показывать значок',
      'es-ES': 'Desactivado · Mostrar icono',
    } as const;
    const bilingualBold = {
      'en-US': 'Bilingual · Bold',
      'ja-JP': '二言語 · 太字表示',
      'ko-KR': '이중 언어 · 굵게 표시',
      'fr-FR': 'Bilingue · Affichage en gras',
      'ru-RU': 'Двуязычный режим · Полужирный текст',
      'es-ES': 'Bilingüe · Negrita',
    } as const;

    for (const language of Object.keys(offWithIcon) as Array<keyof typeof offWithIcon>) {
      expect(translateLegacyText('已关闭 · 显示图标', language)).toBe(offWithIcon[language]);
      expect(translateLegacyText('双语 · 加粗显示', language)).toBe(bilingualBold[language]);
    }
  });

  it('翻译 AI 服务展开态中的动态字符上限', () => {
    expect(translateLegacyText('最多 8192 字符', 'en-US')).toBe('Up to 8192 characters');
    expect(translateLegacyText('最多 8192 字符', 'ja-JP')).toBe('最大 8192 文字');
    expect(translateLegacyText('最多 8192 字符', 'ko-KR')).toBe('최대 8192자');
    expect(translateLegacyText('最多 8192 字符', 'fr-FR')).toBe('8192 caractères maximum');
    expect(translateLegacyText('最多 8192 字符', 'ru-RU')).toBe('Не более 8192 символов');
    expect(translateLegacyText('最多 8192 字符', 'es-ES')).toBe('Máximo 8192 caracteres');
  });

  it('人工校正容易发生语义误判的高频设置文案', () => {
    expect(translateLegacyText('日本語', 'en-US')).toBe('Japanese');
    expect(translateLegacyText('显示 FluentRead 字幕', 'ja-JP')).toBe('FluentRead 字幕を表示');
    expect(translateLegacyText('显示 FluentRead 字幕', 'ko-KR')).toBe('FluentRead 자막 표시');
    expect(translateLegacyText('禁用扩展网站', 'fr-FR')).toBe('Sites où désactiver l’extension');
    expect(translateLegacyText('禁用扩展网站', 'ru-RU')).toBe('Сайты с отключённым расширением');
    expect(translateLegacyText('禁用扩展网站', 'es-ES')).toBe('Sitios con la extensión desactivada');
    expect(translateLegacyText('控制并发数量、请求速率和失败重试的退避范围。', 'ko-KR'))
      .toBe('동시 실행 수, 요청 속도, 실패 시 재시도 간격을 설정합니다.');
    expect(translateLegacyText('控制并发数量、请求速率和失败重试的退避范围。', 'fr-FR'))
      .toBe('Réglez le nombre de tâches simultanées, la fréquence des requêtes et les délais entre les tentatives.');
    expect(translateLegacyText('Thinking、代理、提示词和自定义请求体', 'en-US'))
      .toBe('Thinking, proxy, prompts, and custom request body');
    expect(translateLegacyText('默认关闭；仅在已适配接口生效，无法关闭时使用最低档', 'ja-JP'))
      .toBe('デフォルトではオフです。対応済みの API でのみ有効になり、無効化できない場合は最小レベルを使用します。');
    expect(translateLegacyText('当前模型是否启用 Thinking', 'es-ES'))
      .toBe('Activar Thinking para el modelo actual');
  });

  it('为高级调度摘要按语言插值，不残留中文模板', () => {
    expect(translate('settings.advanced.schedulerSummary', 'en-US', {
      concurrency: 6,
      perSecond: '∞',
      perMinute: 60,
      retries: 3,
      baseDelay: '500ms',
      maxDelay: '8s',
    })).toBe('Up to 6 translation tasks at once; limits: ∞/s and 60/min; up to 3 retries; backoff: 500ms–8s.');
    expect(translate('settings.advanced.schedulerSummary', 'ja-JP', {
      concurrency: 6,
      perSecond: '∞',
      perMinute: 60,
      retries: 3,
      baseDelay: '500ms',
      maxDelay: '8s',
    })).toBe('翻訳タスクを最大 6 件同時に処理します。上限：毎秒 ∞ 件、毎分 60 件。再試行は最大 3 回、待機時間は 500ms～8s。');
    expect(translate('settings.sites.count', 'en-US', {count: 0})).toBe('Websites: 0');
    expect(translate('settings.sites.count', 'ko-KR', {count: 3})).toBe('사이트 3개');
  });

  it('只把显式登记的旧 UI 文案翻译为当前界面语言', () => {
    expect(translateLegacyText('翻译服务', 'en-US')).toBe('Translation services');
    expect(translateLegacyText('  翻译服务  ', 'en-US')).toBe('  Translation services  ');
    expect(translateLegacyText('微软翻译 · YouTube', 'en-US')).toBe('Microsoft Translator · YouTube');
    expect(translateLegacyText('已完成 3 次翻译', 'en-US')).toBe('3 translations completed');
    expect(translateLegacyText('用户自己的中文正文', 'en-US')).toBe('用户自己的中文正文');
    expect(translateLegacyText('翻译服务', 'zh-CN')).toBe('翻译服务');
    expect(translateLegacyText('软件语言', 'es-ES')).toBe('Idioma de la aplicación');
    expect(translateLegacyText('软件语言', 'ja-JP')).toBe('アプリの言語');
    expect(translateLegacyText('软件语言', 'ko-KR')).toBe('앱 언어');
    expect(translateLegacyText('双语逐句高亮', 'en-US')).toBe('Bilingual sentence highlighting');
    expect(translateLegacyText('双语逐句高亮', 'es-ES')).toBe('Resaltado bilingüe por oración');
    expect(translateLegacyText('软件语言', 'fr-FR')).toBe('Langue de l’application');
    expect(translateLegacyText('软件语言', 'ru-RU')).toBe('Язык приложения');
    expect(translateLegacyText('My services', 'ja-JP')).toBe('マイサービス');
    expect(translateLegacyText('Complete backup', 'ko-KR')).toBe('전체 백업');
    expect(translateLegacyText('Current default', 'fr-FR')).toBe('Valeur actuelle par défaut');
    expect(translateLegacyText('Valid configuration changes are recorded automatically; up to 10 are kept.', 'ru-RU'))
      .toBe('Допустимые изменения настроек записываются автоматически; сохраняется до 10 записей.');
    expect(translateLegacyText('中文', 'es-ES')).toBe('中文');
    expect(translateLegacyText('My services', 'es-ES')).toBe('Mis servicios');
    expect(translateLegacyText('Model providers', 'es-ES')).toBe('Proveedores de modelos');
    expect(translateLegacyText('Test connection', 'es-ES')).toBe('Probar conexión');
    expect(translateLegacyText('Complete backup', 'es-ES')).toBe('Copia de seguridad completa');
    expect(translateLegacyText('Settings and local records', 'es-ES')).toBe('Ajustes y registros locales');
    expect(translateLegacyText('已就绪', 'es-ES')).toBe('Listo');

    const interfaceAppearanceCopy = [
      '服务、界面、显示与网页辅助',
      '选择默认翻译服务，并管理扩展界面、译文显示、网页辅助和基础偏好。',
      '选择翻译服务、默认服务、界面设置、弹窗风格、默认风格、简约风格、弹窗栏目、快捷功能栏、当前网站栏目、底部信息栏、译文显示、双语逐句高亮、网页辅助、AI 智能上下文、默认目标语言、主题',
      '选择翻译服务、默认服务、界面设置、弹窗风格、默认风格、简约风格、紧凑风格、高对比、奶酪、海盐、抹茶、樱花、夜幕、纸张护眼、弹窗栏目、快捷功能栏、当前网站栏目、底部信息栏、译文显示、双语逐句高亮、网页辅助、AI 智能上下文、默认目标语言、主题',
      '界面与弹窗',
      '保留熟悉的默认界面，或切换到更轻量的简约界面；也可以只留下常用栏目。',
      '从效率布局、趣味配色到夜间和护眼方案，选择适合自己的界面；也可以只留下常用栏目。',
      '弹窗风格',
      '风格只改变扩展界面的呈现，不影响网页翻译效果。',
      '默认风格',
      '保留当前 FluentRead 的界面布局与视觉效果。',
      '简约风格',
      '平面布局、轻边界和更紧凑的操作区域。',
      '平面留白与轻边界，让主要操作更突出。',
      '效率与可读性',
      '从熟悉、简洁、紧凑到高对比，按使用场景选择。',
      '氛围配色',
      '用不同色彩营造轻松、沉静或护眼的阅读氛围。',
      '紧凑风格',
      '压缩间距与控件高度，适合高频快速操作。',
      '高对比 ⚡',
      '强化文字、边框与焦点状态，提升辨识度。',
      '奶酪 🧀',
      '奶油黄配焦糖棕，温暖、有趣又醒目。',
      '海盐 🌊',
      '清爽海盐蓝，层次清晰且适合长时间使用。',
      '抹茶 🍵',
      '低饱和抹茶绿，安静自然、不喧宾夺主。',
      '樱花 🌸',
      '淡樱粉与轻盈圆角，柔和明快。',
      '夜幕 🌙',
      '深蓝低眩光界面，适合夜间阅读。',
      '纸张护眼 📖',
      '暖纸白与墨色文字，减少冷白背景刺激。',
      '快捷功能栏',
      '显示悬停、划词、图片、视频和文档等快捷入口。',
      '当前网站栏目',
      '显示当前网站的始终翻译和禁用扩展开关。',
      '底部信息栏',
      '显示翻译统计、开源项目入口和清除缓存操作。',
    ];
    for (const language of ['en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'] as const) {
      for (const source of interfaceAppearanceCopy) {
        expect(translateLegacyText(source, language)).not.toBe(source);
      }
    }
    expect(translateLegacyText('界面与弹窗', 'en-US')).toBe('Interface and popup');
    expect(translateLegacyText('默认风格', 'es-ES')).toBe('Estilo predeterminado');
    expect(translateLegacyText('奶酪 🧀', 'en-US')).toBe('Cheese 🧀');
    expect(translateLegacyText('夜幕 🌙', 'ja-JP')).toBe('ミッドナイト 🌙');
  });

  it('把界面语言作为普通可迁移配置保留，并不触碰凭据边界', () => {
    const exported = prepareConfigForExport(normalizeConfig({uiLanguage: 'en-US'}));
    expect(exported.uiLanguage).toBe('en-US');

    const imported = prepareConfigForImport({
      ...new Config(),
      uiLanguage: 'en-US',
    }, new Config());
    expect(imported.uiLanguage).toBe('en-US');
    expect(imported.token).toEqual({});
    expect(toRestorableConfig({uiLanguageSetupCompleted: true})).not.toHaveProperty('uiLanguageSetupCompleted');
  });
});
