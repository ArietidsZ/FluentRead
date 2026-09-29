import fs from 'node:fs';
import path from 'node:path';

/** 保留仓库中的原始 vendor 文件；扩展产物将内嵌 Base64 还原为同字节的本地 WASM。 */
export function splitTesseractWasm(source: string): {code: string; wasm: Buffer} {
    const embedded = [...source.matchAll(/"data:application\/octet-stream;base64,([A-Za-z0-9+/]+={0,2})"/g)];
    const factory = 'function(TesseractCore = {})  {';
    if (embedded.length !== 1 || source.split(factory).length !== 2) {
        throw new Error('Unsupported embedded Tesseract WASM format');
    }
    const wasm = Buffer.from(embedded[0][1], 'base64');
    if (wasm.toString('base64') !== embedded[0][1]
        || !wasm.subarray(0, 8).equals(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]))) {
        throw new Error('Invalid embedded Tesseract WASM binary');
    }
    const fileName = 'tesseract-core-simd-lstm.wasm';
    // importScripts 不设置 document.currentScript，Emscripten 默认会相对于 worker/ 查找内核。
    // 扩展固定从自有 worker/worker.min.js 启动，明确使用兄弟 core/ 路径；保留调用方的 locateFile。
    const locate = `TesseractCore.locateFile ||= (file, prefix) => file === ${JSON.stringify(fileName)}
        ? new URL('../core/' + file, self.location.href).href : prefix + file;`;
    const code = source.replace(embedded[0][0], JSON.stringify(fileName))
        .replace(factory, `${factory}\n${locate}\n`);
    return {code, wasm};
}

/** 把拆分出的二进制与诊断适配后的 glue 一起登记给 WXT，保持已有 corePath 不变。 */
export function packageTesseractWasm(root: string, sourcePath: string): {glue: string; wasm: string} {
    const split = splitTesseractWasm(fs.readFileSync(sourcePath, 'utf8'));
    const outputDirectory = path.resolve(root, '.wxt/packaged-wasm');
    const glue = path.join(outputDirectory, 'tesseract-core-simd-lstm.wasm.js');
    const wasm = path.join(outputDirectory, 'tesseract-core-simd-lstm.wasm');
    const adapter = fs.readFileSync(path.resolve(root, 'scripts/wasm/diagnostics.js'), 'utf8');
    fs.mkdirSync(outputDirectory, {recursive: true});
    fs.writeFileSync(glue, instrumentWasmDiagnostics(split.code, 'tesseract', adapter));
    fs.writeFileSync(wasm, split.wasm);
    return {glue, wasm};
}

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
