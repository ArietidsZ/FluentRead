import { describe, expect, it, vi } from 'vitest';

import { ensureContentFeatureMounted } from '@/entrypoints/utils/contentFeatureLifecycle';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
    return {promise, resolve};
}

describe('content feature activation lifecycle', () => {
    it('retries after a restored activation reused the disabled activation pending mount', async () => {
        const staleMount = deferred<void>();
        let mounted = false;
        let callCount = 0;
        const mount = vi.fn(() => {
            callCount += 1;
            if (callCount === 1) return staleMount.promise;
            mounted = true;
            return Promise.resolve();
        });

        const activation = ensureContentFeatureMounted({
            mount,
            isMounted: () => mounted,
            isStillDesired: () => true,
        });
        staleMount.resolve();
        await activation;

        expect(mount).toHaveBeenCalledTimes(2);
        expect(mounted).toBe(true);
    });

    it('does not retry a settled mount after the activation was disabled again', async () => {
        const staleMount = deferred<void>();
        let desired = true;
        const mount = vi.fn(() => staleMount.promise);

        const activation = ensureContentFeatureMounted({
            mount,
            isMounted: () => false,
            isStillDesired: () => desired,
        });
        desired = false;
        staleMount.resolve();
        await activation;

        expect(mount).toHaveBeenCalledTimes(1);
    });
});
