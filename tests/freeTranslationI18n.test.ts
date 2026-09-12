import {describe, expect, it} from 'vitest';
import {translateLegacyText} from '@/src/core/i18n';
import type {UiLanguage} from '@/src/core/i18n';
import {registerAllUiLanguageBundles} from '@/src/core/i18n/bundles';

// 扩展运行时按需加载界面语言；本文件验证全部语言的文案契约，因此一次注册全部资源包。
registerAllUiLanguageBundles();

const languages: UiLanguage[] = ['en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'];
const sources = ['自动均衡', '权重', '实验候选', '网络问题通常几分钟后重试；限流按服务提示恢复；拦截可能需要几小时；日额度通常隔天恢复。', '搜狗翻译', '实验性网页接口，可能触发访问验证'];

describe('free translation legacy text localization', () => {
  it.each(languages)('%s translates new free-service labels and guidance', language => {
    for (const source of sources) {
      const translated = translateLegacyText(source, language);
      expect(translated, `${language}: ${source}`).not.toBe(source);
      expect(translated).not.toContain('实验性');
    }
  });
});
