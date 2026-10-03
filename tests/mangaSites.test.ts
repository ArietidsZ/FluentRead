import {describe, expect, it} from 'vitest';
import {createMangaSiteRule, normalizeMangaSiteRules, resolveMangaSite} from '@/src/core/config/manga';
import {normalizeConfig} from '@/src/core/config/model';

describe('漫画阅读规则与持久偏好', () => {
    it('旧配置保留普通图片关闭，同时启用漫画提示；永久关闭不会被归一化重开', () => {
        const old = normalizeConfig({});
        expect(old.disableImageTranslator).toBe(true);
        expect(old.imageTranslationMangaEnabled).toBe(true);
        expect(old.imageTranslationMangaPromptEnabled).toBe(true);
        expect(old.imageTranslationMangaDownloadConfirmed).toBe(false);
        expect(old.imageTranslationMangaSites).toEqual([]);
        expect(normalizeConfig({imageTranslationMangaPromptEnabled: false, imageTranslationMangaDownloadConfirmed: true})).toMatchObject({imageTranslationMangaPromptEnabled: false, imageTranslationMangaDownloadConfirmed: true});
        expect(normalizeConfig({imageTranslationMangaPromptEnabled: 'false', imageTranslationMangaDownloadConfirmed: 'true'} as never)).toMatchObject({imageTranslationMangaPromptEnabled: true, imageTranslationMangaDownloadConfirmed: false});
    });
    it.each(['https://mangaplus.shueisha.co.jp/viewer/1024050', 'https://mangaplus.shueisha.co.jp/viewer/1/?lang=en'])('内置阅读页识别 %s', href => {
        expect(resolveMangaSite(href)).toMatchObject({name: 'MANGA Plus', custom: false});
    });
    it.each(['invalid', 'file:///viewer/1', 'http://mangaplus.shueisha.co.jp/viewer/1', 'https://mangaplus.shueisha.co.jp/', 'https://u@mg.example/read', 'https://:p@mg.example/read', 'https://mangaplus.shueisha.co.jp:8888/viewer/1', 'https://mangaplus.shueisha.co.jp.attacker.test/viewer/1'])('拒绝无关地址 %s', href => expect(resolveMangaSite(href)).toBeNull());
    it.each(['invalid', 'file:///chapter/', 'https://u:p@example.com/chapter/', 'https://example.com:4321/chapter/'])('规则拒绝非网页或含凭据与端口 %s', href => expect(createMangaSiteRule(href, 'main img')).toBeNull());
    it.each(['', ' '.repeat(3), 'img'.repeat(100), 'div:has(img)'])('拒绝空或过重选择器 %s', selector => expect(createMangaSiteRule('https://example.com/read/', selector)).toBeNull());
    it('保留精确路径边界，允许手动 HTTP 阅读页，拒绝相似域名和路径', () => {
        const rule = createMangaSiteRule('https://example.com/read?lang=en#page2', ' main img ' )!;
        expect(rule).toEqual({hostname: 'example.com', pathPrefix: '/read', selector: 'main img'});
        expect(resolveMangaSite('https://example.com/read', [rule])?.custom).toBe(true);
        expect(resolveMangaSite('http://example.com/read/123', [rule])?.selector).toBe('main img');
        expect(resolveMangaSite('https://example.com/reader', [rule])).toBeNull();
        expect(resolveMangaSite('https://example.com.attacker/read', [rule])).toBeNull();
        const prefix = {...rule, pathPrefix: '/read/'};
        expect(resolveMangaSite('https://example.com/read/4', [prefix])?.custom).toBe(true);
    });
    it('过滤损坏规则、限定二十项、同域同路径去重并保留显式选择器覆盖', () => {
        const rule = {hostname: 'example.com', pathPrefix: '/read/', selector: 'article img'};
        expect(normalizeMangaSiteRules(null)).toEqual([]);
        expect(normalizeMangaSiteRules([null, 1, {}, {...rule, hostname: 2}, {...rule, pathPrefix: 2}, {...rule, pathPrefix: 'read'}, {...rule, selector: 2}, {...rule, hostname: 'example.com/evil'}, {...rule,pathPrefix:'/read/../evil/'}, {...rule, selector: ':has(img)'}, rule, rule])).toEqual([rule]);
        expect(normalizeMangaSiteRules(Array.from({length: 21}, (_, i) => ({...rule, pathPrefix: `/chapter/${i}/`})))).toHaveLength(20);
        const override = {hostname: 'mangaplus.shueisha.co.jp', pathPrefix: '/viewer/', selector: 'main img'};
        expect(resolveMangaSite('https://mangaplus.shueisha.co.jp/viewer/1024050', [override])).toMatchObject({custom: true, selector: 'main img'});
    });
});
