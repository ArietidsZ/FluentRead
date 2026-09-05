import {describe, expect, it, vi} from 'vitest';
import {getFullPageTranslationStateRevision, notifyFullPageTranslationState} from '@/src/features/full-page-translation/content/stateNotification';

const install = (value: Record<string, unknown> | undefined) => {if (value === undefined) delete (globalThis as Record<string, unknown>).browser; else (globalThis as Record<string, unknown>).browser = value;};
describe('full-page state notification', () => {
    it('increments private revision before dispatch and sends started/ended messages', async () => {
        const dispatch = vi.fn(); const Custom = vi.fn(function(this: unknown, type: string) {return {type};}); const previous = (globalThis as Record<string, unknown>).document;
        (globalThis as Record<string, unknown>).document = {dispatchEvent: dispatch, defaultView: {CustomEvent: Custom}};
        const sendMessage = vi.fn(async () => undefined); install({runtime: {sendMessage}});
        const before = getFullPageTranslationStateRevision(); notifyFullPageTranslationState(true); expect(getFullPageTranslationStateRevision()).toBe(before + 1); expect(Custom).toHaveBeenCalledWith('fluentread-translation-started'); expect(dispatch).toHaveBeenCalled(); expect(sendMessage).toHaveBeenCalledWith({type: 'fullPageTranslationState', isTranslated: true});
        notifyFullPageTranslationState(false); expect(Custom).toHaveBeenLastCalledWith('fluentread-translation-ended'); expect(sendMessage).toHaveBeenLastCalledWith({type: 'fullPageTranslationState', isTranslated: false}); (globalThis as Record<string, unknown>).document = previous;
    });
    it('uses global CustomEvent, skips when document cannot dispatch, and tolerates browser failures', async () => {
        const previousDocument = (globalThis as Record<string, unknown>).document; const previousCustom = (globalThis as Record<string, unknown>).CustomEvent;
        const dispatch = vi.fn(); const Custom = vi.fn(function(this: unknown, type: string) {return {type};}); (globalThis as Record<string, unknown>).document = {dispatchEvent: dispatch}; (globalThis as Record<string, unknown>).CustomEvent = Custom;
        install({runtime: {sendMessage: vi.fn(() => Promise.reject(new Error('reload')))}}); notifyFullPageTranslationState(true); expect(Custom).toHaveBeenCalled();
        (globalThis as Record<string, unknown>).document = {}; install({runtime: {sendMessage: vi.fn(() => {throw new Error('invalidated');})}}); expect(() => notifyFullPageTranslationState(false)).not.toThrow();
        (globalThis as Record<string, unknown>).document = previousDocument; if (previousCustom === undefined) delete (globalThis as Record<string, unknown>).CustomEvent; else (globalThis as Record<string, unknown>).CustomEvent = previousCustom; install(undefined);
    });
    it('falls back to the global CustomEvent when document.defaultView has none', () => {
        const previousDocument = (globalThis as Record<string, unknown>).document; const previousCustom = (globalThis as Record<string, unknown>).CustomEvent;
        const dispatch = vi.fn(); const Custom = vi.fn(function(this: unknown, type: string) {return {type};});
        (globalThis as Record<string, unknown>).document = {dispatchEvent: dispatch, defaultView: {CustomEvent: undefined}}; (globalThis as Record<string, unknown>).CustomEvent = Custom; install(undefined);
        notifyFullPageTranslationState(true); expect(Custom).toHaveBeenCalledWith('fluentread-translation-started'); expect(dispatch).toHaveBeenCalled();
        (globalThis as Record<string, unknown>).document = previousDocument; if (previousCustom === undefined) delete (globalThis as Record<string, unknown>).CustomEvent; else (globalThis as Record<string, unknown>).CustomEvent = previousCustom;
    });
    it('skips dispatch when neither document nor global supplies CustomEvent', () => {
        const previousDocument = (globalThis as Record<string, unknown>).document; const previousCustom = (globalThis as Record<string, unknown>).CustomEvent;
        const dispatch = vi.fn(); (globalThis as Record<string, unknown>).document = {dispatchEvent: dispatch, defaultView: {CustomEvent: undefined}}; delete (globalThis as Record<string, unknown>).CustomEvent; install(undefined);
        expect(() => notifyFullPageTranslationState(false)).not.toThrow(); expect(dispatch).not.toHaveBeenCalled();
        (globalThis as Record<string, unknown>).document = previousDocument; if (previousCustom !== undefined) (globalThis as Record<string, unknown>).CustomEvent = previousCustom;
    });
    it('handles missing browser/runtime and a rejected promise without unhandled errors', () => {const previous = (globalThis as Record<string, unknown>).document; (globalThis as Record<string, unknown>).document = undefined; install(undefined); expect(() => notifyFullPageTranslationState(true)).not.toThrow(); install({}); expect(() => notifyFullPageTranslationState(false)).not.toThrow(); (globalThis as Record<string, unknown>).document = previous;});
});
