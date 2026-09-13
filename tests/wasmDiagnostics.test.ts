import {describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {instrumentWasmDiagnostics} from '../scripts/wasm/package-diagnostics';

const adapter = readFileSync(new URL('../scripts/wasm/diagnostics.js', import.meta.url), 'utf8');
const createLog = () => {
    const output = {debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()};
    const write = runInNewContext(`${adapter}\nfluentReadWasmStderr`, {console: output});
    return {output, write};
};

describe('packaged WASM diagnostic severity', () => {
    it('保留 ONNX 原始严重级别，去除终端颜色并保留性能警告', () => {
        const {output, write} = createLog();
        const warning = '2026-09-13 15:13:13.499400 [W:onnxruntime:, session_state.cc:1280 VerifyEachNodeIsAssignedToAnEp] Some nodes were not assigned to the preferred execution providers';
        write(`\u001b[0;93m${warning}\u001b[m`);
        expect(output.warn).toHaveBeenCalledWith(warning);
        for (const [severity, level] of [['V', 'debug'], ['I', 'info'], ['E', 'error'], ['F', 'error']] as const) {
            const text = `[${severity}:onnxruntime:Default] diagnostic`;
            write(text);
            expect(output[level]).toHaveBeenCalledWith(text);
        }
        expect(output.error).toHaveBeenCalledTimes(2);
    });

    it('仅把已知 LSTM 旧参数和分辨率提示降为 debug，未知警告与失败保持可见', () => {
        const {output, write} = createLog();
        for (const parameter of ['language_model_ngram_on', 'segsearch_max_char_wh_ratio', 'language_model_ngram_space_delimited_language', 'language_model_ngram_scale_factor', 'language_model_use_sigmoidal_certainty', 'language_model_ngram_nonmatch_score', 'classify_integer_matcher_multiplier', 'assume_fixed_pitch_char_segment', 'chop_enable', 'allow_blob_division']) {
            write(`Warning: Parameter not found: ${parameter}`);
        }
        write('Estimating resolution as 225');
        expect(output.debug).toHaveBeenCalledTimes(11);
        write('Warning: Parameter not found: future_required_parameter');
        expect(output.warn).toHaveBeenCalledWith('Warning: Parameter not found: future_required_parameter');
        for (const text of [
            'Error opening data file eng.traineddata',
            'Aborted(out of memory)',
            'Warning: Parameter not found: allow_blob_division\nFailed loading language',
            'Estimating resolution as 225\nError loading model',
            'unexpected [W:onnxruntime:Default] failure',
            '[W:onnxruntime:Default] warning\nError loading model',
        ]) {
            write(text);
            expect(output.error).toHaveBeenCalledWith(text);
        }
        expect(output.error).toHaveBeenCalledTimes(6);
    });

    it('在引擎闭包内适配 stderr，不替换外部 console，拒绝陌生 glue 格式', async () => {
        const glue = 'var core = async function(moduleArg = {}) { const stderr = console.error.bind(console); stderr(moduleArg.message); return moduleArg; }; core;';
        const output = {debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()};
        const error = output.error;
        const core = runInNewContext(instrumentWasmDiagnostics(glue, 'onnx', adapter), {console: output});
        const args = {message: '[W:onnxruntime:Default] warning', wasmBinary: new Uint8Array([0, 97, 115, 109])};
        expect(await core(args)).toBe(args);
        expect(output.warn).toHaveBeenCalledWith(args.message);
        expect(output.error).toBe(error);
        output.error('outside engine');
        expect(output.error).toHaveBeenCalledWith('outside engine');
        expect(() => instrumentWasmDiagnostics('new vendor format', 'onnx', adapter)).toThrow('Unsupported');
        expect(() => instrumentWasmDiagnostics(`${glue}\n${glue}`, 'onnx', adapter)).toThrow('Unsupported');
        const ocr = readFileSync(new URL('../public/fluent-read-ocr/core/tesseract-core-simd-lstm.wasm.js', import.meta.url), 'utf8');
        expect(instrumentWasmDiagnostics(ocr, 'tesseract', adapter)).toContain('n=b.printErr||fluentReadWasmStderr');
    });
});
