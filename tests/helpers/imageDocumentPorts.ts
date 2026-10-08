import {vi} from 'vitest';
import {IMAGE_DOCUMENT_PORT, type DocumentPort} from '@/src/features/image-translation/documentChannel';
export function portEvent<T extends (...args: any[]) => void>() {
    const listeners = new Set<T>();
    return {listeners, addListener: vi.fn((listener: T) => listeners.add(listener)), removeListener: vi.fn((listener: T) => listeners.delete(listener)),
        emit: (...args: Parameters<T>) => {for (const listener of [...listeners]) listener(...args);}};
}
export function documentPortPair(sender: DocumentPort['sender'] = {id: 'extension', tab: {id: 1, windowId: 2}, frameId: 0, url: 'https://example.test/same'}) {
    const a = portEvent<(packet: any) => void>(); const b = portEvent<(packet: any) => void>();
    const ad = portEvent<() => void>(); const bd = portEvent<() => void>(); let connected = true;
    const close = (notify = true) => {connected = false; if (notify) {ad.emit(); bd.emit();}};
    const port = (event: typeof a, other: typeof a, disconnect: typeof ad, owner?: DocumentPort['sender']): DocumentPort => ({
        name: IMAGE_DOCUMENT_PORT, sender: owner, onMessage: event, onDisconnect: disconnect,
        postMessage: vi.fn(packet => {if (!connected) throw new Error('message port closed'); queueMicrotask(() => other.emit(packet));}),
        disconnect: vi.fn(() => close()),
    });
    return {client: port(a, b, ad), background: port(b, a, bd, sender), clientMessages: a, backgroundMessages: b,
        close, notifyDisconnect: () => {ad.emit(); bd.emit();}};
}
/** 旧客户端行为测试的离线后台桥：保留业务 spy，并用真正的新客户端 Port 协议传输。 */
export function clientRuntimePorts(sendMessage: (...args: any[]) => any, progress = new Set<(message: any) => void>()) {
    const pairs: ReturnType<typeof documentPortPair>[] = [];
    const connect = vi.fn(() => {
        const pair = documentPortPair(); pairs.push(pair);
        const relays = new Map<string, (message: any) => void>();
        pair.background.onMessage.addListener(packet => {
            if (packet.kind !== 'request') return;
            const {message, rpcId} = packet;
            if (/Cancel$/u.test(message.type)) {
                const old = relays.get(message.requestId); if (old) progress.delete(old); relays.delete(message.requestId);
            } else {
                const relay = (value: any) => pair.background.postMessage({kind: 'progress', message: value});
                relays.set(message.requestId, relay); progress.add(relay);
            }
            let result: any;
            try {result = sendMessage(message);} catch (error) {result = Promise.reject(error);}
            void Promise.resolve(result).then(response => {
                const relay = relays.get(message.requestId); if (relay) progress.delete(relay); relays.delete(message.requestId);
                try {pair.background.postMessage({kind: 'result', rpcId, response});} catch { /* 已换文档。 */ }
            }, error => {
                const relay = relays.get(message.requestId); if (relay) progress.delete(relay); relays.delete(message.requestId);
                try {pair.background.postMessage({kind: 'result', rpcId, response: {success: false, error: error.message, errorName: error.name}});} catch { /* 已换文档。 */ }
            });
        });
        pair.background.onDisconnect.addListener(() => {for (const relay of relays.values()) progress.delete(relay); relays.clear();});
        return pair.client;
    });
    return {connect, pairs};
}
