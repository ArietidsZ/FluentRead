/**
 * @file src/services/translation/runtimeTransport.ts
 * 文件职责：为原生文本和输入框提供带超时、唯一请求 ID 与一次取消通知的 runtime 传输等待。
 * 主要内容：分离调用方中止与传输收口，消费迟到的成功/拒绝，队列 lease 保留至传输结算或超时，每次调用都生成新 ID。
 * 模块边界：仅调用注入的 sendMessage，不接触后台身份、provider 或配置；ID 用于定位请求，不提供跨导航授权。传输开始前的 abort 不发送 start/cancel。
 */
import type {TranslationQueueLease} from './queue';
let translationRequestSequence = 0;
const translationRequestNonce = (() => {
  try {
    const random = new Uint32Array(4);
    globalThis.crypto.getRandomValues(random);
    return Array.from(random, value => value.toString(36)).join('-');
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
})();

function createTranslationClientRequestId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `translation-${randomUuid}`;
  translationRequestSequence += 1;
  return `translation-${translationRequestNonce}-${translationRequestSequence}`;
}

export function createTranslationRuntimeAbortError(): Error {
  const error = new Error('翻译已取消');
  error.name = 'AbortError';
  return error;
}

export function throwIfTranslationRuntimeAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createTranslationRuntimeAbortError();
}

export function waitForTranslationRuntimeRequest<T>(
  sendMessage: (message: unknown) => PromiseLike<unknown>,
  message: unknown,
  timeout: number,
  signal?: AbortSignal,
  lease?: TranslationQueueLease,
  cancellationType?: string,
): Promise<T> {
  throwIfTranslationRuntimeAborted(signal);
  const clientRequestId = cancellationType ? createTranslationClientRequestId() : undefined;
  const requestMessage = clientRequestId
    ? {...message as object, clientRequestId}
    : message;
  const request: PromiseLike<T> = sendMessage(requestMessage) as PromiseLike<T>;
  let cancellationNotified = false;
  const notifyCancellation = () => {
    if (cancellationNotified || !clientRequestId) return;
    cancellationNotified = true;
    try {
      void Promise.resolve(sendMessage({
        type: cancellationType,
        clientRequestId,
      })).catch(() => undefined);
    } catch {
      // 页面卸载时 runtime.sendMessage 可能同步抛错；取消通知仅尽力而为。
    }
  };
  const transportSettlement = new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => finish(() => {
      notifyCancellation();
      reject(new Error('翻译请求超时'));
    }), timeout);
    Promise.resolve(request).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });

  // 调用方可立即停止等待；队列槽位仍持有到原 runtime 传输回应。
  // typed cancel 会让后台 broker 尽快中止并促使该传输收口。
  lease?.holdUntil(transportSettlement);
  if (!signal) return transportSettlement;

  return new Promise<T>((resolve, reject) => {
    let callerSettled = false;
    const finishCaller = (callback: () => void) => {
      if (callerSettled) return;
      callerSettled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finishCaller(() => {
      notifyCancellation();
      reject(createTranslationRuntimeAbortError());
    });
    signal.addEventListener('abort', onAbort, {once: true});
    transportSettlement.then(
      (value) => finishCaller(() => resolve(value)),
      (error) => finishCaller(() => reject(error)),
    );
    if (signal.aborted) onAbort();
  });
}

