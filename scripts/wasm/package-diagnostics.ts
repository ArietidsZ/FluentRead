import fs from 'node:fs';
import path from 'node:path';

/** 仅适配锁定依赖的浏览器 stderr 出口，保留 vendor 文件和 WASM 二进制原样。 */
export function instrumentWasmDiagnostics(source: string, runtime: 'onnx' | 'tesseract', adapter: string): string {
    const factory = runtime === 'onnx'
        ? /(?:async function\(moduleArg = \{\}\) \{|async function ortWasmThreaded\(moduleArg=\{\}\)\{)/g
        : /function\(TesseractCore = \{\}\)  \{/g;
    const stderr = runtime === 'onnx' ? 'console.error.bind(console)' : 'console.warn.bind(console)';
    // 格式变化必须在构建时失败，避免升级后静默失去分级或替换错误位置。
    if ([...source.matchAll(factory)].length !== 1 || source.split(stderr).length !== 2) {
        throw new Error(`Unsupported ${runtime} WASM diagnostic glue`);
    }
    const result = source.replace(factory, match => `${match}\n${adapter}\n`).replace(stderr, 'fluentReadWasmStderr');
    // ORT 的 pthread 分支还有单独的 stderr 转发；只改 vendor 源中的出口，不能改适配器本身。
    return runtime === 'onnx'
        ? result.replace(/console\.error\(([a-z])\)/g, 'fluentReadWasmStderr($1)')
        : result;
}

export function packageWasmDiagnostics(root: string, sourcePath: string, fileName: string, runtime: 'onnx' | 'tesseract'): string {
    const adapter = fs.readFileSync(path.resolve(root, 'scripts/wasm/diagnostics.js'), 'utf8');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const output = path.resolve(root, '.wxt/packaged-wasm', fileName);
    fs.mkdirSync(path.dirname(output), {recursive: true});
    fs.writeFileSync(output, instrumentWasmDiagnostics(source, runtime, adapter));
    return output;
}
