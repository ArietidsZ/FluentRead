/**
 * @file tests/harnessModelGateway.test.ts
 * 文件职责：验证 Harness 模型网关的服务边界、端点、凭据、取消和工具调用请求协议。
 * 主要内容：使用真实 AI SDK provider 加 mock fetch 检查 OpenAI-compatible payload。
 * 模块边界：测试不访问真实网络，不覆盖 UI、会话、Config 持久化或背景路由。
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {generateText, tool} from 'ai';
import {z} from 'zod';
import {Config} from '@/src/core/config/model';
import {currentModelIds, services} from '@/src/core/config/catalog';
import {createHarnessLanguageModel, normalizeHarnessModelError, sanitizeHarnessModelMessage} from '@/src/services/harness/modelGateway';
import {setRuntimeFetch} from '@/src/platform/http/runtime';

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}});
}

describe('harness model gateway', () => {
  afterEach(() => {
    setRuntimeFetch();
  });

  it('keeps custom endpoint query, model, messages and tools', async () => {
    const config = new Config();
    config.customOpenAIProviders = [{id: 'custom:test', name: 'Test', endpoint: 'https://local.test/v1/chat/completions?tenant=a&tenant=b', models: ['my-model']}];
    config.token['custom:test'] = 'secret-key';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(String(input)).toContain('tenant=a');
      expect(body.model).toBe('my-model');
      expect(body.tools?.[0]?.function?.name).toBe('lookup');
      expect(body.messages).toEqual([{role: 'user', content: 'Explain this sentence'}]);
      expect((init?.headers as Record<string, string>).authorization).toContain('secret-key');
      return response({choices: [{message: {role: 'assistant', content: 'done'}, finish_reason: 'stop'}]});
    });
    setRuntimeFetch(fetchMock);
    const model = createHarnessLanguageModel(config, 'custom:test', 'my-model');
    await generateText({model, messages: [{role: 'user', content: 'Explain this sentence'}], tools: {lookup: tool({description: 'lookup', inputSchema: z.object({q: z.string()})})}});
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects machine services and DeepSeek Responses mode', () => {
    const config = new Config();
    expect(() => createHarnessLanguageModel(config, services.google, 'x')).toThrow('尚未适配');
    expect(() => createHarnessLanguageModel(config, 'unknown-service', 'x')).toThrow('尚未适配');
    expect(() => createHarnessLanguageModel(config, services.openai, '   ')).toThrow('选择一个模型');
    config.deepseekApiType = 'responses';
    expect(() => createHarnessLanguageModel(config, services.deepseek, 'deepseek-chat')).toThrow('Responses');
    expect(() => createHarnessLanguageModel({...config, token: {...config.token, [services.zhipu]: 'invalid'}} as Config, services.zhipu, 'glm-test')).toThrow('id.secret');
  });

  it('adds DeepSeek thinking without replacing session messages', async () => {
    const config = new Config();
    config.modelThinking = {[services.deepseek]: {'deepseek-chat': true}};
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.thinking).toEqual({type: 'enabled'});
      expect(body.messages).toEqual([{role: 'system', content: 'Use Chinese'}, {role: 'user', content: 'Explain'}]);
      return response({choices: [{message: {role: 'assistant', content: 'ok'}, finish_reason: 'stop'}]});
    });
    setRuntimeFetch(fetchMock);
    const model = createHarnessLanguageModel(config, services.deepseek, 'deepseek-chat');
    await generateText({model, system: 'Use Chinese', prompt: 'Explain'});
  });

  it('supports explicit compatible endpoint overrides and disabled thinking', async () => {
    const config = new Config();
    config.proxy[services.deepseek] = 'https://deepseek.test/v1/chat/completions?region=cn';
    config.proxy[services.tongyi] = 'https://qwen.test/v1/chat/completions?region=cn';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (String(input).includes('deepseek.test')) expect(body.thinking).toEqual({type: 'disabled'});
      expect(String(input)).toMatch(/(?:deepseek|qwen)\.test/u);
      return response({choices: [{message: {role: 'assistant', content: 'ok'}, finish_reason: 'stop'}]});
    });
    setRuntimeFetch(fetchMock);
    await generateText({model: createHarnessLanguageModel(config, services.deepseek, 'deepseek-chat'), prompt: 'hello'});
    await generateText({model: createHarnessLanguageModel(config, services.tongyi, currentModelIds.tongyiTokenPlan), prompt: 'hello'});
  });

  it('builds a Zhipu bearer token and preserves a configured endpoint query', async () => {
    const config = new Config();
    config.proxy[services.zhipu] = 'https://zhipu.test/api/chat/completions?tenant=reader';
    config.token[services.zhipu] = 'public-id.private-secret';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('tenant=reader');
      const authorization = new Headers(init?.headers).get('authorization') || '';
      expect(authorization.startsWith('Bearer ey')).toBe(true);
      expect(authorization).not.toContain('private-secret');
      return response({choices: [{message: {role: 'assistant', content: 'ok'}, finish_reason: 'stop'}]});
    });
    setRuntimeFetch(fetchMock);
    await generateText({model: createHarnessLanguageModel(config, services.zhipu, 'glm-test'), prompt: 'Explain'});
  });

  it('adds service specific headers for Azure and OpenRouter', async () => {
    const azure = new Config();
    azure.token[services.azureOpenai] = 'azure-secret';
    azure.azureOpenaiEndpoint = 'https://azure.test/openai/deployments/reader/chat/completions?api-version=2024-02-15-preview';
    const azureFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('api-key')).toBe('azure-secret');
      return response({choices: [{message: {role: 'assistant', content: 'ok'}, finish_reason: 'stop'}]});
    });
    setRuntimeFetch(azureFetch);
    await generateText({model: createHarnessLanguageModel(azure, services.azureOpenai, 'reader'), prompt: 'hello'});

    const router = new Config();
    router.token[services.openrouter] = 'router-secret';
    const routerFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('HTTP-Referer')).toBe('https://fluent.thinkstu.com');
      expect(new Headers(init?.headers).get('X-Title')).toBe('FluentRead Harness');
      return response({choices: [{message: {role: 'assistant', content: 'ok'}, finish_reason: 'stop'}]});
    });
    setRuntimeFetch(routerFetch);
    await generateText({model: createHarnessLanguageModel(router, services.openrouter, 'openrouter/test'), prompt: 'hello'});
  });

  it('uses native Claude Messages API and honors configured proxy', async () => {
    const config = new Config();
    config.token[services.claude] = 'claude-secret';
    config.proxy[services.claude] = 'https://claude-proxy.test/v1/messages';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://claude-proxy.test/v1/messages');
      expect(new Headers(init?.headers).get('x-api-key')).toBe('claude-secret');
      expect(new Headers(init?.headers).get('anthropic-dangerous-direct-browser-access')).toBe('true');
      return response({id: 'msg_1', type: 'message', role: 'assistant', content: [{type: 'text', text: 'claude answer'}], stop_reason: 'end_turn', usage: {input_tokens: 2, output_tokens: 3}});
    });
    setRuntimeFetch(fetchMock);
    const result = await generateText({model: createHarnessLanguageModel(config, services.claude, 'claude-sonnet-5'), prompt: 'Explain'});
    expect(result.text).toBe('claude answer');
    const directFetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('api.anthropic.com');
      return response({id: 'msg_2', type: 'message', role: 'assistant', content: [{type: 'text', text: 'direct'}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}});
    });
    setRuntimeFetch(directFetch);
    const directConfig = new Config();
    directConfig.token[services.claude] = 'direct-secret';
    expect((await generateText({model: createHarnessLanguageModel(directConfig, services.claude, 'claude-test'), prompt: 'Explain'})).text).toBe('direct');
    expect(createHarnessLanguageModel(new Config(), services.claude, 'claude-no-key')).toBeTruthy();
  });

  it('uses native Gemini generateContent API and honors configured proxy', async () => {
    const config = new Config();
    config.token[services.gemini] = 'gemini-secret';
    config.proxy[services.gemini] = 'https://gemini-proxy.test/v1beta/models/gemini-test:generateContent';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://gemini-proxy.test/v1beta/models/gemini-test:generateContent');
      return response({candidates: [{content: {role: 'model', parts: [{text: 'gemini answer'}]}, finishReason: 'STOP'}], usageMetadata: {promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 5}});
    });
    setRuntimeFetch(fetchMock);
    const result = await generateText({model: createHarnessLanguageModel(config, services.gemini, 'gemini-test'), prompt: 'Explain'});
    expect(result.text).toBe('gemini answer');
    expect(createHarnessLanguageModel(new Config(), services.gemini, 'gemini-test')).toBeTruthy();
  });

  it('uses the Token Plan endpoint for the matching Qwen model', async () => {
    const config = new Config();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('token-plan.cn-beijing.maas.aliyuncs.com');
      return response({choices: [{message: {role: 'assistant', content: 'ok'}, finish_reason: 'stop'}]});
    });
    setRuntimeFetch(fetchMock);
    await generateText({model: createHarnessLanguageModel(config, services.tongyi, currentModelIds.tongyiTokenPlan), prompt: 'hello'});
    expect(createHarnessLanguageModel(config, services.tongyi, 'qwen-normal')).toBeTruthy();
  });

  it('normalizes provider details without leaking credential query values', () => {
    const error = new Error('request failed https://api.test/chat?api_key=secret-value&tenant=reader');
    const normalized = normalizeHarnessModelError(error, services.openai, 'secret-value');
    expect(normalized.message).not.toContain('secret-value');
    expect(normalized.message).toContain('api_key=[已隐藏]');
    expect(sanitizeHarnessModelMessage('https://x.test/?token=raw&ok=1')).toBe('https://x.test/?token=[已隐藏]&ok=1');
  });

  it('propagates cancellation through runtime fetch', async () => {
    const config = new Config();
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      throw new DOMException('Aborted', 'AbortError');
    });
    setRuntimeFetch(fetchMock);
    const model = createHarnessLanguageModel(config, services.openai, 'gpt-test');
    await expect(generateText({model, prompt: 'hello', abortSignal: controller.signal})).rejects.toThrow();
  });
});
