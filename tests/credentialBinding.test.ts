import {describe, expect, it} from 'vitest';
import {
    currentModelIds,
    services,
} from '@/src/core/config/catalog';
import {dropCredentialsForChangedDestinations} from '@/src/core/config/credentialBinding';
import {
    extractConfigCredentials,
    type ConfigCredentialField,
} from '@/src/core/config/credentials';
import {Config, normalizeConfig} from '@/src/core/config/model';

function configured(
    service: string,
    overrides: Partial<Config> = {},
): Config {
    return normalizeConfig({
        ...new Config(),
        service,
        token: {[service]: `${service}-secret`},
        ...overrides,
    });
}

function transition(current: Config, overrides: Partial<Config>): Config {
    return normalizeConfig({...current, ...overrides});
}

function rebound(
    current: Config,
    next: Config,
    explicitlyBoundTokens: ReadonlySet<string> = new Set(),
    explicitlyBoundFields: ReadonlySet<ConfigCredentialField> = new Set(),
) {
    return dropCredentialsForChangedDestinations(
        extractConfigCredentials(next),
        current,
        next,
        explicitlyBoundTokens,
        explicitlyBoundFields,
    );
}

describe('凭据与真实请求目的地绑定', () => {
    it('Azure Translator only sends its key to the fixed official endpoint regardless of stale proxy fields', () => {
        const current = configured(services.azureTranslator);
        const next = transition(current, {azureTranslatorRegion: 'eastasia', proxy: {azureTranslator: 'https://ignored.example'}});
        expect(rebound(current, next).token.azureTranslator).toBe('azureTranslator-secret');
    });
    it('Gemini 的官方 Key 不随无凭据 proxy 切换而误清', () => {
        const current = configured(services.gemini);
        const proxyA = transition(current, {proxy: {[services.gemini]: 'https://proxy-a.example/gemini'}});
        const proxyB = transition(current, {proxy: {[services.gemini]: 'https://proxy-b.example/gemini'}});

        expect(rebound(current, proxyA).token[services.gemini]).toBe('gemini-secret');
        expect(rebound(proxyA, proxyB).token[services.gemini]).toBe('gemini-secret');
        expect(rebound(proxyB, current).token[services.gemini]).toBe('gemini-secret');
    });

    it('MiniMax 与 MiMo 只在实际 endpoint 改变时解绑 token，稳定 proxy 遮蔽底层变化', () => {
        const minimax = configured(services.minimax, {
            minimaxBillingPlan: 'payg',
            minimaxRegion: 'cn',
        });
        const sameMinimaxEndpoint = transition(minimax, {minimaxBillingPlan: 'token-plan'});
        const globalMinimax = transition(minimax, {minimaxRegion: 'global'});
        expect(rebound(minimax, sameMinimaxEndpoint).token[services.minimax]).toBe('minimax-secret');
        expect(rebound(minimax, globalMinimax).token).not.toHaveProperty(services.minimax);

        const mimo = configured(services.mimo, {
            mimoBillingPlan: 'payg',
            mimoRegion: 'cn',
        });
        const samePaygEndpoint = transition(mimo, {mimoRegion: 'sgp'});
        const tokenPlan = transition(mimo, {mimoBillingPlan: 'token-plan'});
        const tokenPlanEurope = transition(tokenPlan, {mimoRegion: 'ams'});
        expect(rebound(mimo, samePaygEndpoint).token[services.mimo]).toBe('mimo-secret');
        expect(rebound(mimo, tokenPlan).token).not.toHaveProperty(services.mimo);
        expect(rebound(tokenPlan, tokenPlanEurope).token).not.toHaveProperty(services.mimo);

        const stableProxy = 'https://stable-proxy.example/v1/chat/completions';
        const proxied = transition(mimo, {proxy: {[services.mimo]: stableProxy}});
        const proxiedTokenPlan = transition(proxied, {
            mimoBillingPlan: 'token-plan',
            mimoRegion: 'ams',
        });
        expect(rebound(proxied, proxiedTokenPlan).token[services.mimo]).toBe('mimo-secret');
    });

    it('通义普通模型共享官方 endpoint，Token Plan 或配置的目的地集合变化会解绑', () => {
        const service = services.tongyi;
        const current = configured(service, {
            model: {...new Config().model, [service]: 'qwen3.6-flash'},
            documentModel: {...new Config().documentModel, [service]: 'qwen3.7-plus'},
        });
        const ordinaryModel = transition(current, {
            model: {...current.model, [service]: 'qwen3.7-max'},
        });
        const tokenPlan = transition(current, {
            model: {...current.model, [service]: currentModelIds.tongyiTokenPlan},
        });
        expect(rebound(current, ordinaryModel).token[service]).toBe('tongyi-secret');
        expect(rebound(current, tokenPlan).token).not.toHaveProperty(service);

        const stableProxy = 'https://stable-tongyi-proxy.example/v1/chat/completions';
        const proxied = transition(current, {proxy: {[service]: stableProxy}});
        const proxiedTokenPlan = transition(proxied, {
            model: {...proxied.model, [service]: currentModelIds.tongyiTokenPlan},
        });
        expect(rebound(proxied, proxiedTokenPlan).token[service]).toBe('tongyi-secret');
    });

    it('NewAPI 等价配置归一到同一请求 URL，Azure 忽略 generic proxy 但绑定专用 endpoint', () => {
        const newApi = configured(services.newapi, {newApiUrl: 'https://gateway.example'});
        for (const equivalent of [
            'https://gateway.example/v1',
            'https://gateway.example/v1/chat/completions',
            'https://gateway.example/v1/chat/completions#ignored',
        ]) {
            expect(rebound(newApi, transition(newApi, {newApiUrl: equivalent})).token[services.newapi])
                .toBe('newapi-secret');
        }
        expect(rebound(newApi, transition(newApi, {newApiUrl: 'https://other.example/v1'})).token)
            .not.toHaveProperty(services.newapi);

        const azure = configured(services.azureOpenai, {
            azureOpenaiEndpoint: 'https://demo.openai.azure.com/openai/deployments/a/chat/completions',
        });
        const irrelevantProxy = transition(azure, {
            proxy: {[services.azureOpenai]: 'https://ignored-proxy.example/v1'},
        });
        const changedEndpoint = transition(azure, {
            azureOpenaiEndpoint: 'https://other.openai.azure.com/openai/deployments/a/chat/completions',
        });
        expect(rebound(azure, irrelevantProxy).token[services.azureOpenai]).toBe('azureOpenai-secret');
        expect(rebound(azure, changedEndpoint).token).not.toHaveProperty(services.azureOpenai);
    });

    it('动态 OpenAI 完整 Chat Completions URL 的尾斜杠与 fragment 不造成误解绑', () => {
        const service = 'custom:canonical-endpoint';
        const profile = (endpoint: string) => ({
            id: service,
            name: 'Canonical Endpoint',
            endpoint,
            models: ['canonical-model'],
        });
        const current = configured(service, {
            customOpenAIProviders: [profile('https://custom.example/v1/chat/completions/')],
            model: {...new Config().model, [service]: 'canonical-model'},
            documentModel: {...new Config().documentModel, [service]: 'canonical-model'},
        });
        const equivalent = transition(current, {
            customOpenAIProviders: [profile('https://custom.example/v1/chat/completions#ignored')],
        });
        const sameUrlViaProxy = transition(current, {
            proxy: {[service]: 'https://custom.example/v1/chat/completions'},
        });

        expect(rebound(current, equivalent).token[service]).toBe(`${service}-secret`);
        expect(rebound(current, sameUrlViaProxy).token[service]).toBe(`${service}-secret`);
    });

    it('非 HTTP、空白与非法地址保持稳定身份，不会在配置未变化时误清凭据', () => {
        const directService = services.deepL;
        for (const proxy of ['ftp://proxy.example/translate', 'not a valid url']) {
            const config = configured(directService, {proxy: {[directService]: proxy}});
            expect(rebound(config, config).token[directService]).toBe(`${directService}-secret`);
        }

        for (const newApiUrl of ['', 'ftp://gateway.example/v1', 'not a valid url']) {
            const config = configured(services.newapi, {newApiUrl});
            expect(rebound(config, config).token[services.newapi]).toBe('newapi-secret');
        }

        const official = configured(services.openai);
        expect(rebound(official, official).token[services.openai]).toBe('openai-secret');
        const unknown = configured('legacy-unknown-service');
        expect(rebound(unknown, unknown).token['legacy-unknown-service'])
            .toBe('legacy-unknown-service-secret');
    });

    it('DeepLX 凭据身份覆盖 proxy、显式端点和默认端点三条运行时分支', () => {
        const service = services.deeplx;
        const explicit = configured(service, {deeplx: 'https://deeplx.example/translate'});
        expect(rebound(explicit, explicit).token[service]).toBe('deeplx-secret');

        const proxied = transition(explicit, {
            proxy: {[service]: 'https://deeplx.example/translate'},
        });
        expect(rebound(explicit, proxied).token[service]).toBe('deeplx-secret');

        const defaults = configured(service, {deeplx: ''});
        expect(rebound(defaults, defaults).token[service]).toBe('deeplx-secret');
    });

    it('腾讯共享密钥任一真实 proxy 改道时成对清除，仅完整显式重绑才保留', () => {
        const current = normalizeConfig({
            ...new Config(),
            tencentSecretId: 'current-tencent-id',
            tencentSecretKey: 'current-tencent-key',
        });
        const changedTmt = transition(current, {
            proxy: {[services.tencent]: 'https://tmt-proxy.example/'},
        });
        const changedHunyuan = transition(current, {
            proxy: {[services.huanYuanTranslation]: 'https://hunyuan-proxy.example/'},
        });
        const sameOfficialUrlViaProxy = transition(current, {
            proxy: {[services.tencent]: 'https://tmt.tencentcloudapi.com/'},
        });
        const directProxyWithSlash = transition(current, {
            proxy: {[services.tencent]: 'https://tmt-proxy.example/chat/completions/'},
        });
        const directProxyWithoutSlash = transition(directProxyWithSlash, {
            proxy: {[services.tencent]: 'https://tmt-proxy.example/chat/completions'},
        });
        expect(rebound(current, changedTmt)).toMatchObject({tencentSecretId: '', tencentSecretKey: ''});
        expect(rebound(current, changedHunyuan)).toMatchObject({tencentSecretId: '', tencentSecretKey: ''});
        expect(rebound(current, sameOfficialUrlViaProxy)).toMatchObject({
            tencentSecretId: 'current-tencent-id',
            tencentSecretKey: 'current-tencent-key',
        });
        expect(rebound(directProxyWithSlash, directProxyWithoutSlash))
            .toMatchObject({tencentSecretId: '', tencentSecretKey: ''});

        const rotated = transition(changedTmt, {
            tencentSecretId: 'rotated-tencent-id',
            tencentSecretKey: 'rotated-tencent-key',
        });
        expect(rebound(current, rotated, new Set(), new Set([
            'tencentSecretId',
            'tencentSecretKey',
        ]))).toMatchObject({
            tencentSecretId: 'rotated-tencent-id',
            tencentSecretKey: 'rotated-tencent-key',
        });
        expect(rebound(current, rotated, new Set(), new Set(['tencentSecretId'])))
            .toMatchObject({tencentSecretId: '', tencentSecretKey: ''});
    });

    it('未被 provider 消费的 legacy/extra 字段不因 endpoint 变化而清除', () => {
        const current = normalizeConfig({
            ...new Config(),
            token: {openai: 'openai-secret'},
            ak: 'legacy-ak',
            sk: 'legacy-sk',
            appid: 'legacy-appid',
            key: 'legacy-key',
            extra: {private: 'forward-compatible'},
        });
        const next = transition(current, {
            proxy: {openai: 'https://new-openai-proxy.example/v1/chat/completions'},
        });
        expect(rebound(current, next)).toMatchObject({
            ak: 'legacy-ak',
            sk: 'legacy-sk',
            appid: 'legacy-appid',
            key: 'legacy-key',
            extra: {private: 'forward-compatible'},
        });
    });
});
