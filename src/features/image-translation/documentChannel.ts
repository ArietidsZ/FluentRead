/**
 * @file src/features/image-translation/documentChannel.ts
 * 文件职责：定义图片与圈选共用的文档长连接协议和受限操作集合。
 * 主要内容：版本化端口名称、请求与来源核验消息的传输结构，以及可经文档连接调用的消息白名单。
 * 模块边界：只描述协议，不访问浏览器或供应商，不以传输字段授予文档身份。
 */
import type {BrowserRequestContext} from '@/src/platform/browser/requestOwner';
export const IMAGE_DOCUMENT_PORT = 'fluentReadImageDocument:v1';
export const IMAGE_DOCUMENT_VERSION = 1;
const operations = new Set(['fluentReadImageFetch', 'fluentReadImageTranslate', 'fluentReadImageCancel',
    'fluentReadAreaCapture', 'fluentReadAreaTranslateCapture', 'fluentReadAreaCancel']);
export function isImageDocumentOperation(type: unknown): boolean {return operations.has(type as string);}
export interface DocumentPort {
    readonly name: string;
    readonly sender?: BrowserRequestContext['sender'];
    postMessage(message: unknown): void;
    disconnect(): void;
    readonly onMessage: {addListener(listener: (message: any) => void): void; removeListener(listener: (message: any) => void): void};
    readonly onDisconnect: {addListener(listener: () => void): void; removeListener(listener: () => void): void};
}
export interface SourceChallenge {readonly type: string; readonly requestId: string; readonly url: string; readonly documentUrl: string}
