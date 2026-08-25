import {describe, expect, it, vi} from 'vitest';
import {
    detectChromeLanguage,
    detectLanguageByScript,
    friendlyChromeTranslationError,
    isChromeTranslationSupported,
    mapChromeLanguageCode,
    parseChromeTranslationRequest,
    parseLanguageCode,
    performChromeTranslation,
    translateWithChromeApi,
    type ChromeTranslationEnvironment,
} from '@/src/app/offscreen/translation';

function modernTranslator(translator: Record<string, unknown>): ChromeTranslationEnvironment {
    return {translation: {createTranslator: vi.fn(async () => translator)}} as ChromeTranslationEnvironment;
}

describe('Offscreen Chrome 翻译域', () => {
    it('严格解析文本与语言对，并拒绝 null、数组和非法语言', () => {
        expect(parseChromeTranslationRequest({text: ' hello ', from: ' auto ', to: ' zh-Hans '}))
            .toEqual({text: ' hello ', from: 'auto', to: 'zh-Hans'});
        expect(() => parseChromeTranslationRequest(null)).toThrow('data 必须是对象');
        expect(() => parseChromeTranslationRequest([])).toThrow('data 必须是对象');
        expect(() => parseChromeTranslationRequest({text: 1, from: 'en', to: 'ja'})).toThrow('文本必须是字符串');
        expect(() => parseChromeTranslationRequest({text: 'x', from: 1, to: 'ja'})).toThrow('from 必须是语言代码');
        expect(() => parseChromeTranslationRequest({text: 'x', from: 'bad!', to: 'ja'})).toThrow('from 语言代码无效');
        expect(() => parseChromeTranslationRequest({text: 'x', from: 'en', to: ''})).toThrow('to 语言代码无效');
        expect(() => parseChromeTranslationRequest({text: 'x', from: 'en', to: 'auto'})).toThrow('to 语言代码无效');
        expect(parseLanguageCode(' EN-us ', 'from', false)).toBe('EN-us');
    });

    it('映射 Chrome 语言代码并识别新旧 Translation API', () => {
        expect(mapChromeLanguageCode('zh-Hans')).toBe('zh');
        expect(mapChromeLanguageCode('zh-Hant')).toBe('zh-TW');
        expect(mapChromeLanguageCode('eo')).toBe('eo');
        expect(isChromeTranslationSupported({translation: {createTranslator: vi.fn()}})).toBe(true);
        expect(isChromeTranslationSupported({Translator: {create: vi.fn()}})).toBe(true);
        expect(isChromeTranslationSupported({translation: {}})).toBe(false);
    });

    it('脚本兜底按中日韩及拉丁文本确定源语言', () => {
        expect(detectLanguageByScript('中文')).toBe('zh');
        expect(detectLanguageByScript('かな')).toBe('ja');
        expect(detectLanguageByScript('한글')).toBe('ko');
        expect(detectLanguageByScript('English')).toBe('en');
    });

    it('优先使用新检测器并释放模型', async () => {
        const destroy = vi.fn();
        const detect = vi.fn(async () => [{detectedLanguage: ' fr '}]);
        const environment = {translation: {createDetector: vi.fn(async () => ({detect, destroy}))}};

        await expect(detectChromeLanguage('bonjour', environment)).resolves.toBe('fr');
        expect(detect).toHaveBeenCalledWith('bonjour');
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('旧检测器的空或畸形结果回退脚本检测，清理异常不覆盖结果', async () => {
        const results: unknown[] = [
            [],
            null,
            [null],
            [{}],
            [{detectedLanguage: ' '}],
            [{detectedLanguage: 'bad!'}],
        ];
        for (const result of results) {
            const destroy = vi.fn(() => { throw new Error('cleanup failed'); });
            const environment = {
                LanguageDetector: {create: vi.fn(async () => ({detect: vi.fn(async () => result), destroy}))},
            };
            await expect(detectChromeLanguage('かな', environment)).resolves.toBe('ja');
            expect(destroy).toHaveBeenCalledOnce();
        }
    });

    it('检测器创建或检测失败以及无检测器时均回退脚本规则', async () => {
        await expect(detectChromeLanguage('中文', {
            translation: {createDetector: vi.fn(async () => { throw new Error('not ready'); })},
        })).resolves.toBe('zh');
        const destroy = vi.fn();
        await expect(detectChromeLanguage('한글', {
            translation: {createDetector: vi.fn(async () => ({
                detect: vi.fn(async () => { throw new Error('detect failed'); }),
                destroy,
            }))},
        })).resolves.toBe('ko');
        expect(destroy).toHaveBeenCalledOnce();
        await expect(detectChromeLanguage('plain', {})).resolves.toBe('en');
    });

    it('串接流式翻译并始终释放 translator', async () => {
        const destroy = vi.fn();
        const translateStreaming = vi.fn(async function* () {
            yield '你';
            yield '好';
        });
        const environment = modernTranslator({translateStreaming, destroy});

        await expect(performChromeTranslation('hello', 'en', 'zh', environment)).resolves.toBe('你好');
        expect(translateStreaming).toHaveBeenCalledWith('hello');
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('拒绝无效流式块、普通结果和缺失翻译方法，并兼容旧 API', async () => {
        await expect(performChromeTranslation('x', 'en', 'ja', {})).rejects.toThrow('没有可用的翻译 API');
        await expect(performChromeTranslation('x', 'en', 'ja', modernTranslator({
            translateStreaming: async function* () { yield 1; },
        }))).rejects.toThrow('无效的流式结果');
        await expect(performChromeTranslation('x', 'en', 'ja', modernTranslator({
            translate: vi.fn(async () => null),
        }))).rejects.toThrow('无效结果');
        await expect(performChromeTranslation('x', 'en', 'ja', modernTranslator({})))
            .rejects.toThrow('不支持翻译方法');

        const destroy = vi.fn(() => { throw new Error('ignored cleanup'); });
        const create = vi.fn(async () => ({translate: vi.fn(async () => '旧译文'), destroy}));
        await expect(performChromeTranslation('x', 'en', 'ja', {Translator: {create}}))
            .resolves.toBe('旧译文');
        expect(create).toHaveBeenCalledWith({sourceLanguage: 'en', targetLanguage: 'ja'});
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('把实验 API 错误映射成可操作提示', () => {
        expect(friendlyChromeTranslationError(new Error('model not available'), 'en', 'ja').message)
            .toContain('暂时不可用');
        expect(friendlyChromeTranslationError(new Error('language not supported'), 'en', 'xx').message)
            .toContain('en -> xx');
        expect(friendlyChromeTranslationError(new Error('model download failed'), 'en', 'ja').message)
            .toContain('模型未就绪');
        expect(friendlyChromeTranslationError('plain failure', 'en', 'ja').message).toBe('翻译失败：plain failure');
        expect(friendlyChromeTranslationError(null, 'en', 'ja').message).toBe('翻译失败：未知错误');
    });

    it('空白与同语言请求不创建 translator，auto 检测和语言映射进入真实请求', async () => {
        const createTranslator = vi.fn(async () => ({translate: vi.fn(async () => '译文')}));
        const environment = {translation: {
            createDetector: vi.fn(async () => ({detect: vi.fn(async () => [{detectedLanguage: 'en'}])})),
            createTranslator,
        }};

        await expect(translateWithChromeApi({text: '   ', from: 'auto', to: 'ja'}, environment)).resolves.toBe('');
        await expect(translateWithChromeApi({text: '中文', from: 'zh-Hans', to: 'zh'}, environment)).resolves.toBe('中文');
        await expect(translateWithChromeApi({text: 'hello', from: 'auto', to: 'zh-Hant'}, environment)).resolves.toBe('译文');
        expect(createTranslator).toHaveBeenCalledOnce();
        expect(createTranslator).toHaveBeenCalledWith({sourceLanguage: 'en', targetLanguage: 'zh-TW'});
    });

    it('明确报告不支持环境并格式化 translator 创建失败', async () => {
        await expect(translateWithChromeApi({text: 'x', from: 'en', to: 'ja'}, {}))
            .rejects.toThrow('当前浏览器不支持');
        await expect(translateWithChromeApi({text: 'x', from: 'en', to: 'ja'}, {
            translation: {createTranslator: vi.fn(async () => { throw new Error('not ready'); })},
        })).rejects.toThrow('暂时不可用');
        await expect(translateWithChromeApi({text: 'x', from: 'en', to: 'ja'}, {
            translation: {createTranslator: vi.fn(async () => { throw 'boom'; })},
        })).rejects.toThrow('翻译失败：boom');
    });
});
