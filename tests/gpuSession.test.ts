import {describe, expect, it, vi} from 'vitest';
import type {InferenceSession} from 'onnxruntime-web';
import {captureGpuSessionFailure, gpuSessionOptions} from '@/src/shared/onnx/gpuSession';

describe('strict GPU inference sessions', () => {
    it('disables implicit CPU EP fallback and returns independent options', () => {
        const first = gpuSessionOptions();
        expect(first).toEqual({executionProviders: ['webgpu'], graphOptimizationLevel: 'all', extra: {session: {disable_cpu_ep_fallback: '1'}}});
        first.executionProviders = ['wasm'];
        expect(gpuSessionOptions().executionProviders).toEqual(['webgpu']);
    });
    it.each(['paddle-recognition-shapes', 'lama-shapes'] as const)('allows host shape control only under the explicit pinned %s profile', profile => {
        expect(gpuSessionOptions(profile)).toEqual({executionProviders: ['webgpu'], graphOptimizationLevel: 'all'});
    });
    it('preserves successful output and original receiver', async () => {
        const output = {tensor: {}};
        const session = {run: vi.fn(async function (this: unknown) {expect(this).toBe(session); return output;})};
        const check = captureGpuSessionFailure(session as unknown as InferenceSession);
        check();expect(await session.run()).toBe(output);check();
    });
    it.each([new Error('lost device'), undefined, 'driver failure'])('keeps failed sessions poisoned even when a SDK swallows %s', async failure => {
        const run = vi.fn().mockRejectedValue(failure), session = {run};
        const check = captureGpuSessionFailure(session as unknown as InferenceSession);
        await expect(session.run()).rejects.toBe(failure);
        for (let i = 0; i < 2; i++) {
            let thrown = false;
            try {check();} catch (error) {thrown = true;expect(error).toBe(failure);}
            expect(thrown).toBe(true);
            await expect(session.run()).rejects.toBe(failure);
        }
        expect(run).toHaveBeenCalledOnce();
    });
});
