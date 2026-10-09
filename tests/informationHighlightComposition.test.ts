import {afterEach, describe, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({status: vi.fn(), prepare: vi.fn(), pause: vi.fn(), remove: vi.fn(), score: vi.fn(), translation: vi.fn(() => [{type: 'translation', handle: vi.fn()}]), tts: vi.fn(() => [{type: 'tts', handle: vi.fn()}])}));
vi.mock('@/src/features/information-highlight/background/offscreenAdapter', () => ({createInformationHighlightOffscreenAdapter: () => mocks}));
vi.mock('@/src/features/local-translation/background/runtime', () => ({createLocalTranslationBackgroundRuntime: mocks.translation}));
vi.mock('@/src/features/local-tts/background/runtime', () => ({createLocalTtsBackgroundRuntime: mocks.tts}));
import {createInformationHighlightBackgroundRuntime} from '@/src/features/information-highlight/background/runtime';
import {createLocalModelMessageHandlers} from '@/src/app/background/localModelMessageRuntime';

afterEach(() => {vi.unstubAllGlobals(); vi.clearAllMocks();});
describe('information highlight background composition', () => {
    it('uses current extension URLs for management and document scoring, including their query/hash', async () => {
        vi.stubGlobal('browser', {runtime: {id: 'id', getURL: (path: string) => `chrome-extension://id${path}`}});
        mocks.prepare.mockResolvedValue({phase: 'ready'}); mocks.score.mockResolvedValue({spans: [], engine: 'local'});
        const handlers = createInformationHighlightBackgroundRuntime();
        const send = (type: string, url: string, payload = {}) => handlers.find(handler => handler.type === type)!.handle({type, ...payload}, {sender: {id: 'id', url}});
        for (const url of ['chrome-extension://id/options.html?source=menu', 'chrome-extension://id/popup.html#settings']) expect(await send('PREPARE_INFORMATION_HIGHLIGHT_MODEL', url)).toMatchObject({success: true});
        await expect(send('PREPARE_INFORMATION_HIGHLIGHT_MODEL', 'chrome-extension://id/document.html')).rejects.toThrow('UNTRUSTED');
        expect(await send('SCORE_INFORMATION_HIGHLIGHT', 'chrome-extension://id/document.html?pdf=1', {requestId: '01234567-0123-4123-8123-012345678901', text: 'x'})).toEqual({success: true, result: {spans: [], engine: 'local'}});
        await expect(send('SCORE_INFORMATION_HIGHLIGHT', 'chrome-extension://id/popup.html', {requestId: '01234567-0123-4123-8123-012345678901', text: 'x'})).rejects.toThrow('INVALID_REQUEST');
        const localHandlers = createLocalModelMessageHandlers();
        expect(localHandlers.map(handler => handler.type)).toEqual(['translation', ...handlers.map(handler => handler.type), 'tts']);
        expect(mocks.translation).toHaveBeenCalledOnce(); expect(mocks.tts).toHaveBeenCalledOnce();
    });
});
