import {describe, expect, it, vi} from 'vitest';
import {createTranslationRequestRegistry} from '@/src/services/translation/requestRegistry';

const missingDocument = {sender: {id: 'extension', tab: {id: 11, incognito: false}, frameId: 0, url: 'https://example.test/same'}};
describe('native translation document lifetime', () => {
    it('required document ownership rejects frame-only start before provider preparation', async () => {
        const registry = createTranslationRequestRegistry(true);
        const operation = vi.fn(async () => 'unexpected provider start');
        await expect(registry.run('same-id', missingDocument, operation)).rejects.toThrow('文档');
        expect(operation).not.toHaveBeenCalled();
    });
    it('client document strings and boolean fields cannot grant a missing native document identity', async () => {
        const registry = createTranslationRequestRegistry(true);
        const operation = vi.fn(async () => 'unexpected provider start');
        const forged = {...missingDocument, documentId: 'client-nonce', documentConnected: true};
        await expect(registry.run('same-id', forged, operation)).rejects.toThrow('文档');
        expect(operation).not.toHaveBeenCalled();
    });
});
