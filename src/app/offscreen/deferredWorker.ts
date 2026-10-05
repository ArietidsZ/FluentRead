/**
 * @file src/app/offscreen/deferredWorker.ts
 * 文件职责：延迟导入模型运行时，防止构建工具在 Node 中执行浏览器专用推理模块。
 * 主要内容：在异步装配期间暂存消息，初始化后按序重放；导入失败对当前与后续请求返回同一个明确错误，不丢失首条请求。
 * 模块边界：不选择模型、不下载权重、不改变 feature 的协议；调用方在 load 中安装真实 Worker 消息处理器。
 */
export async function startDeferredWorker(load: () => Promise<void>): Promise<void> {
    const pending: MessageEvent[] = [];
    const collect = (event: MessageEvent) => { pending.push(event); };
    self.addEventListener('message', collect);
    try {
        await load();
        self.removeEventListener('message', collect);
        for (const event of pending) self.dispatchEvent(new MessageEvent('message', {data: event.data}));
    } catch (error) {
        self.removeEventListener('message', collect);
        const message = error instanceof Error ? error.message : String(error);
        const fail = (event: MessageEvent) => {
            if (typeof event.data?.requestId === 'number') self.postMessage({requestId: event.data.requestId, success: false, error: message});
        };
        self.addEventListener('message', fail);
        pending.forEach(fail);
    }
}
