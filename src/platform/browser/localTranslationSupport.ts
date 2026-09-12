/**
 * @file src/platform/browser/localTranslationSupport.ts
 *
 * 文件职责：在下载混元模型前检查当前浏览器的必要运行能力。
 * 主要内容：验证最小 memory64 模块，不分配模型内存，也不依赖易过期的浏览器版本判断。
 * 模块边界：仅探测 WebAssembly 能力，不下载文件、不启动 Worker、不修改浏览器设置。
 */
export function supportsHunyuanTranslation(): boolean {
    // A module containing one zero-page 64-bit memory, matching the bundled runtime.
    return typeof WebAssembly !== 'undefined'
        && WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 4, 0]));
}
