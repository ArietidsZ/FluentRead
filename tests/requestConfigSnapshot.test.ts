import {describe, expect, it} from 'vitest';
import {
    TRANSLATION_PROVIDER_CONFIG,
    attachTranslationProviderConfig,
    createTranslationProviderConfigSnapshot,
    getTranslationProviderConfig,
} from '@/src/services/translation/requestSnapshot';
import type {TranslationConfigSource} from '@/src/services/translation/types';

function configSource(overrides: Partial<TranslationConfigSource> = {}): TranslationConfigSource {
    return {
        service: 'aiSdk',
        from: 'auto',
        to: 'zh-Hans',
        useCache: true,
        enableAIContext: true,
        model: {aiSdk: 'model-a'},
        customModel: {aiSdk: 'custom-model-a'},
        proxy: {aiSdk: 'https://a.example/v1'},
        custom: 'https://custom-a.example/v1',
        deeplx: 'https://deeplx-a.example',
        newApiUrl: 'https://newapi-a.example',
        minimaxBillingPlan: 'payg',
        minimaxRegion: 'cn',
        mimoBillingPlan: 'payg',
        mimoRegion: 'cn',
        azureOpenaiEndpoint: 'https://azure-a.example/chat/completions',
        customBody: {aiSdk: '{"snapshot":"a"}'},
        system_role: {aiSdk: 'system-a'},
        user_role: {aiSdk: 'user-a'},
        deepseekApiType: 'chat',
        deepseekThinkingMode: 'disabled',
        ...overrides,
    };
}

describe('translation provider request config snapshot', () => {
    it('clones and freezes every provider-visible nested map and credential', () => {
        const source = configSource({
            token: {aiSdk: 'token-a'},
            requireApiKey: {'aiSdk:model-a': true},
            youdaoAppKey: 'youdao-key-a',
            youdaoAppSecret: 'youdao-secret-a',
            tencentSecretId: 'tencent-id-a',
            tencentSecretKey: 'tencent-key-a',
        });
        const snapshot = createTranslationProviderConfigSnapshot(source);

        source.model.aiSdk = 'model-b';
        source.customModel.aiSdk = 'custom-model-b';
        source.proxy.aiSdk = 'https://b.example/v1';
        source.customBody.aiSdk = '{"snapshot":"b"}';
        source.system_role.aiSdk = 'system-b';
        source.user_role.aiSdk = 'user-b';
        source.token!.aiSdk = 'token-b';
        source.requireApiKey!['aiSdk:model-a'] = false;

        expect(snapshot).toMatchObject({
            model: {aiSdk: 'model-a'},
            customModel: {aiSdk: 'custom-model-a'},
            proxy: {aiSdk: 'https://a.example/v1'},
            customBody: {aiSdk: '{"snapshot":"a"}'},
            system_role: {aiSdk: 'system-a'},
            user_role: {aiSdk: 'user-a'},
            token: {aiSdk: 'token-a'},
            requireApiKey: {'aiSdk:model-a': true},
            youdaoAppKey: 'youdao-key-a',
            youdaoAppSecret: 'youdao-secret-a',
            tencentSecretId: 'tencent-id-a',
            tencentSecretKey: 'tencent-key-a',
        });
        expect([
            snapshot,
            snapshot.model,
            snapshot.customModel,
            snapshot.proxy,
            snapshot.customBody,
            snapshot.system_role,
            snapshot.user_role,
            snapshot.token,
            snapshot.requireApiKey,
        ].every(Object.isFrozen)).toBe(true);
    });

    it('uses safe credential defaults and resolves attached context without trusting message JSON', () => {
        const snapshot = createTranslationProviderConfigSnapshot(configSource());
        const fallback = createTranslationProviderConfigSnapshot(configSource({service: 'fallback'}));
        const message = {origin: 'hello'};
        const attached = attachTranslationProviderConfig(message, snapshot);

        expect(attached).toBe(message);
        expect(attached[TRANSLATION_PROVIDER_CONFIG]).toBe(snapshot);
        expect(getTranslationProviderConfig(attached, fallback)).toBe(snapshot);
        expect(getTranslationProviderConfig({}, fallback)).toBe(fallback);
        expect(getTranslationProviderConfig(null, fallback)).toBe(fallback);
        expect(getTranslationProviderConfig('not-an-object', fallback)).toBe(fallback);
        expect(snapshot).toMatchObject({
            token: {},
            requireApiKey: {},
            youdaoAppKey: '',
            youdaoAppSecret: '',
            tencentSecretId: '',
            tencentSecretKey: '',
        });
        expect(Object.getOwnPropertySymbols(attached)).toEqual([TRANSLATION_PROVIDER_CONFIG]);
        expect(JSON.stringify(attached)).toBe('{"origin":"hello"}');
    });
});
