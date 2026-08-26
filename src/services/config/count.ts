/**
 * @file src/services/config/count.ts
 * 文件职责：定义翻译计数增量的跨上下文协议常量和输入约束，避免调用方为一次计数变化提交整份配置。
 * 主要内容：导出专用消息名称、单次最大增量，并把未知输入解析为受限的正安全整数或 null，供前后台复用同一校验。
 * 模块边界：本文件是纯协议与校验模块，不读取当前计数、不修改历史也不访问浏览器 API；原子累加和持久化由配置 store 与后台 handler 完成。
 */
export const CONFIG_COUNT_INCREMENT_MESSAGE = 'incrementConfigCount' as const;
export const CONFIG_COUNT_INCREMENT_MAX = 100_000;

export function parseConfigCountIncrement(value: unknown): number | null {
    return typeof value === 'number'
        && Number.isSafeInteger(value)
        && value > 0
        && value <= CONFIG_COUNT_INCREMENT_MAX
        ? value
        : null;
}
