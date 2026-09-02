import {describe, expect, it} from 'vitest';

import {
  DEFAULT_UI_LANGUAGE,
  getUiLanguageDisplayLabel,
  UI_LANGUAGE_OPTIONS,
  normalizeUiLanguage,
  resolveUiLanguageFromLocale,
  translate,
  translateLegacyText,
} from '@/src/core/i18n';
import {enUSMessages} from '@/src/core/i18n/messages/en-US';
import {esESMessages} from '@/src/core/i18n/messages/es-ES';
import {frFRMessages} from '@/src/core/i18n/messages/fr-FR';
import {jaJPMessages} from '@/src/core/i18n/messages/ja-JP';
import {koKRMessages} from '@/src/core/i18n/messages/ko-KR';
import {ruRUMessages} from '@/src/core/i18n/messages/ru-RU';
import {zhCNMessages} from '@/src/core/i18n/messages/zh-CN';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {getMultilingualTargetLanguageLabel, options} from '@/src/core/config/catalog';
import {prepareConfigForExport, prepareConfigForImport} from '@/src/core/config/transfer';
import {toRestorableConfig} from '@/src/services/config/history';
import {getContextMenuTitle} from '@/src/app/background/contextMenuUi';

describe('界面 i18n 契约', () => {
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
    expect(getUiLanguageDisplayLabel('ja-JP', 'es-ES')).toBe('Japonés / Japanese / 日本語');
    expect(translate('popup.current', 'en-US', {value: 'Ctrl'})).toBe('Current: Ctrl');
    expect(translate('popup.current', 'zh-CN', {value: 'Ctrl'})).toBe('当前：Ctrl');
    expect(translate('popup.current', 'es-ES', {value: 'Ctrl'})).toBe('Actual: Ctrl');
    expect(translate('popup.current', 'ja-JP', {value: 'Ctrl'})).toBe('現在：Ctrl');
    expect(translate('popup.current', 'ko-KR', {value: 'Ctrl'})).toBe('현재: Ctrl');
    expect(translate('popup.current', 'fr-FR', {value: 'Ctrl'})).toBe('Actuel : Ctrl');
    expect(translate('popup.current', 'ru-RU', {value: 'Ctrl'})).toBe('Текущее: Ctrl');
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
