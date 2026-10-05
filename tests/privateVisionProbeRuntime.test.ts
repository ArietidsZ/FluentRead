import {beforeEach, describe, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({translate: vi.fn(), load: vi.fn(async () => []), save: vi.fn(async () => {})}));
vi.mock('@/src/app/translation/runtime', () => ({translateWithCache: mocks.translate}));
vi.mock('@/src/platform/storage/visionProbeStorage', () => ({visionProbeStorage: {load: mocks.load, save: mocks.save}}));
import {Config} from '@/src/core/config/model';
import {isPrivateTranslationContext} from '@/src/services/translation/privateContext';
import {modelVisionProbe, privateModelVisionProbe} from '@/src/app/translation/visionProbeRuntime';
beforeEach(() => {mocks.translate.mockReset(); mocks.load.mockClear(); mocks.save.mockClear();});
describe('private automatic vision probe composition', () => {
    it('keeps synthetic private probes outside normal persistent cache and usage context', async () => {
        const config = new Config(); config.model.openai = 'future-private-vision';
        mocks.translate.mockRejectedValue({imageInputUnsupported: true});
        await expect(privateModelVisionProbe.resolve(config, 'openai', 'future-private-vision', {force: true})).resolves.toMatchObject({capability: 'unsupported'});
        expect(isPrivateTranslationContext(mocks.translate.mock.calls[0][0])).toBe(true);
        expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
        // The same normal-window probe cannot reuse the private result.
        mocks.translate.mockResolvedValue('UNKNOWN');
        await modelVisionProbe.resolve(config, 'openai', 'future-private-vision', {probeUnknown: true});
        expect(mocks.translate).toHaveBeenCalledTimes(2);
        expect(isPrivateTranslationContext(mocks.translate.mock.calls[1][0])).toBe(false);
        expect(mocks.load).toHaveBeenCalledOnce(); expect(mocks.save).toHaveBeenCalledOnce();
    });
});
