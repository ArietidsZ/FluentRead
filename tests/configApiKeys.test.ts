/**
 * @file tests/configApiKeys.test.ts
 * 文件职责：验证多 API Key 配置的规范化、旧 token 迁移、兼容镜像与空行语义。
 * 主要内容：覆盖逗号 key、顺序、空行、显式清空以及 Config 归一化往返。
 * 模块边界：仅测试 core 配置纯函数，不访问浏览器存储或真实 provider。
 */

import {describe, expect, it} from 'vitest';
import {apiKeysToToken, getServiceApiKeyRows, getServiceApiKeys, normalizeApiKeys} from '@/src/core/config/apiKeys';
import {normalizeConfig} from '@/src/core/config/model';

describe('多 API Key 配置', () => {
    it('保留顺序、空行和逗号，不把 key 拆成多个值', () => {
        const apiKeys = normalizeApiKeys({openai: [' first ', '', 'a,b', 42, ' second ']});
        expect(apiKeys).toEqual({openai: ['first', '', 'a,b', 'second']});
        expect(getServiceApiKeyRows({apiKeys}, 'openai')).toEqual(['first', '', 'a,b', 'second']);
        expect(getServiceApiKeys({apiKeys}, 'openai')).toEqual(['first', 'a,b', 'second']);
    });

    it('旧 token 迁移为单 key，新列表优先且显式空列表清空', () => {
        expect(normalizeConfig({token: {openai: 'legacy,key'}}).apiKeys).toEqual({openai: ['legacy,key']});
        expect(normalizeConfig({token: {openai: 'legacy'}, apiKeys: {openai: ['new-1', 'new-2']}}))
            .toMatchObject({apiKeys: {openai: ['new-1', 'new-2']}, token: {openai: 'new-1'}});
        expect(normalizeConfig({token: {openai: 'legacy'}, apiKeys: {openai: []}}))
            .toMatchObject({apiKeys: {openai: []}, token: {}});
        expect(normalizeConfig({token: {openai: 'legacy'}, apiKeys: {openai: ['']}}))
            .toMatchObject({apiKeys: {openai: ['']}, token: {}});
    });

    it('兼容读取缺失新字段并生成首个非空 token', () => {
        expect(normalizeApiKeys(null)).toEqual({});
        expect(normalizeApiKeys({openai: 'not-an-array'})).toEqual({});
        expect(getServiceApiKeys({token: {openai: 'legacy'}}, 'openai')).toEqual(['legacy']);
        expect(getServiceApiKeyRows({apiKeys: null, token: {openai: 'legacy'}}, 'openai')).toEqual(['legacy']);
        expect(getServiceApiKeys({token: {openai: 42}}, 'openai')).toEqual([]);
        expect(getServiceApiKeys({token: {openai: '  '}}, 'openai')).toEqual([]);
        expect(getServiceApiKeys({apiKeys: {openai: ['a', 'a', '']}, token: {openai: 'legacy'}}, 'openai'))
            .toEqual(['a']);
        expect(apiKeysToToken({openai: ['', 'second'], deepseek: ['first', 'second']}))
            .toEqual({openai: 'second', deepseek: 'first'});
    });

    it('保留仅有多 Key 的旧自定义服务，忽略无效和空白凭据行', () => {
        const migrated = normalizeConfig({apiKeys: {custom: [42, ' ', 'custom-key', 'backup-key']}});
        expect(migrated.customOpenAIProviders.some(provider => provider.id === 'custom')).toBe(true);
        expect(migrated.apiKeys.custom).toEqual(['', 'custom-key', 'backup-key']);
        expect(migrated.token.custom).toBe('custom-key');
        expect(normalizeConfig({apiKeys: {custom: [42, ' ']}}).customOpenAIProviders).toEqual([]);
    });
});
