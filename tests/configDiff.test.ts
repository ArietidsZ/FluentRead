import {describe, expect, it} from 'vitest';

import {buildConfigDiff} from '@/src/core/config/diff';
import {getMultilingualTargetLanguageLabel} from '@/src/core/config/catalog';
import {createApiKeyRequirementKey} from '@/src/core/config/validation';

function group(result: ReturnType<typeof buildConfigDiff>, id: string) {
    return result.groups.find((item) => item.id === id);
}

describe('配置差异预览', () => {
    it('为新增目标语言选项提供跨语言可识别的标签，并保留未知值回退', () => {
        expect(getMultilingualTargetLanguageLabel('de', 'Deutsch')).toBe('Deutsch / German / 德语');
        expect(getMultilingualTargetLanguageLabel('pt', 'Português')).toBe('Português / Portuguese / 葡萄牙语');
        expect(getMultilingualTargetLanguageLabel('it', 'Italiano')).toBe('Italiano / Italian / 意大利语');
        expect(getMultilingualTargetLanguageLabel('ja', '日本語', 'en-US')).toBe('Japanese');
        expect(getMultilingualTargetLanguageLabel('ja', '日本語', 'es-ES')).toBe('Japonés / Japanese / 日本語');
        expect(getMultilingualTargetLanguageLabel('ja', '日本語', 'de-DE')).toBe('日本語 / Japanese / 日语');
        expect(getMultilingualTargetLanguageLabel('unknown', '自定义语言')).toBe('自定义语言');
    });

    it('格式化界面语言选择，包括西班牙语', () => {
        const result = buildConfigDiff({uiLanguage: 'zh-CN'}, {uiLanguage: 'es-ES'});

        expect(group(result, 'general')?.changes).toEqual([
            {key: 'uiLanguage', label: '界面语言', before: '中文', after: 'Español'},
        ]);
    });

    it('用用户可见名称预览段落加载样式变化', () => {
        const result = buildConfigDiff(
            {translationLoadingStyle: 'minimal'},
            {translationLoadingStyle: 'sparkle'},
        );

        expect(group(result, 'advanced')?.changes).toContainEqual({
            key: 'translationLoadingStyle',
            label: '段落加载样式',
            before: '简洁',
            after: '星光',
        });
    });

    it('预览双语逐句高亮开关', () => {
        const result = buildConfigDiff({bilingualSentenceHighlightEnabled: false}, {
            bilingualSentenceHighlightEnabled: true,
        });

        expect(group(result, 'general')?.changes).toEqual(expect.arrayContaining([expect.objectContaining({
            key: 'bilingualSentenceHighlightEnabled',
            label: '双语逐句高亮',
            before: '关闭',
            after: '开启',
        })]));
    });

    it('显示界面皮肤和 Popup 栏目可见性，并安全处理异常栏目值', () => {
        const result = buildConfigDiff({
            interfaceSkin: 'default',
            interfaceVisibility: {
                popupQuickFeatures: true,
                popupSiteRule: true,
                popupFooter: true,
            },
            popupModuleOrder: ['translation', 'siteRule', 'quickFeatures', 'footer'],
            popupQuickFeatureVisibility: {
                hover: true,
                selection: true,
                appearance: true,
                image: true,
                video: true,
                document: true,
            },
            popupQuickFeatureOrder: ['hover', 'selection', 'appearance', 'image', 'video', 'document'],
        }, {
            interfaceSkin: 'minimal',
            interfaceVisibility: {
                popupQuickFeatures: false,
                popupSiteRule: true,
                popupFooter: false,
            },
            popupModuleOrder: ['quickFeatures', 'translation', 'siteRule', 'footer'],
            popupQuickFeatureVisibility: {
                hover: true,
                selection: true,
                appearance: true,
                image: false,
                video: true,
                document: true,
            },
            popupQuickFeatureOrder: ['document', 'hover', 'selection', 'appearance', 'image', 'video'],
        });

        expect(group(result, 'general')?.changes).toEqual(expect.arrayContaining([
            {key: 'interfaceSkin', label: '界面皮肤', before: '默认风格', after: '简约风格'},
            {
                key: 'interfaceVisibility',
                label: '界面栏目',
                before: '快捷功能栏开启、当前网站栏目开启、底部信息栏开启',
                after: '快捷功能栏关闭、当前网站栏目开启、底部信息栏关闭',
            },
            {
                key: 'popupModuleOrder',
                label: '菜单栏布局顺序',
                before: '翻译控制 → 当前网站栏目 → 快捷功能栏 → 底部信息栏',
                after: '快捷功能栏 → 翻译控制 → 当前网站栏目 → 底部信息栏',
            },
            {
                key: 'popupQuickFeatureVisibility',
                label: '快捷功能卡片',
                before: '鼠标悬停翻译：显示、划词翻译：显示、译文显示：显示、图片翻译：显示、视频字幕：显示、文档翻译：显示',
                after: '鼠标悬停翻译：显示、划词翻译：显示、译文显示：显示、图片翻译：隐藏、视频字幕：显示、文档翻译：显示',
            },
            {
                key: 'popupQuickFeatureOrder',
                label: '快捷功能顺序',
                before: '鼠标悬停翻译 → 划词翻译 → 译文显示 → 图片翻译 → 视频字幕 → 文档翻译',
                after: '文档翻译 → 鼠标悬停翻译 → 划词翻译 → 译文显示 → 图片翻译 → 视频字幕',
            },
        ]));

        const paletteResult = buildConfigDiff(
            {interfaceSkin: 'ocean'},
            {interfaceSkin: 'cheese'},
        );
        expect(group(paletteResult, 'general')?.changes).toContainEqual({
            key: 'interfaceSkin',
            label: '界面皮肤',
            before: '海盐 🌊',
            after: '奶酪 🧀',
        });

        const malformed = buildConfigDiff(
            {interfaceVisibility: true},
            {interfaceVisibility: false},
        );
        expect(group(malformed, 'general')?.changes[0]).toMatchObject({
            key: 'interfaceVisibility',
            before: '开启',
            after: '关闭',
        });

        const malformedOrder = buildConfigDiff(
            {popupModuleOrder: false},
            {popupModuleOrder: []},
        );
        expect(group(malformedOrder, 'general')?.changes[0]).toMatchObject({
            key: 'popupModuleOrder',
            before: '关闭',
            after: '无',
        });

        const futureOrder = buildConfigDiff(
            {popupModuleOrder: [42, 'futureModule']},
            {popupModuleOrder: ['translation']},
        );
        expect(group(futureOrder, 'general')?.changes[0]).toMatchObject({
            key: 'popupModuleOrder',
            before: '42 → futureModule',
            after: '翻译控制',
        });

        const malformedQuickFeatureVisibility = buildConfigDiff(
            {popupQuickFeatureVisibility: true},
            {popupQuickFeatureVisibility: false},
        );
        expect(group(malformedQuickFeatureVisibility, 'general')?.changes[0]).toMatchObject({
            key: 'popupQuickFeatureVisibility',
            before: '开启',
            after: '关闭',
        });

        const malformedQuickFeatureOrder = buildConfigDiff(
            {popupQuickFeatureOrder: false},
            {popupQuickFeatureOrder: []},
        );
        expect(group(malformedQuickFeatureOrder, 'general')?.changes[0]).toMatchObject({
            key: 'popupQuickFeatureOrder',
            before: '关闭',
            after: '无',
        });

        const futureQuickFeatureOrder = buildConfigDiff(
            {popupQuickFeatureOrder: [42, 'futureFeature']},
            {popupQuickFeatureOrder: ['hover']},
        );
        expect(group(futureQuickFeatureOrder, 'general')?.changes[0]).toMatchObject({
            key: 'popupQuickFeatureOrder',
            before: '42 → futureFeature',
            after: '鼠标悬停翻译',
        });
    });

    it('按设置页稳定分组并把常用枚举、开关、数组和数字格式化为可读文本', () => {
        const result = buildConfigDiff({
            on: true,
            display: 1,
            service: 'microsoft',
            hotkey: 'Control',
            alwaysTranslateDomains: ['example.com'],
            disableImageTranslator: true,
            videoSubtitleFontSize: 100,
            useCache: true,
            translationCenterServices: ['microsoft'],
            futureSetting: false,
        }, {
            on: false,
            display: 0,
            service: 'openai',
            hotkey: 'Alt',
            alwaysTranslateDomains: ['example.com', 'openai.com'],
            disableImageTranslator: false,
            videoSubtitleFontSize: 140,
            useCache: false,
            translationCenterServices: ['openai', 'deepseek'],
            futureSetting: {mode: 'compact', enabled: true},
        });

        expect(result.groups.map((item) => item.id)).toEqual([
            'general',
            'translation',
            'siteRules',
            'imageAndArea',
            'videoSubtitles',
            'advanced',
            'tools',
            'other',
        ]);
        expect(result.changeCount).toBe(10);
        expect(group(result, 'general')?.changes[0]).toMatchObject({
            key: 'on', label: '插件状态', before: '开启', after: '关闭',
        });
        expect(group(result, 'general')?.changes).toEqual(expect.arrayContaining([expect.objectContaining({
            label: '翻译模式', before: '双语对照模式', after: '仅译文模式',
        })]));
        expect(group(result, 'general')?.changes).toEqual(expect.arrayContaining([expect.objectContaining({
            before: '微软翻译', after: 'OpenAI',
        })]));
        expect(group(result, 'translation')?.changes[0]).toMatchObject({before: 'Ctrl', after: 'Alt'});
        expect(group(result, 'siteRules')?.changes[0]).toMatchObject({
            before: 'example.com', after: 'example.com、openai.com',
        });
        expect(group(result, 'imageAndArea')?.changes[0]).toMatchObject({before: '关闭', after: '开启'});
        expect(group(result, 'videoSubtitles')?.changes[0]).toMatchObject({before: '100%', after: '140%'});
        expect(group(result, 'advanced')?.changes[0]).toMatchObject({before: '开启', after: '关闭'});
        expect(group(result, 'tools')?.changes[0]).toMatchObject({
            before: '微软翻译', after: 'OpenAI、DeepSeek',
        });
        expect(group(result, 'other')?.changes[0]).toMatchObject({
            key: 'futureSetting', label: 'future setting', before: '关闭', after: 'mode：compact；enabled：开启',
        });
    });

    it('把多个快捷翻译方案展示为可辨认的动作、热键和服务摘要', () => {
        const result = buildConfigDiff({quickTranslationProfiles: []}, {
            quickTranslationProfiles: [
                {
                    id: 'hover', enabled: true, action: 'hover', hotkey: 'Ctrl+T',
                    service: 'openai', model: 'gpt-5.6-luna', targetLanguage: 'ja',
                    displayMode: 'bilingual', fullPageMode: 'inherit',
                },
                {
                    id: 'page', enabled: false, action: 'full-page', hotkey: 'Ctrl+Y',
                    service: '', model: '', targetLanguage: '',
                    displayMode: 'translation-only', fullPageMode: 'all',
                },
            ],
        });

        expect(result.changeCount).toBe(1);
        const change = group(result, 'translation')?.changes[0];
        expect(change).toMatchObject({
            key: 'quickTranslationProfiles',
            label: '快捷翻译方案',
            before: '无',
        });
        expect(change?.after).toContain('悬停 Ctrl+T：OpenAI · gpt-5.6-luna，日本語，双语');
        expect(change?.after).toContain('全文 Ctrl+Y（已停用）：默认服务，默认语言，仅译文');
    });

    it('全文方案只改变翻译范围时，diff 仍能直接说明改了什么', () => {
        const profile = {
            id: 'page', enabled: true, action: 'full-page', hotkey: 'Ctrl+Y',
            service: '', model: '', targetLanguage: '', displayMode: 'inherit',
        };
        const result = buildConfigDiff(
            {quickTranslationProfiles: [{...profile, fullPageMode: 'viewport'}]},
            {quickTranslationProfiles: [{...profile, fullPageMode: 'all'}]},
        );
        const change = group(result, 'translation')?.changes[0];

        expect(change?.before).toContain('按阅读进度');
        expect(change?.after).toContain('立即翻译到网页底部');
        expect(change?.before).not.toBe(change?.after);
    });

    it('第 5 至 8 个快捷方案的变化也会出现在历史差异中', () => {
        const profiles = Array.from({length: 8}, (_, index) => ({
            id: `quick-${index + 1}`, enabled: true, action: 'hover',
            hotkey: `Ctrl+${String.fromCharCode(65 + index)}`, service: 'openai',
            model: `model-${index + 1}`, targetLanguage: '', displayMode: 'inherit',
            fullPageMode: 'inherit',
        }));
        const result = buildConfigDiff(
            {quickTranslationProfiles: profiles},
            {quickTranslationProfiles: profiles.map((profile, index) => index === 7
                ? {...profile, model: 'changed-eighth-model'} : profile)},
        );
        const change = group(result, 'translation')?.changes[0];

        expect(change?.before).toContain('model-8');
        expect(change?.after).toContain('changed-eighth-model');
        expect(change?.before).not.toBe(change?.after);
    });

    it('畸形或未完成的快捷方案差异仍可读且不遗漏默认范围', () => {
        const result = buildConfigDiff({quickTranslationProfiles: []}, {
            quickTranslationProfiles: [null, {
                action: 'full-page', hotkey: '', service: '', model: '', targetLanguage: '',
                displayMode: 'inherit', fullPageMode: 'inherit',
            }],
        });
        const after = group(result, 'translation')?.changes[0]?.after || '';

        expect(after).toContain('未设置');
        expect(after).toContain('默认范围');
    });

    it('把任务调度的不限速和退避参数格式化为可读差异', () => {
        const result = buildConfigDiff({
            translationRequestsPerSecond: 0,
            translationRequestsPerMinute: 2,
            translationMaxRetries: 0,
            translationBackoffBaseMs: 1000,
            translationBackoffMaxMs: 30000,
        }, {
            translationRequestsPerSecond: 4,
            translationRequestsPerMinute: 0,
            translationMaxRetries: 3,
            translationBackoffBaseMs: 2000,
            translationBackoffMaxMs: 60000,
        });

        expect(group(result, 'advanced')?.changes).toEqual(expect.arrayContaining([
            {key: 'translationRequestsPerSecond', label: '每秒最多请求数', before: '不限速', after: '4 次'},
            {key: 'translationRequestsPerMinute', label: '每分钟最多请求数', before: '2 次', after: '不限速'},
            {key: 'translationMaxRetries', label: '失败后最多重试', before: '0 次', after: '3 次'},
            {key: 'translationBackoffBaseMs', label: '退避初始间隔', before: '1000 ms', after: '2000 ms'},
            {key: 'translationBackoffMaxMs', label: '退避最大间隔', before: '30000 ms', after: '60000 ms'},
        ]));
    });

    it('展开服务对象映射，只报告真正变化的服务项且忽略对象键顺序', () => {
        const unchanged = buildConfigDiff(
            {model: {openai: 'gpt-5', deepseek: 'deepseek-chat'}},
            {model: {deepseek: 'deepseek-chat', openai: 'gpt-5'}},
        );
        expect(unchanged).toEqual({changeCount: 0, groups: []});

        const changed = buildConfigDiff({
            model: {openai: 'gpt-4.1', deepseek: 'deepseek-chat'},
            requireApiKey: {openai: true},
        }, {
            model: {openai: 'gpt-5', deepseek: 'deepseek-chat'},
            requireApiKey: {openai: false},
        });
        expect(changed.changeCount).toBe(2);
        expect(group(changed, 'translationServices')?.changes).toEqual([
            {key: 'model.openai', label: 'OpenAI模型', before: 'gpt-4.1', after: 'gpt-5'},
            {key: 'requireApiKey.openai', label: 'OpenAI API Key 校验', before: '开启', after: '关闭'},
        ]);

        expect(buildConfigDiff({model: 'legacy'}, {model: {openai: 'gpt-5'}}).changeCount).toBe(1);
        expect(buildConfigDiff({model: {openai: 'gpt-5'}}, {model: 'legacy'}).changeCount).toBe(1);
    });

    it('把无碰撞 API Key 校验键显示为可读的服务和模型标签', () => {
        const key = createApiKeyRequirementKey('custom:1', 'vendor:model/latest');
        const result = buildConfigDiff(
            {requireApiKey: {[key]: true}},
            {requireApiKey: {[key]: false}},
        );

        expect(group(result, 'translationServices')?.changes[0]).toEqual({
            key: `requireApiKey.${key}`,
            label: '自定义服务 1 · vendor:model/latest API Key 校验',
            before: '开启',
            after: '关闭',
        });
        expect(group(result, 'translationServices')?.changes[0]?.label).not.toContain('v2:[');

        const defaultModelKey = createApiKeyRequirementKey('openai', '');
        const defaultModelResult = buildConfigDiff(
            {requireApiKey: {[defaultModelKey]: true}},
            {requireApiKey: {[defaultModelKey]: false}},
        );
        expect(group(defaultModelResult, 'translationServices')?.changes[0]?.label)
            .toBe('OpenAI · 默认模型 API Key 校验');
    });

    it('逐服务显示已保存自定义模型列表，而不是暴露原始对象', () => {
        const result = buildConfigDiff(
            {customModels: {grok: ['private-a']}},
            {customModels: {grok: ['private-a', 'private-b']}},
        );

        expect(group(result, 'translationServices')?.changes[0]).toEqual({
            key: 'customModels.grok',
            label: 'Grok (X.AI)自定义模型列表',
            before: 'private-a',
            after: 'private-a、private-b',
        });
    });

    it('按服务显示模型 Thinking 变化并保留具体模型', () => {
        const result = buildConfigDiff(
            {modelThinking: {openai: {'gpt-5.6-luna': false}}},
            {modelThinking: {openai: {'gpt-5.6-luna': true}}},
        );

        expect(group(result, 'translationServices')?.changes[0]).toEqual({
            key: 'modelThinking.openai',
            label: 'OpenAI模型 Thinking',
            before: 'gpt-5.6-luna：关闭',
            after: 'gpt-5.6-luna：开启',
        });
    });

    it('让自定义服务端点和模型变化在导入预览中可辨认且不泄露地址凭据', () => {
        const result = buildConfigDiff({
            service: 'custom:team',
            customOpenAIProviders: [{
                id: 'custom:team',
                name: '团队网关',
                endpoint: 'https://old.example/v1',
                models: ['model-a'],
            }],
        }, {
            service: 'custom:next',
            customOpenAIProviders: [
                {
                    id: 'custom:team',
                    name: '团队网关',
                    endpoint: 'https://user:password@new.example/v1?token=secret',
                    models: ['model-b', 'model-c'],
                },
                'legacy-invalid-item',
            ],
        });

        expect(group(result, 'general')?.changes[0]).toMatchObject({
            before: '自定义服务 team',
            after: '自定义服务 next',
        });
        const profiles = group(result, 'translationServices')?.changes[0];
        expect(profiles?.before).toContain('https://old.example/v1');
        expect(profiles?.before).toContain('model-a');
        expect(profiles?.after).toContain('敏感内容已隐藏');
        expect(profiles?.after).toContain('model-b、model-c');
        expect(profiles?.after).toContain('legacy-invalid-item');
        expect(JSON.stringify(result)).not.toContain('password@new.example');
        expect(JSON.stringify(result)).not.toContain('token=secret');
    });

    it('兼容 legacy、空列表和畸形自定义 profile 的可读预览', () => {
        const result = buildConfigDiff({
            service: 'custom',
            customOpenAIProviders: [],
        }, {
            service: 42,
            customOpenAIProviders: [{
                id: 'custom:unnamed',
                name: '',
                endpoint: '',
                models: 'legacy-model-shape',
            }],
        });

        expect(group(result, 'general')?.changes[0]).toMatchObject({
            before: '自定义接口',
            after: '42',
        });
        expect(group(result, 'translationServices')?.changes[0]).toMatchObject({
            before: '无',
            after: '未命名服务（接口：未设置；模型：无）',
        });
    });

    it('完全剔除凭据字段、疑似凭据字段和非用户配置元数据', () => {
        const result = buildConfigDiff({
            token: {openai: 'old-token'},
            ak: 'old-ak',
            sk: 'old-sk',
            appid: 'old-app',
            key: 'old-key',
            youdaoAppKey: 'old-youdao-key',
            youdaoAppSecret: 'old-youdao-secret',
            tencentSecretId: 'old-id',
            tencentSecretKey: 'old-secret',
            extra: {authorization: 'Bearer old'},
            apiToken: 'old-api-token',
            accountPassword: 'old-password',
            authorization: 'Bearer old',
            authorizationHeader: 'Bearer old-header',
            customBody: {openai: '{"Authorization":"Bearer old-body-token"}'},
            count: 1,
            persistCredentials: false,
            videoServiceDefaultMigrated: false,
            __fluentConfigRevision: 2,
        }, {
            token: {openai: 'new-token'},
            ak: 'new-ak',
            sk: 'new-sk',
            appid: 'new-app',
            key: 'new-key',
            youdaoAppKey: 'new-youdao-key',
            youdaoAppSecret: 'new-youdao-secret',
            tencentSecretId: 'new-id',
            tencentSecretKey: 'new-secret',
            extra: {authorization: 'Bearer new'},
            apiToken: 'new-api-token',
            accountPassword: 'new-password',
            authorization: 'Bearer new',
            authorizationHeader: 'Bearer new-header',
            customBody: {openai: '{"Authorization":"Bearer new-body-token"}'},
            count: 2,
            persistCredentials: true,
            videoServiceDefaultMigrated: true,
            __fluentConfigRevision: 3,
        });
        expect(result.changeCount).toBe(1);
        expect(JSON.stringify(result)).not.toContain('old-body-token');
        expect(JSON.stringify(result)).not.toContain('new-body-token');
        expect(group(result, 'translationServices')?.changes[0]).toMatchObject({
            key: 'customBody.openai',
            before: '0 个公开字段（内容已摘要）',
            after: '0 个公开字段（内容已摘要）',
        });
    });

    it('摘要长提示词和自定义请求体，并遮罩嵌套认证内容及地址凭据', () => {
        const longPrompt = '请保持术语一致。'.repeat(30);
        const result = buildConfigDiff({
            system_role: {openai: ''},
            customBody: {openai: '{"temperature":0.2,"Authorization":"Bearer old-secret"}'},
            proxy: {openai: ''},
            notes: '',
        }, {
            system_role: {openai: longPrompt},
            customBody: {openai: '{"temperature":0.8,"Authorization":"Bearer new-secret","password":"hidden"}'},
            proxy: {openai: 'https://user:password@example.com?token=secret'},
            notes: '普通说明。'.repeat(40),
        });
        const serialized = JSON.stringify(result);

        expect(serialized).not.toContain(longPrompt);
        expect(serialized).not.toContain('old-secret');
        expect(serialized).not.toContain('new-secret');
        expect(serialized).not.toContain('password@example.com');
        expect(group(result, 'translationServices')?.changes).toEqual([
            {
                key: 'customBody.openai',
                label: 'OpenAI自定义请求体',
                before: '1 个公开字段（内容已摘要）',
                after: '1 个公开字段（内容已摘要）',
            },
            {
                key: 'proxy.openai',
                label: 'OpenAI代理地址',
                before: '未设置',
                after: expect.stringContaining('敏感内容已隐藏'),
            },
            {
                key: 'system_role.openai',
                label: 'OpenAI System 提示词',
                before: '未设置',
                after: `已配置（${longPrompt.length} 字符）`,
            },
        ]);
        expect(group(result, 'other')?.changes[0]).toMatchObject({
            key: 'notes',
            before: '未设置',
            after: expect.stringMatching(/^长文本（\d+ 字符）$/u),
        });
    });

    it('脱敏后的显示摘要相同，也不会吞掉真实配置变化', () => {
        const result = buildConfigDiff(
            {customBody: {openai: '{"Authorization":"Bearer secret-a"}'}},
            {customBody: {openai: '{"Authorization":"Bearer secret-b"}'}},
        );

        expect(result.changeCount).toBe(1);
        expect(group(result, 'translationServices')?.changes[0]).toMatchObject({
            key: 'customBody.openai',
            before: '0 个公开字段（内容已摘要）',
            after: '0 个公开字段（内容已摘要）',
        });
        expect(JSON.stringify(result)).not.toContain('secret-a');
        expect(JSON.stringify(result)).not.toContain('secret-b');
    });

    it('把无效输入视为空配置，并安全处理新增、删除、空数组和循环引用', () => {
        const cyclic: Record<string, unknown> = {enabled: true};
        cyclic.self = cyclic;
        const result = buildConfigDiff(null, {
            alwaysTranslateDomains: [],
            removedLater: cyclic,
        });

        expect(result.changeCount).toBe(2);
        expect(group(result, 'siteRules')?.changes[0]).toEqual({
            key: 'alwaysTranslateDomains',
            label: '始终翻译网站',
            before: '未设置',
            after: '无',
        });
        expect(group(result, 'other')?.changes[0]?.after).toContain('循环引用');

        const removed = buildConfigDiff({theme: 'dark'}, undefined);
        expect(group(removed, 'general')?.changes[0]).toMatchObject({before: '暗色主题', after: '未设置'});
    });

    it('覆盖所有已知页面字段，并对异常旧值保持可预览而不泄露内容', () => {
        const cyclicArray: unknown[] = [];
        cyclicArray.push(cyclicArray);
        const result = buildConfigDiff({
            on: undefined,
            from: 'auto',
            to: 'zh-Hans',
            theme: 'auto',
            display: 1,
            style: 1,
            contextMenuEnabled: true,
            fullPageTranslationMode: 'viewport',
            disableFloatingBall: true,
            floatingBallPosition: 'right',
            floatingBallHotkey: 'Alt+T',
            customFloatingBallHotkey: '',
            translationProgressPanelEnabled: false,
            service: 'microsoft',
            model: 'legacy-invalid-model-map',
            customModel: {},
            requireApiKey: {},
            minimaxBillingPlan: 'payg',
            minimaxRegion: 'cn',
            mimoBillingPlan: 'payg',
            mimoRegion: 'cn',
            customBody: {},
            proxy: {},
            custom: '',
            deeplx: '',
            newApiUrl: '',
            azureOpenaiEndpoint: '',
            system_role: {},
            user_role: {},
            deepseekApiType: 'auto',
            deepseekThinkingMode: 'disabled',
            hotkey: 'Control',
            customHotkey: '',
            mouseHoverTranslationDelay: undefined,
            disableSelectionTranslator: true,
            selectionTranslatorMode: 'disabled',
            selectionTranslatorTrigger: 'icon',
            selectionTranslatorHotkey: 'Control',
            customSelectionTranslatorHotkey: '',
            selectionTranslatorDelay: 300,
            selectionTtsVoices: [],
            inputBoxTranslationTrigger: 'disabled',
            inputBoxTranslationTarget: 'en',
            autoTranslate: false,
            alwaysTranslateDomains: [],
            disabledExtensionDomains: [],
            disableImageTranslator: true,
            selectionAreaEnabled: false,
            videoTranslationEnabled: false,
            videoService: 'microsoft',
            videoSubtitleVisible: true,
            videoSubtitleDisplayMode: 'bilingual',
            videoSubtitleFontSize: 100,
            useCache: true,
            enableAIContext: false,
            maxConcurrentTranslations: 6,
            animations: true,
            documentService: 'microsoft',
            documentModel: {},
            documentCustomModel: {},
            translationCenterServices: 'microsoft',
            translationCenterSourceLanguage: '',
            translationCenterTargetLanguage: '',
            vocabularyBookEnabled: false,
            oddValue: false,
            blankValue: 'visible',
        }, {
            on: 'legacy-enabled',
            from: 'en',
            to: 'ja',
            theme: 'sepia',
            display: 0,
            style: 23,
            contextMenuEnabled: false,
            fullPageTranslationMode: 'all',
            disableFloatingBall: false,
            floatingBallPosition: 'left',
            floatingBallHotkey: 'F9',
            customFloatingBallHotkey: 'Meta+T',
            translationProgressPanelEnabled: true,
            service: 'openai',
            model: 'another-invalid-model-map',
            customModel: {openai: 'my-model', unlistedProvider: 'future-model'},
            requireApiKey: {openai: false},
            minimaxBillingPlan: 'token-plan',
            minimaxRegion: 'global',
            mimoBillingPlan: 'token-plan',
            mimoRegion: 'sgp',
            customBody: {
                openai: '[1,2,3]',
                deepseek: '{not-json',
                custom: 42,
                grok: 'token=hidden',
            },
            proxy: {openai: 'https://proxy.example.com'},
            custom: 'https://custom.example.com',
            deeplx: 'https://deeplx.example.com',
            newApiUrl: 'https://new-api.example.com',
            azureOpenaiEndpoint: 'https://example.openai.azure.com/chat/completions',
            system_role: {openai: 42, deepseek: 'short prompt'},
            user_role: {openai: 'authorization: Bearer hidden'},
            deepseekApiType: 'responses',
            deepseekThinkingMode: 'enabled',
            hotkey: 'Alt',
            customHotkey: 'Meta+H',
            mouseHoverTranslationDelay: 'fast',
            disableSelectionTranslator: false,
            selectionTranslatorMode: 'translation-only',
            selectionTranslatorTrigger: 'dot',
            selectionTranslatorHotkey: 'Shift',
            customSelectionTranslatorHotkey: 'Meta+S',
            selectionTranslatorDelay: 450,
            selectionTtsVoices: ['a', 'b', 'c', 'd', 'e'],
            inputBoxTranslationTrigger: 'triple_space',
            inputBoxTranslationTarget: 'de',
            autoTranslate: true,
            alwaysTranslateDomains: ['a.example'],
            disabledExtensionDomains: ['b.example'],
            disableImageTranslator: false,
            selectionAreaEnabled: true,
            videoTranslationEnabled: true,
            videoService: 'deepseek',
            videoSubtitleVisible: false,
            videoSubtitleDisplayMode: 'original-only',
            videoSubtitleFontSize: 'large',
            useCache: false,
            enableAIContext: true,
            maxConcurrentTranslations: 8,
            animations: false,
            documentService: 'openai',
            documentModel: {openai: 'gpt-5'},
            documentCustomModel: {openai: 'document-model'},
            translationCenterServices: ['openai'],
            translationCenterSourceLanguage: 'en',
            translationCenterTargetLanguage: 'ja',
            vocabularyBookEnabled: true,
            manyItems: ['a', 'b', 'c', 'd', 'e'],
            manyValues: {openai: 'model', one: 1, two: 2, three: 3, four: 4},
            emptyPublicMap: {password: 'hidden'},
            invalidNumber: Number.NaN,
            oddValue: () => 'legacy',
            blankValue: '   ',
            '---': cyclicArray,
        });

        expect(result.changeCount).toBeGreaterThan(60);
        expect(JSON.stringify(result)).not.toContain('Bearer hidden');
        expect(group(result, 'translationServices')?.changes).toEqual(expect.arrayContaining([
            expect.objectContaining({key: 'model', before: 'legacy-invalid-model-map', after: 'another-invalid-model-map'}),
            expect.objectContaining({key: 'customBody.openai', after: '3 项 JSON（内容已摘要）'}),
            expect.objectContaining({key: 'customBody.deepseek', after: '文本请求体（9 字符，内容已摘要）'}),
            expect.objectContaining({key: 'customBody.custom', after: '已配置（内容已摘要）'}),
            expect.objectContaining({key: 'system_role.openai', after: '42'}),
        ]));
        expect(group(result, 'translation')?.changes).toEqual(expect.arrayContaining([
            expect.objectContaining({key: 'mouseHoverTranslationDelay', after: 'fast'}),
            expect.objectContaining({key: 'selectionTtsVoices', after: '5 项：a、b、c、d 等'}),
        ]));
        expect(group(result, 'other')?.changes).toEqual(expect.arrayContaining([
            expect.objectContaining({key: 'manyValues', after: expect.stringContaining('5 项：')}),
            expect.objectContaining({key: 'emptyPublicMap', after: '无'}),
            expect.objectContaining({key: 'invalidNumber', after: '未设置'}),
            expect.objectContaining({key: '---', label: '---', after: expect.stringContaining('循环引用')}),
        ]));
    });
});
