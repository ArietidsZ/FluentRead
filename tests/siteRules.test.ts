import { describe, expect, it } from 'vitest';

import {
    getSiteBaseDomain,
    isAlwaysTranslateSite,
    normalizeAlwaysTranslateDomains,
    shouldAutoTranslatePage,
} from '@/entrypoints/utils/siteRules';

describe('始终翻译网站规则', () => {
    it('使用 Public Suffix List 统一为可注册域名，并覆盖私有后缀', () => {
        expect(getSiteBaseDomain('https://news.bbc.co.uk/world')).toBe('bbc.co.uk');
        expect(getSiteBaseDomain('WWW.Example.COM./article')).toBe('example.com');
        expect(getSiteBaseDomain('https://docs.team.github.io/guide')).toBe('team.github.io');
        expect(getSiteBaseDomain('https://www.例子.中国/')).toBe('xn--fsqu00a.xn--fiqs8s');
    });

    it('为 localhost、单标签主机和 IP 保留精确 hostname', () => {
        expect(getSiteBaseDomain('localhost:5173/path')).toBe('localhost');
        expect(getSiteBaseDomain('http://printer/queue')).toBe('printer');
        expect(getSiteBaseDomain('http://192.168.1.10:8080/')).toBe('192.168.1.10');
        expect(getSiteBaseDomain('https://[::1]:8443/')).toBe('[::1]');
    });

    it('拒绝 public suffix、非法主机及非网页协议', () => {
        expect(getSiteBaseDomain('com')).toBeNull();
        expect(getSiteBaseDomain('https://co.uk/')).toBeNull();
        expect(getSiteBaseDomain('github.io')).toBeNull();
        expect(getSiteBaseDomain('*.example.com')).toBeNull();
        expect(getSiteBaseDomain('https://foo..com/')).toBeNull();
        expect(getSiteBaseDomain('file:///tmp/article.html')).toBeNull();
        expect(getSiteBaseDomain('chrome://settings')).toBeNull();
        expect(getSiteBaseDomain('mailto:user@example.com')).toBeNull();
        expect(getSiteBaseDomain('')).toBeNull();
    });

    it('规范化导入列表时保持顺序、按 base domain 去重并忽略非法项', () => {
        expect(normalizeAlwaysTranslateDomains([
            'https://news.bbc.co.uk/world',
            'BBC.CO.UK',
            'https://docs.team.github.io/guide',
            'blog.team.github.io',
            'localhost:3000',
            'co.uk',
            42,
            '',
        ])).toEqual(['bbc.co.uk', 'team.github.io', 'localhost']);
        expect(normalizeAlwaysTranslateDomains('example.com')).toEqual([]);
    });

    it('只按规范化后的 base domain 匹配，不产生字符串后缀误判', () => {
        const domains = ['https://www.example.com/path', 'team.github.io'];
        expect(isAlwaysTranslateSite('https://mail.example.com/inbox', domains)).toBe(true);
        expect(isAlwaysTranslateSite('https://docs.team.github.io/', domains)).toBe(true);
        expect(isAlwaysTranslateSite('https://notexample.com/', domains)).toBe(false);
        expect(isAlwaysTranslateSite('edge://settings', domains)).toBe(false);
    });

    it('同时保留旧全局自动翻译开关，并只对网站名单限制网页协议', () => {
        expect(shouldAutoTranslatePage('https://unlisted.example/', {
            on: true,
            autoTranslate: true,
            alwaysTranslateDomains: [],
        })).toBe(true);
        expect(shouldAutoTranslatePage('https://news.example.com/', {
            on: true,
            autoTranslate: false,
            alwaysTranslateDomains: ['example.com'],
        })).toBe(true);
        expect(shouldAutoTranslatePage('https://news.example.com/', {
            on: false,
            autoTranslate: true,
            alwaysTranslateDomains: ['example.com'],
        })).toBe(false);
        expect(shouldAutoTranslatePage('file:///tmp/article.html', {
            on: true,
            autoTranslate: true,
            alwaysTranslateDomains: [],
        })).toBe(true);
        expect(shouldAutoTranslatePage('file:///tmp/article.html', {
            on: true,
            autoTranslate: false,
            alwaysTranslateDomains: ['example.com'],
        })).toBe(false);
    });
});
