/**
 * @file tests/apiKeyCheckIdentity.test.ts
 * 文件职责：验证 API Key 连通性检测配置指纹的稳定性、服务隔离和无密钥泄露边界。
 * 主要内容：覆盖 key 行、服务配置、非法 revision 及相同输入的确定性摘要。
 * 模块边界：仅测试 core 配置纯函数，不发起网络请求或访问浏览器存储。
 */

import {describe, expect, it} from 'vitest';
import {createApiKeyCheckRevision, matchesApiKeyCheckRevision} from '@/src/core/config/apiKeyCheckIdentity';

const source = {
    apiKeys: {openai: ['first', '', 'second'], deepseek: ['other']},
    proxy: {openai: 'https://proxy.example'},
    model: {openai: 'gpt'},
    customModel: {},
    customBody: {openai: '{}'},
    customHeaders: {openai: '{}'},
    customOpenAIProviders: [{id: 'custom:one', name: 'One', endpoint: 'https://one.example', models: ['m']}],
    newApiUrl: 'https://api.example',
};

describe('API key check identity', () => {
    it('creates deterministic opaque service and key-row fingerprints', () => {
        const revision = createApiKeyCheckRevision(source, 'openai');
        expect(revision).toMatch(/^[a-f0-9]{64}$/u);
        expect(revision).toBe(createApiKeyCheckRevision({...source}, 'openai'));
        expect(revision).not.toContain('first');
        expect(revision).not.toBe(createApiKeyCheckRevision(source, 'deepseek'));
        expect(matchesApiKeyCheckRevision(source, 'openai', revision)).toBe(true);
    });

    it('changes when raw rows or service-bound configuration changes', () => {
        const revision = createApiKeyCheckRevision(source, 'openai');
        expect(createApiKeyCheckRevision({...source, apiKeys: {openai: ['first', 'second']}}, 'openai')).not.toBe(revision);
        expect(createApiKeyCheckRevision({...source, proxy: {openai: 'https://other.example'}}, 'openai')).not.toBe(revision);
        expect(createApiKeyCheckRevision({...source, customOpenAIProviders: [{id: 'custom:one', name: 'Two', endpoint: 'https://one.example', models: ['m']}]}, 'custom:one'))
            .toBe(createApiKeyCheckRevision(source, 'custom:one'));
        expect(createApiKeyCheckRevision({...source, customOpenAIProviders: [{id: 'custom:one', name: 'One', endpoint: 'https://two.example', models: ['m']}]}, 'custom:one'))
            .not.toBe(createApiKeyCheckRevision(source, 'custom:one'));
        expect(createApiKeyCheckRevision({...source, newApiUrl: 'https://other.example'}, 'openai'))
            .toBe(createApiKeyCheckRevision(source, 'openai'));
        expect(createApiKeyCheckRevision({...source, newApiUrl: 'https://other.example'}, 'newapi'))
            .not.toBe(createApiKeyCheckRevision(source, 'newapi'));
        expect(createApiKeyCheckRevision({...source, serviceRegion: {azureTranslator: 'eastus'}}, 'azureTranslator'))
            .not.toBe(createApiKeyCheckRevision({...source, serviceRegion: {azureTranslator: 'global'}}, 'azureTranslator'));
        expect(createApiKeyCheckRevision({...source, serviceRegion: {azureTranslator: 'eastus'}}, 'openai')).toBe(revision);
    });

    it('rejects malformed or stale revisions without throwing', () => {
        const revision = createApiKeyCheckRevision(source, 'openai');
        expect(matchesApiKeyCheckRevision(source, 'openai', revision.toUpperCase())).toBe(false);
        expect(matchesApiKeyCheckRevision(source, 'openai', 'bad')).toBe(false);
        expect(matchesApiKeyCheckRevision(source, 'openai', null)).toBe(false);
        expect(matchesApiKeyCheckRevision(source, 'openai', createApiKeyCheckRevision(source, 'deepseek'))).toBe(false);
        expect(createApiKeyCheckRevision({...source, proxy: 'invalid', customOpenAIProviders: null}, 'openai'))
            .toMatch(/^[a-f0-9]{64}$/u);
    });
});
