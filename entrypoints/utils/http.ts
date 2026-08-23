/**
 * Runtime-selectable HTTP transport.
 *
 * Browser-extension builds keep using the native Fetch API. Alternate runtimes
 * (notably the userscript build) can install a fetch-compatible transport
 * before any provider request is dispatched, without duplicating provider
 * adapters or weakening the extension's network behavior.
 */
export type RuntimeFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const nativeFetch: RuntimeFetch = (input, init) => globalThis.fetch(input, init);
let activeFetch: RuntimeFetch = nativeFetch;

export function setRuntimeFetch(nextFetch?: RuntimeFetch): void {
    activeFetch = nextFetch || nativeFetch;
}

export function runtimeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return activeFetch(input, init);
}
