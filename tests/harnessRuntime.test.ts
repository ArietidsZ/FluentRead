import {beforeEach, describe, expect, it, vi} from 'vitest';

const {generateText, createModel, normalizeError} = vi.hoisted(() => ({
    generateText: vi.fn(), createModel: vi.fn(() => ({})), normalizeError: vi.fn((error: unknown) => error instanceof Error ? error : new Error(String(error))),
}));
vi.mock('ai', () => ({generateText, tool: (definition: unknown) => definition}));
vi.mock('@/src/services/harness/modelGateway', () => ({createHarnessLanguageModel: createModel, normalizeHarnessModelError: normalizeError}));

import {Config} from '@/src/core/config/model';
import {createApiKeyRequirementKey} from '@/src/core/config/validation';
import {createHarnessRuntime} from '@/src/services/harness/runtime';

function config(): Config {
    const current = new Config();
    current.on = true;
    current.harness = {...current.harness, enabled: true, service: 'openai', model: 'reader', contextMode: 'paragraph'};
    current.token.openai = 'secret';
    return current;
}

describe('Harness runtime', () => {
    beforeEach(() => {
        generateText.mockReset();
        createModel.mockClear();
        normalizeError.mockClear();
    });
    it('keeps history as real turns and exposes paragraph only through read_context', async () => {
        generateText.mockResolvedValueOnce({text: 'answer', toolCalls: [], response: {messages: [{role: 'assistant', content: 'answer'}]}});
        const current = config();
        const result = await createHarnessRuntime(() => current as Config).run({type: 'fluentReadHarness', action: 'run', requestId: 'r', intent: 'meaning', question: 'why?', selection: {text: 'selected', context: 'paragraph', sentence: 'whole sentence'}, history: [{question: 'old?', answer: 'old!'}]}, new AbortController().signal);
        expect(result.success).toBe(true);
        const call = generateText.mock.calls[0][0];
        expect(call.messages.map((message: {role: string}) => message.role)).toEqual(['user', 'assistant', 'user']);
        expect(call.messages.map((message: {content: unknown}) => JSON.stringify(message.content)).join(' ')).not.toContain('whole sentence');
        expect(call.messages.map((message: {content: unknown}) => JSON.stringify(message.content)).join(' ')).not.toContain('paragraph');
        expect(call.tools).toHaveProperty('read_context');
    });

    it('falls back to generated text when the provider omits assistant content', async () => {
        generateText.mockResolvedValueOnce({text: 'fallback', toolCalls: [], response: {messages: [{role: 'assistant'}]}});
        const result = await createHarnessRuntime(config).run({type: 'fluentReadHarness', action: 'run', requestId: 'fallback', intent: 'meaning', question: '', selection: {text: 'x', context: '', sentence: ''}}, new AbortController().signal);
        expect(result).toMatchObject({success: true, text: 'fallback'});
    });

    it('omits the context tool in selection mode and clones config before generation', async () => {
        generateText.mockResolvedValueOnce({text: 'ok', toolCalls: [], response: {messages: [{role: 'assistant', content: 'ok'}]}});
        const current = config();
        current.harness.contextMode = 'selection';
        const result = await createHarnessRuntime(() => current as Config).run({type: 'fluentReadHarness', action: 'run', requestId: 'r', intent: 'meaning', question: '', selection: {text: 'x', context: 'private paragraph', sentence: ''}, history: []}, new AbortController().signal);
        expect(result.success).toBe(true);
        expect(generateText.mock.calls.at(-1)?.[0].tools).toEqual({});
        current.harness.model = 'changed-after-start';
        expect(createModel).toHaveBeenCalledWith(expect.anything(), 'openai', 'reader');
    });

    it('returns clear disabled and normalized provider errors', async () => {
        const disabled = config();
        disabled.harness.enabled = false;
        const disabledResult = await createHarnessRuntime(() => disabled).run({type: 'fluentReadHarness', action: 'run', requestId: 'r', intent: 'meaning', question: '', selection: {text: 'x', context: '', sentence: ''}, history: []}, new AbortController().signal);
        expect(disabledResult).toEqual({success: false, error: '阅读助手已停用'});
        generateText.mockRejectedValueOnce(new Error('provider failed')); normalizeError.mockReturnValueOnce(new Error('clean error'));
        const failed = await createHarnessRuntime(config).run({type: 'fluentReadHarness', action: 'run', requestId: 'r', intent: 'meaning', question: '', selection: {text: 'x', context: '', sentence: ''}, history: []}, new AbortController().signal);
        expect(failed).toEqual({success: false, error: 'clean error'});
        expect(normalizeError).toHaveBeenCalledWith(expect.any(Error), 'openai', 'secret');
    });

    it('validates read_context calls and returns only the approved paragraph', async () => {
        generateText.mockResolvedValueOnce({text: '', toolCalls: [{toolCallId: 't', toolName: 'read_context', input: {reason: 'ok'}}], response: {messages: [{role: 'assistant', content: [{type: 'tool-call', toolCallId: 't', toolName: 'read_context', input: {reason: 'ok'}}]}]}})
            .mockResolvedValueOnce({text: 'with context', toolCalls: [], response: {messages: [{role: 'assistant', content: 'with context'}]}});
        const current = config();
        const success = await createHarnessRuntime(() => current as Config).run({type: 'fluentReadHarness', action: 'run', requestId: 'r', intent: 'meaning', question: '', selection: {text: 'x', context: 'approved', sentence: ''}, history: []}, new AbortController().signal);
        expect(success.success).toBe(true);
        const second = generateText.mock.calls.at(-1)?.[0].messages.at(-1);
        expect(JSON.stringify(second)).toContain('approved');
        generateText.mockReset().mockResolvedValueOnce({text: '', toolCalls: [{toolCallId: 't', toolName: 'read_context', input: {reason: 5}}], response: {messages: [{role: 'assistant', content: [{type: 'tool-call', toolCallId: 't', toolName: 'read_context', input: {reason: 5}}]}]}});
        const invalid = await createHarnessRuntime(() => current as Config).run({type: 'fluentReadHarness', action: 'run', requestId: 'r2', intent: 'meaning', question: '', selection: {text: 'x', context: 'approved', sentence: ''}, history: []}, new AbortController().signal);
        expect(invalid).toEqual({success: false, error: 'read_context 工具参数无效'});
    });

    it('inherits configured service/model, uses target language in system prompt, and rejects non-AI defaults', async () => {
        const current = config();
        current.to = 'ja';
        current.harness.service = '';
        current.harness.model = '';
        current.service = 'openai';
        current.model.openai = 'inherited-model';
        generateText.mockResolvedValueOnce({text: 'ok', toolCalls: [], response: {messages: [{role: 'assistant', content: 'ok'}]}});
        const success = await createHarnessRuntime(() => current as Config).run({type: 'fluentReadHarness', action: 'run', requestId: 'r', intent: 'grammar', question: '', selection: {text: 'x', context: '', sentence: ''}, history: []}, new AbortController().signal);
        expect(success).toMatchObject({success: true, service: 'openai', model: 'inherited-model'});
        expect(generateText.mock.calls[0][0].system).toContain('ja');
        const nonAi = config();
        nonAi.harness.service = 'google';
        const rejected = await createHarnessRuntime(() => nonAi).run({type: 'fluentReadHarness', action: 'run', requestId: 'r2', intent: 'meaning', question: '', selection: {text: 'x', context: '', sentence: ''}, history: []}, new AbortController().signal);
        expect(rejected).toEqual({success: false, error: expect.stringContaining('不支持')});
    });

    it('allows keyless custom service when its credential requirement is disabled', async () => {
        const current = config();
        current.customOpenAIProviders = [{id: 'custom:local', name: 'Local', endpoint: 'http://localhost:11434/v1/chat/completions', models: ['reader']}];
        current.harness.service = 'custom:local';
        current.harness.model = 'reader';
        current.model['custom:local'] = 'reader';
        current.requireApiKey[createApiKeyRequirementKey('custom:local', 'reader')] = false;
        generateText.mockResolvedValueOnce({text: 'local', toolCalls: [], response: {messages: [{role: 'assistant', content: 'local'}]}});
        await expect(createHarnessRuntime(() => current as Config).run({type: 'fluentReadHarness', action: 'run', requestId: 'r', intent: 'meaning', question: '', selection: {text: 'x', context: '', sentence: ''}, history: []}, new AbortController().signal)).resolves.toMatchObject({success: true, service: 'custom:local'});
    });

    it('keeps a real follow-up role and isolates a config snapshot across an async generation', async () => {
        const current = config();
        let release!: () => void;
        generateText.mockImplementationOnce(async (input: {system: string; messages: {role: string}[]}) => {
            expect(input.messages.map((message: {role: string}) => message.role)).toEqual(['user', 'assistant', 'user']);
            current.harness.model = 'mutated-after-snapshot';
            await new Promise<void>(resolve => { release = resolve; });
            return {text: 'follow-up', toolCalls: [], response: {messages: [{role: 'assistant', content: 'follow-up'}]}};
        });
        const pending = createHarnessRuntime(() => current as Config).run({type: 'fluentReadHarness', action: 'run', requestId: 'r', intent: 'meaning', question: 'new?', selection: {text: 'x', context: '', sentence: ''}, history: [{question: 'old?', answer: 'old!'}]}, new AbortController().signal);
        release();
        await expect(pending).resolves.toMatchObject({success: true, model: 'reader'});
    });

    it('returns cancellation for a noncooperative generator and timeout errors separately', async () => {
        const controller = new AbortController();
        generateText.mockImplementation(() => new Promise(() => undefined));
        const pending = createHarnessRuntime(config).run({type: 'fluentReadHarness', action: 'run', requestId: 'cancel', intent: 'meaning', question: '', selection: {text: 'x', context: '', sentence: ''}, history: []}, controller.signal);
        controller.abort();
        await expect(pending).resolves.toEqual({success: false, error: '阅读助手请求已取消', cancelled: true});
    });

    it('accepts omitted history and reports a timeout through the normalized error path', async () => {
        generateText.mockRejectedValueOnce(new Error('阅读助手请求超时'));
        normalizeError.mockReturnValueOnce(new Error('normalized timeout'));
        const result = await createHarnessRuntime(config).run({type: 'fluentReadHarness', action: 'run', requestId: 'timeout', intent: 'meaning', question: '', selection: {text: 'x', context: '', sentence: ''}}, new AbortController().signal);
        expect(result).toEqual({success: false, error: 'normalized timeout'});
        expect(normalizeError).toHaveBeenCalled();
    });

    it('covers rejected requests before model creation', async () => {
        const base = config();
        const cases = [
            [{...base, on: false}, {text: 'x'}, '阅读助手已停用'],
            [{...base, harness: {...base.harness, actions: []}}, {text: 'x'}, '当前动作未启用'],
            [base, {text: ''}, '没有可理解'],
            [{...base, harness: {...base.harness, model: ''}, model: {...base.model, openai: ''}}, {text: 'x'}, '选择阅读理解模型'],
        ] as const;
        for (const [current, selection, message] of cases) {
            const result = await createHarnessRuntime(() => current as Config).run({type: 'fluentReadHarness', action: 'run', requestId: 'pre', intent: 'meaning', question: 5 as never, selection: selection as never, history: 'bad' as never}, new AbortController().signal);
            expect(result).toMatchObject({success: false, error: expect.stringContaining(message)});
        }
        const aborted = new AbortController();
        aborted.abort();
        await expect(createHarnessRuntime(config).run({type: 'fluentReadHarness', action: 'run', requestId: 'abort', intent: 'meaning', question: '', selection: {text: 'x', context: '', sentence: ''}, history: []}, aborted.signal)).resolves.toMatchObject({cancelled: true});
    });

    it('rejects missing credentials and trims malformed history turns', async () => {
        const current = config();
        current.token.openai = '';
        const missing = await createHarnessRuntime(() => current as Config).run({type: 'fluentReadHarness', action: 'run', requestId: 'missing', intent: 'meaning', question: '', selection: {text: 'x', context: '', sentence: ''}, history: []}, new AbortController().signal);
        expect(missing).toMatchObject({success: false, error: expect.stringContaining('API Key')});
        generateText.mockResolvedValueOnce({text: 'ok', toolCalls: [], response: {messages: [{role: 'assistant', content: 'ok'}]}});
        const ready = await createHarnessRuntime(() => config()).run({type: 'fluentReadHarness', action: 'run', requestId: 'history', intent: 'meaning', question: '', selection: {text: 'x', context: '', sentence: ''}, history: [{question: '', answer: 'bad'}, {question: 'q', answer: ''}]}, new AbortController().signal);
        expect(ready.success).toBe(true);
    });
    it('records every model step with real response model and isolates statistics failures', async () => {
        const request = {type: 'fluentReadHarness', action: 'run', requestId: 'usage', intent: 'meaning', question: '', selection: {text: 'selected', context: 'paragraph', sentence: ''}} as const;
        const record = vi.fn();
        const makeSink = vi.fn(() => record);
        generateText.mockResolvedValueOnce({text: '', usage: {inputTokens: 10, outputTokens: 2, totalTokens: 12}, toolCalls: [{toolCallId: 'u1', toolName: 'read_context', input: {}}], response: {modelId: 'actual-reader', messages: [{role: 'assistant', content: [{type: 'tool-call', toolCallId: 'u1', toolName: 'read_context', input: {}}]}]}})
            .mockResolvedValueOnce({text: 'understood', usage: {inputTokens: 20, outputTokens: 5, totalTokens: 25}, toolCalls: [], response: {modelId: 'actual-reader', messages: [{role: 'assistant', content: [{type: 'text', text: 'understood'}]}]}});
        await expect(createHarnessRuntime(config, makeSink).run(request, new AbortController().signal)).resolves.toMatchObject({success: true});
        expect(makeSink).toHaveBeenCalledOnce();
        expect(record).toHaveBeenCalledTimes(2);
        expect(record.mock.calls.map(([event]) => event.totalTokens)).toEqual([12, 25]);
        expect(record.mock.calls[0][0]).toMatchObject({purpose: 'reading', configuredModel: 'reader', actualModel: 'actual-reader', outcome: 'success'});
        expect(JSON.stringify(record.mock.calls)).not.toContain('selected');
        record.mockImplementation(() => { throw new Error('statistics unavailable'); });
        generateText.mockResolvedValueOnce({text: 'still readable', toolCalls: [], response: {messages: []}});
        await expect(createHarnessRuntime(config, makeSink).run(request, new AbortController().signal)).resolves.toMatchObject({success: true, text: 'still readable'});
    });

    it('classifies rejected model attempts as error, cancellation or timeout without inventing tokens', async () => {
        const request = {type: 'fluentReadHarness', action: 'run', requestId: 'usage-error', intent: 'meaning', question: '', selection: {text: 'x', context: '', sentence: ''}} as const;
        const record = vi.fn();
        generateText.mockRejectedValueOnce(new Error('network failed'));
        await createHarnessRuntime(config, () => record).run(request, new AbortController().signal);
        expect(record.mock.lastCall?.[0]).toMatchObject({outcome: 'error', usageAvailability: 'unreported'});
        const cooperative = (input: {abortSignal: AbortSignal}) => new Promise((_, reject) => input.abortSignal.addEventListener('abort', () => reject(input.abortSignal.reason), {once: true}));
        generateText.mockImplementation(cooperative);
        const controller = new AbortController();
        const pending = createHarnessRuntime(config, () => record).run(request, controller.signal);
        controller.abort('user closed card');
        await expect(pending).resolves.toMatchObject({cancelled: true});
        expect(record.mock.lastCall?.[0]).toMatchObject({outcome: 'cancelled', usageAvailability: 'unreported'});
        const second = new AbortController();
        const secondPending = createHarnessRuntime(config, () => record).run(request, second.signal);
        second.abort();
        await secondPending;
        expect(record.mock.lastCall?.[0].outcome).toBe('cancelled');
        vi.useFakeTimers();
        try {
            const timeout = createHarnessRuntime(config, () => record).run(request, new AbortController().signal);
            await vi.advanceTimersByTimeAsync(40_000);
            await expect(timeout).resolves.toMatchObject({success: false, error: expect.stringContaining('超时')});
            expect(record.mock.lastCall?.[0]).toMatchObject({outcome: 'timeout', usageAvailability: 'unreported'});
        } finally { vi.useRealTimers(); }
    });

    it('normalizes errors for keyless services without requiring a token entry', async () => {
        const current = config();
        current.customOpenAIProviders = [{id: 'custom:local', name: 'Local', endpoint: 'http://localhost:11434/v1/chat/completions', models: ['reader']}];
        current.harness.service = 'custom:local';
        current.requireApiKey[createApiKeyRequirementKey('custom:local', 'reader')] = false;
        generateText.mockRejectedValueOnce(new Error('local service unavailable'));
        await createHarnessRuntime(() => current).run({type: 'fluentReadHarness', action: 'run', requestId: 'local-failed', intent: 'meaning', question: '', selection: {text: 'x', context: '', sentence: ''}}, new AbortController().signal);
        expect(normalizeError).toHaveBeenCalledWith(expect.any(Error), 'custom:local', '');
    });

});
