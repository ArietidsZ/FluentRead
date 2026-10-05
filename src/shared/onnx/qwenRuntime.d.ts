/**
 * @file src/shared/onnx/qwenRuntime.d.ts
 * 文件职责：为独立 Qwen ORT 包别名声明使用到的稳定公共 API。
 * 主要内容：上游包的 ambient module 名称固定为 onnxruntime-web，npm 别名需显式映射同一公共类型契约。
 * 模块边界：仅类型声明，不重定向运行时代码或 WASM 文件。
 */
declare module 'onnxruntime-web-qwen/webgpu' {
    export * from 'onnxruntime-web';
}
