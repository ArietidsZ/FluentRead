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
import {interfaceSkinGroups, interfaceSkinOptions, popupModuleOptions, popupQuickFeatureOptions} from '@/src/core/config/interfaceAppearance';
import {buildConfigDiff} from '@/src/core/config/diff';
import {getMultilingualTargetLanguageLabel, options, services} from '@/src/core/config/catalog';
import {getMissingCredentialMessage} from '@/src/core/config/validation';
import {prepareConfigForExport, prepareConfigForImport} from '@/src/core/config/transfer';
import {toRestorableConfig} from '@/src/services/config/history';
import {getContextMenuTitle} from '@/src/app/background/contextMenuUi';
import {navigationItems} from '@/src/features/settings/model/navigation';
import {parseHotkey} from '@/src/core/hotkey';

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
      'zh-CN': ['简洁', '柔和圆环', '跳跃圆点', '行星轨道', '星光', '涟漪扩散', '起伏波形', '光线扫过', '流沙沙漏', '小彗星', '翻转方块', '弹跳小球', '打字光标', '扫描线', '信号柱'],
      'en-US': ['Minimal', 'Soft ring', 'Bouncing dots', 'Planet orbit', 'Sparkle', 'Ripple pulse', 'Waveform', 'Light sweep', 'Hourglass', 'Little comet', 'Flip square', 'Bouncing ball', 'Typing cursor', 'Scan line', 'Signal bars'],
      'ja-JP': ['シンプル', 'やわらかなリング', '跳ねるドット', '惑星の軌道', 'きらめき', '波紋パルス', '波形', '光のスイープ', '砂時計', '小さな彗星', '反転スクエア', '跳ねるボール', '入力カーソル', 'スキャンライン', '信号バー'],
      'ko-KR': ['간결', '부드러운 원형', '통통 튀는 점', '행성 궤도', '별빛', '물결 펄스', '파형', '빛 쓸기', '모래시계', '작은 혜성', '뒤집는 사각형', '통통 튀는 공', '입력 커서', '스캔 라인', '신호 막대'],
      'fr-FR': ['Minimal', 'Anneau discret', 'Points bondissants', 'Orbite planétaire', 'Étincelles', 'Ondulation', 'Forme d’onde', 'Balayage lumineux', 'Sablier', 'Petite comète', 'Carré retournant', 'Balle rebondissante', 'Curseur de saisie', 'Ligne de balayage', 'Barres de signal'],
      'ru-RU': ['Минимальный', 'Мягкое кольцо', 'Прыгающие точки', 'Планетарная орбита', 'Искры', 'Пульсация волн', 'Волна', 'Световой проход', 'Песочные часы', 'Маленькая комета', 'Переворачивающийся квадрат', 'Прыгающий шарик', 'Курсор набора', 'Линия сканирования', 'Сигнальные полосы'],
      'es-ES': ['Minimalista', 'Anillo suave', 'Puntos saltarines', 'Órbita planetaria', 'Destellos', 'Pulso de ondas', 'Forma de onda', 'Barrido de luz', 'Reloj de arena', 'Cometa pequeño', 'Cuadrado que gira', 'Pelota saltarina', 'Cursor de escritura', 'Línea de escaneo', 'Barras de señal'],
    } as const;

    for (const language of Object.keys(expectedStyleLabels) as Array<keyof typeof expectedStyleLabels>) {
      expect(translationLoadingStyleOptions.map((option) => translate(option.labelKey, language)))
        .toEqual(expectedStyleLabels[language]);
      for (const option of translationLoadingStyleOptions) {
        expect(translate(option.descriptionKey, language)).not.toBe(option.descriptionKey);
      }
      expect(translate('settings.advanced.performanceDescription', language))
        .not.toBe('settings.advanced.performanceDescription');
      expect(translate('settings.interface.animationLoading.label', language))
        .not.toBe('settings.interface.animationLoading.label');
      expect(translate('settings.interface.animationLoading.description', language))
        .not.toBe('settings.interface.animationLoading.description');
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

  it('用稳定 key 完整本地化快捷翻译方案及其动态提示', () => {
    const cases: Array<{key: string; params?: Record<string, string | number>}> = [
      {key: 'quickTranslation.heading.hover'},
      {key: 'quickTranslation.heading.fullPage'},
      {key: 'quickTranslation.description'},
      {key: 'quickTranslation.capacityReached'},
      {key: 'quickTranslation.capacityLimit', params: {count: 8}},
      {key: 'quickTranslation.clickEdit'},
      {key: 'quickTranslation.clickRecord'},
      {key: 'quickTranslation.systemConflict', params: {warning: 'Copy'}},
      {key: 'quickTranslation.followDefault', params: {value: 'Default service'}},
      {key: 'quickTranslation.translationServiceAria', params: {hotkey: 'Ctrl+T'}},
      {key: 'quickTranslation.serviceUnavailable', params: {service: 'Service'}},
      {key: 'quickTranslation.translationModelAria', params: {hotkey: 'Ctrl+T'}},
      {key: 'quickTranslation.pinServiceHint'},
      {key: 'quickTranslation.targetLanguageAria', params: {hotkey: 'Ctrl+T'}},
      {key: 'quickTranslation.displayModeAria', params: {hotkey: 'Ctrl+T'}},
      {key: 'quickTranslation.field.range'},
      {key: 'quickTranslation.fullPageRangeAria', params: {hotkey: 'Ctrl+T'}},
      {key: 'quickTranslation.delete'},
      {key: 'quickTranslation.deleteAria', params: {profile: 'Profile 1'}},
      {key: 'quickTranslation.defaultModel'},
      {key: 'quickTranslation.followServiceDefault'},
      {key: 'quickTranslation.followServiceDefaultModel', params: {model: 'Model'}},
      {key: 'quickTranslation.serviceRestriction'},
      {key: 'quickTranslation.useDefaults'},
      {key: 'quickTranslation.profileUnavailable', params: {detail: 'English · Bilingual'}},
      {key: 'quickTranslation.profilePaused', params: {detail: 'English · Bilingual'}},
      {key: 'quickTranslation.action.hover'},
      {key: 'quickTranslation.action.fullPage'},
      {key: 'quickTranslation.profileName', params: {action: 'Hover', index: 1, hotkey: 'Ctrl+T'}},
      {key: 'quickTranslation.profileNeedsHotkey', params: {profile: 'Profile 1'}},
      {key: 'quickTranslation.enableProfile', params: {profile: 'Profile 1'}},
      {key: 'quickTranslation.disableProfile', params: {profile: 'Profile 1'}},
      {key: 'quickTranslation.enableProfileUnavailable', params: {profile: 'Profile 1'}},
      {key: 'quickTranslation.disableProfileUnavailable', params: {profile: 'Profile 1'}},
      {key: 'quickTranslation.defaultHover'},
      {key: 'quickTranslation.defaultFullPage'},
      {key: 'quickTranslation.duplicate'},
      {key: 'quickTranslation.legacyConflictEdit', params: {feature: 'Default hover translation'}},
      {key: 'quickTranslation.legacyConflictEnable', params: {feature: 'Default hover translation'}},
      {key: 'quickTranslation.recordFirst'},
      {key: 'quickTranslation.setFirst'},
      {key: 'quickTranslation.selectionPrecedence'},
      {key: 'quickTranslation.googleNotice'},
      {key: 'quickTranslation.googleOnly'},
      {key: 'quickTranslation.conflictProfile', params: {group: 'Extra hover shortcuts'}},
      {key: 'quickTranslation.conflictProfilePopup', params: {group: 'Extra hover shortcuts'}},
      {key: 'quickTranslation.shortcutDisabled'},
      {key: 'quickTranslation.shortcutSet', params: {shortcut: 'Ctrl+T'}},
      {key: 'quickTranslation.selectionShortcutDisabled'},
      {key: 'quickTranslation.selectionShortcutSet', params: {shortcut: 'Ctrl+T'}},
      {key: 'quickTranslation.defaultServiceDescription'},
      {key: 'quickTranslation.commonHoverShortcut'},
      {key: 'quickTranslation.commonFullPageShortcut'},
      {key: 'popup.quickTranslation.defaultHoverShortcut'},
      {key: 'popup.quickTranslation.defaultOnly', params: {count: 2}},
      {key: 'popup.quickTranslation.defaultOff'},
      {key: 'popup.quickTranslation.toggleDefaultHover'},
      {key: 'popup.quickTranslation.extraProfiles'},
      {key: 'popup.quickTranslation.moreProfiles', params: {count: 2}},
      {key: 'popup.quickTranslation.profileCount', params: {count: 3}},
      {key: 'popup.quickTranslation.defaultNotSet'},
      {key: 'popup.quickTranslation.fullPageHint', params: {count: 2}},
    ];
    const languages = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'] as const;

    for (const {key, params} of cases) {
      const chinese = translate(key, 'zh-CN', params);
      for (const language of languages) {
        const localized = translate(key, language, params);
        expect(localized, `${language}: ${key}`).not.toBe(key);
        expect(localized, `${language}: ${key}`).not.toMatch(/\{[a-zA-Z0-9_]+\}/u);
        if (language !== 'zh-CN') expect(localized, `${language}: ${key}`).not.toBe(chinese);
        if (['en-US', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'].includes(language)) {
          expect(localized, `${language}: ${key}`).not.toMatch(/[\u3400-\u9fff]/u);
        }
      }
    }

    expect(translate('quickTranslation.heading.hover', 'en-US')).toBe('More hover shortcuts');
    expect(translate('popup.quickTranslation.profileCount', 'ja-JP', {count: 3})).toContain('3');

    for (const language of languages) {
      expect(translate('quickTranslation.serviceRestriction', language)).not.toContain(' · ');
    }
    const chineseProfileName = translate('quickTranslation.profileName', 'zh-CN', {
      action: translate('quickTranslation.action.hover', 'zh-CN'), index: 1, hotkey: 'Ctrl+T',
    });
    expect(translate('quickTranslation.deleteAria', 'zh-CN', {profile: chineseProfileName}))
      .toBe('删除悬浮快捷方案 1 Ctrl+T');

    const countNeutralEnglish = {
      'popup.quickTranslation.defaultOnly': 'This switch only controls the default shortcut · independent profile count: 1',
      'popup.quickTranslation.moreProfiles': 'Additional profile count in full settings: 1.',
      'popup.quickTranslation.profileCount': 'Shortcut profile count: 1',
      'popup.quickTranslation.fullPageHint': 'Additional full-page profile count: 1. This badge only shows the default shortcut.',
    } as const;
    for (const [key, expected] of Object.entries(countNeutralEnglish)) {
      expect(translate(key, 'en-US', {count: 1})).toBe(expected);
    }
    for (const language of ['fr-FR', 'ru-RU', 'es-ES'] as const) {
      for (const key of Object.keys(countNeutralEnglish)) {
        const localized = translate(key, language, {count: 1});
        expect(localized, `${language}: ${key}`).toContain('1');
        expect(localized, `${language}: ${key}`).not.toMatch(/[\u3400-\u9fff]/u);
      }
    }
  });

  it('本地化快捷键冲突检测返回的系统操作名称', () => {
    const conflictReasons = [
      '复制', '粘贴', '剪切', '撤销', '重做', '全选', '保存', '打开', '新建', '关闭标签页',
      '新建标签页', '刷新页面', '查找', '历史记录', '添加书签', '关闭程序', '重新打开关闭的标签页',
      '无痕模式', '清除浏览数据', '退出程序', 'Spotlight搜索',
    ];
    const nonChineseLanguages = ['en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'] as const;
    const malformedValidationMessages = ['Ctrl+', '+T', 'Ctrl++T'].map((hotkey) => {
      const message = parseHotkey(hotkey).errorMessage;
      if (!message) throw new Error(`预期 ${hotkey} 产生快捷键解析错误`);
      return message;
    });
    expect(malformedValidationMessages).toEqual([
      '不支持的按键: ',
      '不支持的修饰键: ',
      '不支持的修饰键: ',
    ]);
    const validationMessages = [
      '与系统快捷键冲突: 新建标签页',
      '与系统快捷键冲突: 重新打开关闭的标签页',
      '单个字母键需要与修饰键组合使用',
      'CMD 键已被禁用，请使用其他修饰键组合',
      '不支持的按键: mystery',
      '不支持的修饰键: mystery',
      '当前快捷键为 Alt+T',
      ...malformedValidationMessages,
    ];

    for (const language of nonChineseLanguages) {
      expect(translateLegacyText('新建标签页', language)).not.toBe('新建标签页');
      expect(translateLegacyText('重新打开关闭的标签页', language)).not.toBe('重新打开关闭的标签页');
      for (const message of validationMessages) {
        const localized = translateLegacyText(message, language);
        expect(localized, `${language}: ${message}`).not.toBe(message);
        if (language !== 'ja-JP') expect(localized, `${language}: ${message}`).not.toMatch(/[\u3400-\u9fff]/u);
      }
      for (const reason of conflictReasons) {
        const localized = translateLegacyText(reason, language);
        if (language !== 'ja-JP') expect(localized, `${language}: ${reason}`).not.toMatch(/[\u3400-\u9fff]/u);
      }
    }
  });

  it('本地化动态凭据缺失提示并保留服务名称', () => {
    const credentialMessages = [
      getMissingCredentialMessage(services.deepseek, {token: {}}),
      getMissingCredentialMessage(services.youdao, {token: {}, youdaoAppKey: 'configured'}),
      getMissingCredentialMessage(services.tencent, {token: {}, tencentSecretId: 'configured'}),
    ];
    expect(credentialMessages.every((message): message is string => Boolean(message))).toBe(true);

    for (const language of ['en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'] as const) {
      for (const message of credentialMessages) {
        const localized = translateLegacyText(message!, language);
        expect(localized, `${language}: ${message}`).not.toBe(message);
        if (language !== 'ja-JP') expect(localized, `${language}: ${message}`).not.toMatch(/[\u3400-\u9fff]/u);
      }
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

  it('独立界面布局导航、皮肤风格和通用设置文案覆盖每种界面语言', () => {
    const navigationCopy = navigationItems
      .filter((item) => ['settings-general', 'settings-interface'].includes(item.id))
      .flatMap(({id, icon, ...copy}) => Object.values(copy));
    const skinCopy = [...interfaceSkinGroups, ...interfaceSkinOptions]
      .flatMap(({label, description}) => [label, description]);
    for (const language of ['en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'] as const) {
      for (const source of [...navigationCopy, ...skinCopy]) {
        const localized = translateLegacyText(source, language);
        expect(localized, `${language}: ${source}`).not.toBe(source);
        if (language !== 'ja-JP') expect(localized).not.toMatch(/[\u3400-\u9fff]/u);
      }
    }
  });

  it('学习中心的新导航、栏目和保存期限覆盖全部界面语言', () => {
    const item = navigationItems.find(value => value.id === 'settings-vocabulary')!;
    for (const language of ['en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'] as const) {
      for (const source of [item.label, item.description, item.summary, item.detail, item.searchDescription]) {
        expect(translateLegacyText(source, language), `${language}: ${source}`).not.toBe(source);
      }
      for (const key of ['learning.saved', 'learning.history', 'learning.content', 'learning.retention', 'learning.memory', 'learning.memoryAdd', 'learning.memoryDisabled', 'learning.memoryClearConfirm', 'settings.memoryEnabled', 'settings.memoryDescription']) {
        expect(translate(key, language)).not.toBe(translate(key, 'zh-CN'));
        expect(translate(key, language)).not.toBe(key);
      }
    }
    expect(translate('learning.saved', 'zh-CN')).toBe('收藏');
    expect(translate('learning.history', 'en-US')).toBe('Reading history');
  });

  it('完整本地化菜单栏布局编辑器与布局差异顺序', () => {
    const layoutKeys = [
      'settings.interface.popupLayout.label',
      'settings.interface.popupLayout.description',
      'settings.interface.popupLayout.previewTitle',
      'settings.interface.popupLayout.previewDescription',
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
    expect(layoutChange!.label).toBe('菜单栏布局顺序');
    expect(translate('settings.interface.popupLayout.label', 'zh-CN')).toBe('菜单栏布局');
    expect(translate('settings.interface.popupLayout.label', 'en-US')).toBe('Menu bar layout');

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
      '界面与弹窗',
      '从效率布局、趣味配色到夜间和护眼方案，选择适合自己的界面；也可以只留下常用栏目。',
      '弹窗风格',
      '风格只改变扩展界面的呈现，不影响网页翻译效果。',
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
