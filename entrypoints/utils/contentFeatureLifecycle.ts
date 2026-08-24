export interface EnsureContentFeatureMountedOptions {
    mount: () => unknown | PromiseLike<unknown>;
    isMounted: () => boolean;
    isStillDesired: () => boolean;
}

/**
 * A restored activation can initially receive the mounting promise from the
 * activation that was just disabled. Once that stale promise settles, retry
 * exactly once when the new activation still wants the feature and no host was
 * mounted. Individual mount helpers retain ownership of their own request IDs.
 */
export async function ensureContentFeatureMounted(options: EnsureContentFeatureMountedOptions): Promise<void> {
    await options.mount();
    if (!options.isStillDesired() || options.isMounted()) return;
    await options.mount();
}
