import {afterEach, describe, expect, it, vi} from 'vitest';
import {probeWebGpu} from '@/src/shared/onnx/webgpu';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('local audio hardware WebGPU probe', () => {
    it('uses a high-performance hardware adapter without allocating a device', async () => {
        const requestAdapter = vi.fn().mockResolvedValue({info: {vendor: 'apple', architecture: 'metal'}});
        vi.stubGlobal('navigator', {gpu: {requestAdapter}});
        await expect(probeWebGpu()).resolves.toEqual({available: true, info: 'apple / metal'});
        expect(requestAdapter).toHaveBeenCalledWith({powerPreference: 'high-performance'});
    });

    it.each([
        undefined,
        {},
        {gpu: {}},
        {gpu: {requestAdapter: async () => null}},
        {gpu: {requestAdapter: () => {throw new Error('synchronous driver failure');}}},
        {gpu: {requestAdapter: async () => {throw new Error('driver unavailable');}}},
        {gpu: {requestAdapter: async () => ({isFallbackAdapter: true})}},
        ...['SwiftShader', 'software', 'llvmpipe', 'fallback'].map(description => ({gpu: {requestAdapter: async () => ({info: {description}})}})),
    ])('falls back when hardware is unavailable (%#)', async (runtimeNavigator) => {
        vi.stubGlobal('navigator', runtimeNavigator);
        await expect(probeWebGpu()).resolves.toEqual({available: false, info: ''});
    });

    it('does not use headless software GPU paths', async () => {
        const requestAdapter = vi.fn();
        vi.stubGlobal('navigator', {userAgent: 'HeadlessChrome', gpu: {requestAdapter}});
        expect((await probeWebGpu()).available).toBe(false);
        expect(requestAdapter).not.toHaveBeenCalled();
    });

    it('does not require optional adapter information', async () => {
        vi.stubGlobal('navigator', {gpu: {requestAdapter: async () => ({})}});
        await expect(probeWebGpu()).resolves.toEqual({available: true, info: ''});
    });

    it('bounds a stalled driver probe and ignores its late result', async () => {
        vi.useFakeTimers();
        let release!: (adapter: {}) => void;
        vi.stubGlobal('navigator', {gpu: {requestAdapter: () => new Promise(resolve => { release = resolve; })}});
        const probe = probeWebGpu();
        await vi.advanceTimersByTimeAsync(2_000);
        await expect(probe).resolves.toEqual({available: false, info: ''});
        release({});
        await expect(probe).resolves.toEqual({available: false, info: ''});
        expect(vi.getTimerCount()).toBe(0);
    });
});
