import {describe, expect, it} from 'vitest';
import {Config} from '@/src/core/config/model';
import {createGlossaryLibrary} from '@/src/core/glossary';
import {getVideoTranslationConfigFingerprint, isIncrementalVideoCaption, normalizeVideoCaptionText, revealVideoSubtitleTranslation, translateVideoSubtitleCues} from '@/src/features/video-subtitle/content/subtitleLogic';

describe('video subtitle logic', () => {
  it('原语言、字幕词库选择与术语修改均使旧字幕翻译失效', () => {
    const config = new Config();
    config.glossaryEnabled = true;
    config.glossaryLibraries = [{...createGlossaryLibrary([]), id: 'technical', entries: [
      {id: 'agent', source: 'agent', target: '智能体', caseSensitive: false},
    ]}];
    const initial = getVideoTranslationConfigFingerprint(config);
    config.videoSourceLanguage = 'ko';
    const languageChanged = getVideoTranslationConfigFingerprint(config);
    expect(languageChanged).not.toBe(initial);
    config.videoGlossaryIds = ['technical'];
    const selectionChanged = getVideoTranslationConfigFingerprint(config);
    expect(selectionChanged).not.toBe(languageChanged);
    config.glossaryLibraries[0].entries[0].target = '代理';
    const terminologyChanged = getVideoTranslationConfigFingerprint(config);
    expect(terminologyChanged).not.toBe(selectionChanged);
    config.glossaryEnabled = false;
    expect(getVideoTranslationConfigFingerprint(config)).not.toBe(terminologyChanged);
  });
  it('批译去重、保序、进度和并发配置', async () => {
    const progress: number[] = []; const cues = [{startMs: 0, durationMs: 1, text: ' a '}, {startMs: 1, durationMs: 1, text: 'a'}, {startMs: 2, durationMs: 1, text: 'b'}];
    await expect(translateVideoSubtitleCues(cues, async text => `译-${text.trim()}`, {concurrency: 2, onProgress: n => progress.push(n)})).resolves.toEqual([{...cues[0], text: '译-a'}, {...cues[1], text: '译-a'}, {...cues[2], text: '译-b'}]);
    expect(progress).toEqual([0, 1, 2]);
  });

  it('空时间轴直接返回，空白 cue 保留原文', async () => {
    await expect(translateVideoSubtitleCues([], async text => text)).resolves.toEqual([]);
    const cues = [{startMs: 0, durationMs: 1, text: 'a'}, {startMs: 1, durationMs: 1, text: '   '}];
    await expect(translateVideoSubtitleCues(cues, async text => `译-${text}`)).resolves.toEqual([
      {...cues[0], text: '译-a'},
      cues[1],
    ]);
  });
  it('拒绝空译文、支持 abort、配置指纹包含动态 providers/thinking', async () => {
    await expect(translateVideoSubtitleCues([{startMs: 0, durationMs: 1, text: 'x'}], async () => '', {})).rejects.toThrow('为空');
    const controller = new AbortController(); controller.abort();
    await expect(translateVideoSubtitleCues([], async x => x, {signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'});
    expect(normalizeVideoCaptionText('  a\n b ')).toBe('a b');
    expect(isIncrementalVideoCaption('hello', 'hello world')).toBe(true);
    expect(isIncrementalVideoCaption('world', 'hello world')).toBe(false);
    expect(revealVideoSubtitleTranslation('你好世界', '你', '你好世界')).toBe('你');
    const one = new Config(); const two = new Config(); two.customOpenAIProviders = [{id: 'custom:x', name: 'x', endpoint: 'https://x', models: ['m']}];
    expect(getVideoTranslationConfigFingerprint(one)).not.toBe(getVideoTranslationConfigFingerprint(two));
  });

  it('非字符串译文与未提供 failure 时使用公开错误回退', async () => {
    await expect(translateVideoSubtitleCues([{startMs: 0, durationMs: 1, text: 'x'}], async () => 1 as unknown as string))
      .rejects.toThrow('为空');
    await expect(translateVideoSubtitleCues([{startMs: 0, durationMs: 1, text: 'x'}], async () => { throw undefined; }))
      .rejects.toThrow('字幕翻译失败');
  });
  it('批译中途 abort 时拒绝且不写回部分结果', async () => {
    const controller = new AbortController();
    const pending = translateVideoSubtitleCues([{startMs: 0, durationMs: 1, text: 'x'}, {startMs: 1, durationMs: 1, text: 'y'}], async () => new Promise<string>(resolve => setTimeout(() => resolve('ok'), 20)), {signal: controller.signal});
    controller.abort();
    await expect(pending).rejects.toMatchObject({name: 'AbortError'});
  });
  it('worker 在取下一项前观察到 abort', async () => {
    const controller = new AbortController();
    await expect(translateVideoSubtitleCues([{startMs: 0, durationMs: 1, text: 'x'}, {startMs: 1, durationMs: 1, text: 'y'}, {startMs: 2, durationMs: 1, text: 'z'}], async () => { controller.abort(); return 'ok'; }, {concurrency: 2, signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'});
  });
  it('覆盖渐进显示的空值、相等、非前缀和 Unicode 边界', () => {
    expect(isIncrementalVideoCaption('', 'hello')).toBe(false);
    expect(isIncrementalVideoCaption('hello', 'hello')).toBe(false);
    expect(isIncrementalVideoCaption('HEL', 'hello')).toBe(true);
    expect(revealVideoSubtitleTranslation('', 'a', 'abc')).toBe('');
    expect(revealVideoSubtitleTranslation('译文', '', 'abc')).toBe('译文');
    expect(revealVideoSubtitleTranslation('译文', 'abc', 'abc')).toBe('译文');
    expect(revealVideoSubtitleTranslation('译文', 'x', 'abc')).toBe('译文');
    expect(revealVideoSubtitleTranslation('你好世界', '你', '你好世界')).toBe('你');
  });

  it('配置指纹覆盖各服务端点与可选角色', () => {
    const cases = [
      {service: 'microsoft', mutate: (config: Config) => { config.proxy.microsoft = 'https://proxy.example'; }},
      {service: 'custom', mutate: (config: Config) => { config.custom = 'https://custom.example'; }},
      {service: 'newapi', mutate: (config: Config) => { config.newApiUrl = 'https://newapi.example'; }},
      {service: 'deeplx', mutate: (config: Config) => { config.deeplx = 'https://deeplx.example'; }},
      {service: 'azureOpenai', mutate: (config: Config) => {
        config.azureOpenaiEndpoint = 'https://azure.example';
        config.system_role.azureOpenai = '';
        config.user_role.azureOpenai = '';
      }},
    ];
    for (const entry of cases) {
      const config = new Config();
      config.videoService = entry.service;
      entry.mutate(config);
      expect(getVideoTranslationConfigFingerprint(config)).toContain(entry.service);
    }
  });
});
