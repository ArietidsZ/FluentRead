export interface UserscriptContentContext {
    readonly isInvalid: boolean;
    onInvalidated(callback: () => void): void;
    invalidate(): void;
}

export function createUserscriptContentContext(): UserscriptContentContext {
    const callbacks = new Set<() => void>();
    let invalid = false;
    return {
        get isInvalid() {
            return invalid;
        },
        onInvalidated(callback) {
            if (invalid) callback();
            else callbacks.add(callback);
        },
        invalidate() {
            if (invalid) return;
            invalid = true;
            callbacks.forEach((callback) => callback());
            callbacks.clear();
        },
    };
}

