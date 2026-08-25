/**
 * @file src/app/background/handlers/configPersistence.ts
 * 文件职责：在后台可信边界接收配置保存请求，规范化客户端身份与序号，并协调配置快照的串行持久化和响应。
 * 主要内容：声明 persistConfig 协议及依赖，校验普通对象、clientId 与非负 sequence，结合 sender 生成回退身份，调用 prepareConfig 与 persistPreparedConfig 后返回已接受的序号。
 * 模块边界：这里只处理跨上下文消息和保存编排，不定义 Config 字段、不直接操作 browser.storage，也不负责历史裁剪；校验、凭据拆分和存储事务由注入的配置服务承担。
 */
import type {BackgroundMessageHandler} from '../messageRouter';

export const CONFIG_PERSIST_MESSAGE_TYPE = 'persistConfig' as const;

export interface ConfigPersistenceMessage {
    type: typeof CONFIG_PERSIST_MESSAGE_TYPE;
    config?: unknown;
    clientId?: unknown;
    sequence?: unknown;
}

export interface ConfigPersistenceContext {
    sender?: {
        id?: string;
        url?: string;
        frameId?: number;
        tab?: {
            id?: number;
        };
    };
}

export interface ConfigPersistenceResponse {
    success: true;
}

export interface ConfigPersistenceDependencies<TConfig> {
    readonly ready: Promise<void>;
    readonly getCurrentConfig: () => TConfig;
    readonly prepareConfigSaveRequest: (
        incomingConfig: Record<string, unknown>,
        currentConfig: TConfig,
        allowCredentialUpdates: boolean,
    ) => TConfig;
    readonly saveConfig: (config: TConfig, options: {recordHistory: true}) => Promise<void>;
    readonly isExtensionUrl: (url: string) => boolean;
}

interface ParsedConfigPersistenceRequest {
    config: Record<string, unknown>;
    clientId: string;
    sequence: number;
    allowCredentialUpdates: boolean;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fallbackClientId(sender: ConfigPersistenceContext['sender']): string {
    const senderId = sender?.id || 'legacy';
    const tabId = sender?.tab?.id ?? 'extension';
    const frameId = sender?.frameId ?? 0;
    return `${senderId}:${tabId}:${frameId}`;
}

function parseClientId(value: unknown, sender: ConfigPersistenceContext['sender']): string {
    if (value === undefined) return fallbackClientId(sender);
    if (typeof value === 'string' && value.trim()) return value;
    throw new TypeError('配置保存 clientId 必须是非空字符串');
}

function parseSequence(value: unknown): number {
    if (value === undefined) return 0;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
    throw new TypeError('配置保存 sequence 必须是非负安全整数');
}

function parseConfigPersistenceMessage(
    message: ConfigPersistenceMessage,
    context: ConfigPersistenceContext,
    isExtensionUrl: (url: string) => boolean,
): ParsedConfigPersistenceRequest {
    if (!isPlainRecord(message.config)) throw new TypeError('配置保存 payload 缺少有效 config');

    // Step 1: clientId/sequence 是 latest-write-wins 的身份和版本边界。
    const clientId = parseClientId(message.clientId, context.sender);
    const sequence = parseSequence(message.sequence);

    // Step 2: 只有扩展自身页面可以更新凭据；content/page 消息只能保存公开字段。
    const senderUrl = typeof context.sender?.url === 'string' ? context.sender.url : '';
    return {
        config: message.config,
        clientId,
        sequence,
        allowCredentialUpdates: isExtensionUrl(senderUrl),
    };
}

/** 创建配置持久化 handler；队列状态封装在 handler 实例内，避免 background 暴露全局可变状态。 */
export function createConfigPersistenceHandler<TConfig>(
    dependencies: ConfigPersistenceDependencies<TConfig>,
): BackgroundMessageHandler<ConfigPersistenceContext, ConfigPersistenceMessage, ConfigPersistenceResponse> {
    let persistQueue: Promise<void> = Promise.resolve();
    const latestSequenceByClient = new Map<string, number>();

    return {
        type: CONFIG_PERSIST_MESSAGE_TYPE,
        async handle(message, context) {
            const request = parseConfigPersistenceMessage(message, context, dependencies.isExtensionUrl);
            const lastSequence = latestSequenceByClient.get(request.clientId) || 0;
            if (request.sequence && request.sequence <= lastSequence) return {success: true};
            if (request.sequence) latestSequenceByClient.set(request.clientId, request.sequence);

            const persist = persistQueue
                .catch(() => undefined)
                .then(async () => {
                    // Step 1: 队列轮到当前请求时再判断它是否仍是该 client 的最新序列。
                    if (request.sequence && latestSequenceByClient.get(request.clientId) !== request.sequence) return;
                    await dependencies.ready;

                    // Step 2: 使用注入的 prepare/save 保持凭据策略、规范化和历史记录行为。
                    const prepared = dependencies.prepareConfigSaveRequest(
                        request.config,
                        dependencies.getCurrentConfig(),
                        request.allowCredentialUpdates,
                    );
                    await dependencies.saveConfig(prepared, {recordHistory: true});
                });
            persistQueue = persist.catch(() => undefined);
            await persist;
            return {success: true};
        },
    };
}
