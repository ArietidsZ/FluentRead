/**
 * @file src/platform/offscreen/client.ts
 *
 * 文件职责：管理 Chrome Offscreen document 的创建、复用与消息发送，为 OCR、内置翻译和音频等后台能力提供基础设施客户端。
 * 主要内容：定义 runtime/document 依赖端口和 OffscreenClient，createOffscreenClient 串行创建文档、等待接收端 ready 握手，并在接收端丢失时受控重建一次，默认 chromeOffscreenClient 连接浏览器 API。 可核对的公开符号包括 OffscreenMessage、OffscreenMessageEnvelope、OffscreenRuntimeApi、OffscreenDocumentApi、OffscreenClientDependencies、OffscreenClient、createOffscreenClient、chromeOffscreenClient。
 * 模块边界：本文件属于 platform 基础设施边界，只封装浏览器、网络、存储上下文或 Shadow DOM 机制；不决定翻译业务策略，不直接实现 feature，业务层通过类型化端口消费这里的能力。
 */

export interface OffscreenMessage {
    readonly type: string;
}

export const OFFSCREEN_READY_MESSAGE_TYPE = 'FLUENT_READ_OFFSCREEN_READY' as const;

export type OffscreenMessageEnvelope<TMessage extends OffscreenMessage> = TMessage & {
    readonly target: 'offscreen';
};

export interface OffscreenRuntimeApi {
    readonly lastError?: {readonly message?: string};
    getContexts?(filter: {contextTypes: ['OFFSCREEN_DOCUMENT']}): Promise<unknown[]>;
    sendMessage(
        message: unknown,
        callback: (response: unknown) => void,
    ): void;
}

export interface OffscreenDocumentApi {
    createDocument(options: {
        url: string;
        reasons: string[];
        justification: string;
    }): Promise<void>;
    closeDocument?(): Promise<void>;
}

export interface OffscreenClientDependencies {
    readonly getRuntime: () => OffscreenRuntimeApi;
    readonly getOffscreen: () => OffscreenDocumentApi | undefined;
    readonly documentUrl?: string;
    readonly readyRetryAttempts?: number;
    readonly readyRetryDelay?: () => Promise<void>;
}

export interface OffscreenClient {
    hasDocument(): Promise<boolean>;
    ensureDocument(): Promise<void>;
    send<
        TResponse,
        TMessage extends OffscreenMessage = OffscreenMessage & Readonly<Record<string, unknown>>,
    >(message: TMessage): Promise<TResponse>;
    sendIfPresent<
        TResponse,
        TMessage extends OffscreenMessage = OffscreenMessage & Readonly<Record<string, unknown>>,
    >(
        message: TMessage,
    ): Promise<TResponse | undefined>;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isMissingReceiverError(error: unknown): boolean {
    const message = errorMessage(error);
    return message.includes('Receiving end does not exist')
        || message.includes('Could not establish connection');
}

/** Chrome MV3 Offscreen 生命周期与 callback runtime messaging 的唯一平台适配器。 */
export function createOffscreenClient(dependencies: OffscreenClientDependencies): OffscreenClient {
    type DocumentPreparationResult = {createdDocument: boolean};
    let preparingDocument: {
        forceRecreate: boolean;
        promise: Promise<DocumentPreparationResult>;
    } | null = null;
    const readyRetryAttempts = Math.max(1, Math.floor(dependencies.readyRetryAttempts ?? 40));
    const readyRetryDelay = dependencies.readyRetryDelay
        ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 25)));

    const getExistingContexts = async (): Promise<unknown[]> => {
        const getContexts = dependencies.getRuntime().getContexts;
        if (typeof getContexts !== 'function') {
            throw new Error('当前浏览器不支持查询 Offscreen 文档');
        }
        return getContexts.call(dependencies.getRuntime(), {contextTypes: ['OFFSCREEN_DOCUMENT']});
    };

    const hasDocument = async (): Promise<boolean> => {
        const runtime = dependencies.getRuntime();
        if (!dependencies.getOffscreen() || typeof runtime.getContexts !== 'function') return false;
        const contexts = await runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']});
        return contexts.length > 0;
    };

    const sendWithoutCreating = <TResponse, TMessage extends OffscreenMessage>(
        message: TMessage,
    ): Promise<TResponse> => new Promise((resolve, reject) => {
        const runtime = dependencies.getRuntime();
        try {
            runtime.sendMessage({...message, target: 'offscreen'}, (response) => {
                const runtimeError = dependencies.getRuntime().lastError;
                if (runtimeError) {
                    reject(new Error(runtimeError.message || 'Offscreen 消息发送失败'));
                } else {
                    resolve(response as TResponse);
                }
            });
        } catch (error) {
            reject(error);
        }
    });

    const waitForReceiver = async (): Promise<void> => {
        let lastError: unknown = new Error('Offscreen 文档尚未就绪');
        for (let attempt = 0; attempt < readyRetryAttempts; attempt += 1) {
            try {
                const response = await sendWithoutCreating<{
                    success?: boolean;
                    ready?: boolean;
                }, OffscreenMessage>({type: OFFSCREEN_READY_MESSAGE_TYPE});
                if (response?.success === true && response.ready === true) return;
                lastError = new Error('Offscreen 文档未确认接收端就绪');
            } catch (error) {
                if (!isMissingReceiverError(error)) throw error;
                lastError = error;
            }
            if (attempt + 1 < readyRetryAttempts) await readyRetryDelay();
        }
        throw lastError;
    };

    const prepareDocument = async (forceRecreate: boolean): Promise<DocumentPreparationResult> => {
        const offscreen = dependencies.getOffscreen();
        if (!offscreen || typeof offscreen.createDocument !== 'function') {
            throw new Error('当前浏览器不支持扩展 Offscreen 文档');
        }

        const contexts = await getExistingContexts();
        if (forceRecreate && contexts.length > 0) {
            if (typeof offscreen.closeDocument !== 'function') {
                throw new Error('当前浏览器无法重建失去接收端的 Offscreen 文档');
            }
            await offscreen.closeDocument();
        }
        const createdDocument = forceRecreate || contexts.length === 0;
        if (createdDocument) {
            await offscreen.createDocument({
                url: dependencies.documentUrl || 'offscreen.html',
                reasons: ['DOM_SCRAPING', 'AUDIO_PLAYBACK'],
                justification: 'FluentRead needs an extension-owned DOM for Translation API, OCR, and CSP-independent TTS playback',
            });
        }
        await waitForReceiver();
        return {createdDocument};
    };

    const runDocumentPreparation = async (
        forceRecreate: boolean,
    ): Promise<DocumentPreparationResult> => {
        const currentPreparation = preparingDocument;
        if (currentPreparation) {
            // A forced rebuild may satisfy an ordinary probe, but an ordinary probe must never
            // consume a rebuild request after a business message has lost its receiver.
            if (!forceRecreate || currentPreparation.forceRecreate) return currentPreparation.promise;
            try {
                const result = await currentPreparation.promise;
                // If the ordinary preparation already created and confirmed a fresh document,
                // it has fulfilled the queued rebuild. Closing it again could interrupt callers
                // that were released by the same preparation.
                if (result.createdDocument) return result;
            } catch {
                // The forced rebuild below supersedes the failed ordinary readiness probe.
            }
            return runDocumentPreparation(true);
        }

        const promise = prepareDocument(forceRecreate).finally(() => {
            if (preparingDocument?.promise === promise) preparingDocument = null;
        });
        preparingDocument = {forceRecreate, promise};
        return promise;
    };

    const rebuildDocument = async (): Promise<void> => {
        await runDocumentPreparation(true);
    };

    const ensureDocument = async (): Promise<void> => {
        try {
            await runDocumentPreparation(false);
        } catch (error) {
            if (!isMissingReceiverError(error)) {
                throw new Error(`无法创建 Offscreen 文档：${errorMessage(error)}`);
            }
            try {
                await rebuildDocument();
            } catch (rebuildError) {
                throw new Error(`无法创建 Offscreen 文档：${errorMessage(rebuildError)}`);
            }
        }
    };

    return {
        hasDocument,
        ensureDocument,
        async send<TResponse, TMessage extends OffscreenMessage>(message: TMessage): Promise<TResponse> {
            await ensureDocument();
            try {
                return await sendWithoutCreating<TResponse, TMessage>(message);
            } catch (error) {
                if (!isMissingReceiverError(error)) throw error;
                await rebuildDocument();
                return sendWithoutCreating<TResponse, TMessage>(message);
            }
        },
        async sendIfPresent<TResponse, TMessage extends OffscreenMessage>(
            message: TMessage,
        ): Promise<TResponse | undefined> {
            if (!await hasDocument()) return undefined;
            return sendWithoutCreating<TResponse, TMessage>(message);
        },
    };
}

export const chromeOffscreenClient = createOffscreenClient({
    getRuntime: () => chrome.runtime as OffscreenRuntimeApi,
    getOffscreen: () => chrome.offscreen as unknown as OffscreenDocumentApi | undefined,
});
