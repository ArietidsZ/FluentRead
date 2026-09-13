import {afterEach, describe, expect, it, vi} from 'vitest';
import {createOptionalContentFeatureRuntime, type OptionalContentFeatureConfig} from '@/src/app/content/optionalFeatures';

interface Harness {
    activation: AbortController;
    config: OptionalContentFeatureConfig;
    inputMount: ReturnType<typeof vi.fn>;
    inputInvalidate: ReturnType<typeof vi.fn>;
    paragraphMount: ReturnType<typeof vi.fn>;
    runtime: ReturnType<typeof createOptionalContentFeatureRuntime>;
}

function createHarness(overrides: Partial<OptionalContentFeatureConfig> = {}): Harness {
    const activation = new AbortController();
    const config: OptionalContentFeatureConfig = {
        on: true,
        inputBoxTranslationTrigger: 'disabled',
        paragraphCopyEnabled: false,
        ...overrides,
    };
    const inputMount = vi.fn();
    const inputInvalidate = vi.fn();
    const paragraphMount = vi.fn();
    const runtime = createOptionalContentFeatureRuntime({
        activationSignal: activation.signal,
        config,
        isSiteDisabled: () => false,
        inputTranslationFeature: {mount: inputMount, invalidate: inputInvalidate},
        mountParagraphCopyContentFeature: paragraphMount,
    });
    return {activation, config, inputMount, inputInvalidate, paragraphMount, runtime};
}

afterEach(() => vi.restoreAllMocks());

describe('optional content feature 生命周期', () => {
    it('默认关闭时不挂载，重复同步也不产生监听器', () => {
        const harness = createHarness();

        harness.runtime.sync();
        harness.runtime.sync();

        expect(harness.inputMount).not.toHaveBeenCalled();
        expect(harness.paragraphMount).not.toHaveBeenCalled();
        expect(harness.inputInvalidate).not.toHaveBeenCalled();
    });

    it('总开关或站点禁用时跳过两个 feature', () => {
        const disabled = createHarness({on: false, inputBoxTranslationTrigger: 'ctrl_enter', paragraphCopyEnabled: true});
        disabled.runtime.sync();
        expect(disabled.inputMount).not.toHaveBeenCalled();
        expect(disabled.paragraphMount).not.toHaveBeenCalled();

        let siteDisabled = true;
        const activation = new AbortController();
        const inputMount = vi.fn();
        const paragraphMount = vi.fn();
        const runtime = createOptionalContentFeatureRuntime({
            activationSignal: activation.signal,
            config: {on: true, inputBoxTranslationTrigger: 'ctrl_enter', paragraphCopyEnabled: true},
            isSiteDisabled: () => siteDisabled,
            inputTranslationFeature: {mount: inputMount, invalidate: vi.fn()},
            mountParagraphCopyContentFeature: paragraphMount,
        });
        runtime.sync();
        expect(inputMount).not.toHaveBeenCalled();
        expect(paragraphMount).not.toHaveBeenCalled();
        siteDisabled = false;
        runtime.sync();
        expect(inputMount).toHaveBeenCalledOnce();
        expect(paragraphMount).toHaveBeenCalledOnce();
        runtime.dispose();
    });

    it('按配置动态启停并保持每个 feature 的子 signal 独立', () => {
        const harness = createHarness({inputBoxTranslationTrigger: 'ctrl_enter', paragraphCopyEnabled: true});

        harness.runtime.sync();
        harness.runtime.sync();
        expect(harness.inputMount).toHaveBeenCalledOnce();
        expect(harness.paragraphMount).toHaveBeenCalledOnce();
        const inputSignal = harness.inputMount.mock.calls[0][0] as AbortSignal;
        const paragraphSignal = harness.paragraphMount.mock.calls[0][1] as AbortSignal;
        expect(inputSignal.aborted).toBe(false);
        expect(paragraphSignal.aborted).toBe(false);

        harness.config.inputBoxTranslationTrigger = 'disabled';
        harness.config.paragraphCopyEnabled = false;
        harness.runtime.sync();
        expect(inputSignal.aborted).toBe(true);
        expect(paragraphSignal.aborted).toBe(true);
        expect(harness.inputInvalidate).toHaveBeenCalledOnce();

        harness.runtime.sync();
        expect(harness.inputMount).toHaveBeenCalledOnce();
        expect(harness.paragraphMount).toHaveBeenCalledOnce();
    });

    it('父 activation 取消时释放子 feature，后续 sync 不会复活', () => {
        const harness = createHarness({inputBoxTranslationTrigger: 'ctrl_enter', paragraphCopyEnabled: true});
        harness.runtime.sync();
        const inputSignal = harness.inputMount.mock.calls[0][0] as AbortSignal;
        const paragraphSignal = harness.paragraphMount.mock.calls[0][1] as AbortSignal;

        harness.activation.abort();
        expect(inputSignal.aborted).toBe(true);
        expect(paragraphSignal.aborted).toBe(true);
        harness.runtime.sync();
        expect(harness.inputMount).toHaveBeenCalledOnce();
        expect(harness.paragraphMount).toHaveBeenCalledOnce();
        harness.runtime.dispose();
        harness.runtime.dispose();
        expect(harness.inputInvalidate).toHaveBeenCalledOnce();
    });

    it('输入 feature 同步挂载时父级取消，不挂载后续 paragraph feature', () => {
        const harness = createHarness({inputBoxTranslationTrigger: 'ctrl_enter', paragraphCopyEnabled: true});
        harness.inputMount.mockImplementation(() => harness.activation.abort());

        harness.runtime.sync();

        expect(harness.inputMount).toHaveBeenCalledOnce();
        expect(harness.paragraphMount).not.toHaveBeenCalled();
        harness.runtime.dispose();
    });

    it('父 signal 已取消时 sync 安全跳过，dispose 仍幂等', () => {
        const harness = createHarness({inputBoxTranslationTrigger: 'ctrl_enter', paragraphCopyEnabled: true});
        harness.activation.abort();

        harness.runtime.sync();
        harness.runtime.dispose();
        harness.runtime.dispose();

        expect(harness.inputMount).not.toHaveBeenCalled();
        expect(harness.paragraphMount).not.toHaveBeenCalled();
        expect(harness.inputInvalidate).toHaveBeenCalledOnce();
    });
});
