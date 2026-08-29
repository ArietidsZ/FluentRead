/**
 * @file src/services/config/store.ts
 *
 * 文件职责：协调 FluentRead 配置、凭据与历史记录在后台加密配置仓库中的读取、订阅、保存和并发持久化。
 * 主要内容：维护 config 响应式状态和监听器，区分公开配置与会话/持久凭据，序列化 persist/history 消息，处理 debounce、revision 冲突、旧存储迁移及 undo/redo 请求。 可核对的公开符号包括 CONFIG_STORAGE_KEY、CONFIG_HISTORY_STORAGE_KEY、CONFIG_PERSIST_MESSAGE、CONFIG_HISTORY_MESSAGE、config、flushConfigHistory、configReady、configHistoryReady。
 * 模块边界：本文件位于配置 application service 层，可协调 core 规则与浏览器存储端口；不包含设置页面组件，也不实现具体翻译供应商协议，调用方应通过公开服务 API 订阅或提交配置。
 */

import {configStorage as storage} from '@/src/platform/storage/configStorageRuntime';
import { Config, normalizeConfig } from '@/src/core/config/model';
import {
    LOCAL_CREDENTIALS_STORAGE_KEY,
    SESSION_CREDENTIALS_STORAGE_KEY,
    credentialsEqual,
    extractConfigCredentials,
    hasCredentialData,
    hasCredentialFields,
    mergeConfigCredentials,
    parseStoredCredentials,
    sanitizeConfigCredentials,
    sanitizeConfigHistoryCredentials,
    type ConfigCredentials,
} from '@/src/core/config/credentials';
import {isTrustedCredentialStorageContext} from '@/src/platform/storage/credentialContext';
import {
    CONFIG_HISTORY_LIMIT,
    appendConfigHistorySnapshot,
    cloneConfigHistory,
    createBaselineConfigHistory,
    parseConfigHistory,
    restoreRestorableConfig,
    resolveConfigHistoryTargetIndex,
    serializeConfigHistory,
    toPublicConfig,
    toRestorableConfig,
    type ConfigHistoryAction,
    type ConfigHistoryState,
    type RestorableConfig,
} from './history';
import {
    CONFIG_REVISION_FIELD,
    getStoredConfigRevision,
    isConfigRecord,
    parseStoredConfig,
    serializeConfig,
} from './schema';
import {
    CONFIG_COUNT_INCREMENT_MESSAGE,
    parseConfigCountIncrement,
    parseConfigCountOperationId,
} from './count';

export {CONFIG_HISTORY_LIMIT, parseStoredConfig, serializeConfig};
export type {ConfigHistoryAction, ConfigHistoryEntry, ConfigHistoryState} from './history';

export const CONFIG_STORAGE_KEY = 'local:config' as const;
export const CONFIG_HISTORY_STORAGE_KEY = 'local:configHistory' as const;
export const CONFIG_PERSIST_MESSAGE = 'persistConfig' as const;
export const CONFIG_HISTORY_MESSAGE = 'configHistoryAction' as const;
const CONFIG_HISTORY_DEBOUNCE_MS = 350;

type ConfigListener = (nextConfig: Config) => void;

type ConfigHistoryListener = (nextHistory: ConfigHistoryState) => void;

const listeners = new Set<ConfigListener>();
const historyListeners = new Set<ConfigHistoryListener>();
let storageRevision = 0;
let initialized = false;
let lastPersistedSerialized = '';
let writeRevision = 0;
let writeQueue: Promise<void> = Promise.resolve();
let latestRequestedSerialized = '';
let persistedConfigRevision = 0;
let requestSequence = 0;
let requestGeneration = 0;
let requestQueue: Promise<void> = Promise.resolve();
let activeRequestSerialized = '';
let hasDeferredStoredConfigChange = false;
let deferredStoredConfigChange: unknown;
const completedCountOperations = new Map<string, {delta: number; count: number}>();
const activeCountOperations = new Map<string, {delta: number; promise: Promise<number>}>();
const CONFIG_COUNT_OPERATION_CACHE_LIMIT = 1_024;
const CONFIG_COUNT_OPERATIONS_FIELD = '__fluentCountOperations' as const;
const requestClientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let historyState: ConfigHistoryState;
let historyInitialized = false;
let historyLastSerialized = '';
let historyPendingSerialized = '';
let historyWriteRevision = 0;
let historyWriteQueue: Promise<void> = Promise.resolve();
let pendingHistorySnapshot: RestorableConfig | null = null;
let pendingHistoryTimer: ReturnType<typeof setTimeout> | undefined;
let historyFlushPromise: Promise<void> | null = null;

// 所有运行时模块共享同一个可变配置对象；存储层负责把跨上下文变更同步进来。
export const config = new Config();

interface PersistedCountOperation {
    id: string;
    delta: number;
    count: number;
}

function parsePersistedCountOperations(value: unknown): PersistedCountOperation[] | null {
    const record = parseStoredConfig(value);
    const rawOperations = record?.[CONFIG_COUNT_OPERATIONS_FIELD];
    if (!Array.isArray(rawOperations)) return null;

    const operations: PersistedCountOperation[] = [];
    for (const value of rawOperations.slice(-CONFIG_COUNT_OPERATION_CACHE_LIMIT)) {
        if (!value || typeof value !== 'object') continue;
        const candidate = value as Partial<PersistedCountOperation>;
        const id = parseConfigCountOperationId(candidate.id);
        const delta = parseConfigCountIncrement(candidate.delta);
        if (!id || delta === null || !Number.isSafeInteger(candidate.count) || Number(candidate.count) < delta) continue;
        operations.push({id, delta, count: Number(candidate.count)});
    }
    return operations;
}

function replaceCompletedCountOperations(operations: PersistedCountOperation[], maximumCount: number): void {
    completedCountOperations.clear();
    for (const operation of operations) {
        if (operation.count <= maximumCount) {
            completedCountOperations.set(operation.id, {delta: operation.delta, count: operation.count});
        }
    }
}

function getPersistedCountOperations(nextOperation?: PersistedCountOperation): PersistedCountOperation[] {
    const operations = [...completedCountOperations].map(([id, value]) => ({id, ...value}));
    if (nextOperation) {
        const existingIndex = operations.findIndex((operation) => operation.id === nextOperation.id);
        if (existingIndex >= 0) operations.splice(existingIndex, 1);
        operations.push(nextOperation);
    }
    return operations.slice(-CONFIG_COUNT_OPERATION_CACHE_LIMIT);
}

function createStoredConfigRecord(
    nextConfig: Config,
    revision: number,
    countOperations = getPersistedCountOperations(),
): Record<string, unknown> {
    return {
        ...toPublicConfig(nextConfig),
        [CONFIG_REVISION_FIELD]: revision,
        ...(trustedCredentialStorageContext && countOperations.length > 0
            ? {[CONFIG_COUNT_OPERATIONS_FIELD]: countOperations}
            : {}),
    };
}

function notifyHistoryListeners(): void {
    if (!historyState) return;
    const snapshot = cloneConfigHistory(historyState);
    historyListeners.forEach((listener) => listener(snapshot));
}

function setHistoryState(nextHistory: ConfigHistoryState, notify = true): void {
    historyState = cloneConfigHistory(nextHistory);
    historyLastSerialized = serializeConfigHistory(historyState);
    if (notify) notifyHistoryListeners();
}

function handleStoredHistoryChange(value: unknown): void {
    const parsed = parseConfigHistory(value);
    if (!parsed) return;
    const serialized = serializeConfigHistory(parsed);
    if (serialized === historyLastSerialized) return;
    // 步骤 1：写队列处理中只接收最新请求的回声，避免较慢的旧写入覆盖新快照。
    if (historyPendingSerialized && serialized !== historyPendingSerialized) return;

    // 步骤 2：外部上下文没有与本地写入竞争时，立即同步历史游标和订阅者。
    setHistoryState(parsed);
}

async function queueHistoryWrite(nextHistory: ConfigHistoryState): Promise<void> {
    const sanitizedHistory = cloneConfigHistory(nextHistory);
    const serialized = serializeConfigHistory(sanitizedHistory);
    if (!historyPendingSerialized && serialized === historyLastSerialized) return;
    if (serialized === historyPendingSerialized) return;

    historyPendingSerialized = serialized;
    const revision = ++historyWriteRevision;
    historyWriteQueue = historyWriteQueue
        .catch(() => undefined)
        .then(async () => {
            // 步骤 1：队列轮到当前写入时再次执行最后写入者优先检查。
            if (revision !== historyWriteRevision || historyPendingSerialized !== serialized) return;
            await storage.setItem<ConfigHistoryState>(CONFIG_HISTORY_STORAGE_KEY, sanitizedHistory);

            // 步骤 2：storage.setItem 期间可能产生更新请求；旧写入完成后不能回滚内存状态。
            if (revision !== historyWriteRevision || historyPendingSerialized !== serialized) return;
            setHistoryState(sanitizedHistory);
            historyPendingSerialized = '';
        });
    try {
        await historyWriteQueue;
    } catch (error) {
        if (revision === historyWriteRevision && historyPendingSerialized === serialized) {
            historyPendingSerialized = '';
        }
        throw error;
    }
}

async function initializeConfigHistory(): Promise<void> {
    try {
        await configReady;
        const storedHistory = await storage.getItem<unknown>(CONFIG_HISTORY_STORAGE_KEY);
        const parsed = parseConfigHistory(storedHistory);
        historyInitialized = true;
        if (parsed) {
            setHistoryState(parsed);
            // 旧历史可能仍含统计、安全开关或内部迁移字段；读取时立即迁移为
            // 可恢复投影，避免这些字段继续占用存储或在其他上下文中泄漏出来。
            if (serializeConfig(storedHistory) !== serializeConfig(parsed)) {
                try {
                    await storage.setItem<ConfigHistoryState>(CONFIG_HISTORY_STORAGE_KEY, parsed);
                } catch (error) {
                    console.warn('[FluentRead] 配置历史可恢复投影迁移暂未落盘', error);
                }
            }
        } else {
            setHistoryState(createBaselineConfigHistory(config, persistedConfigRevision), false);
        }
    } catch (error) {
        historyInitialized = true;
        setHistoryState(createBaselineConfigHistory(config, persistedConfigRevision), false);
        console.error('[FluentRead] 配置历史读取失败，使用当前配置快照', error);
    }
}

async function appendHistorySnapshotNow(value: unknown): Promise<void> {
    await configHistoryReady;
    const nextHistory = appendConfigHistorySnapshot(historyState, value);
    if (!nextHistory) return;
    await queueHistoryWrite(nextHistory);
}

function takePendingHistorySnapshot(): RestorableConfig | null {
    if (pendingHistoryTimer) clearTimeout(pendingHistoryTimer);
    pendingHistoryTimer = undefined;
    const snapshot = pendingHistorySnapshot;
    pendingHistorySnapshot = null;
    return snapshot;
}

function flushHistorySnapshot(snapshot: RestorableConfig): Promise<void> {
    // 步骤 1：每次追加都等待前一个追加完成，确保它读取到已提交的游标与 nextVersion。
    const previous = historyFlushPromise;
    const current = (previous ? previous.catch(() => undefined) : Promise.resolve())
        .then(() => appendHistorySnapshotNow(snapshot));
    historyFlushPromise = current;

    // 步骤 2：只有队尾任务可以清空引用；较早任务结束不能让调用方漏等后续快照。
    const clearIfCurrent = () => {
        if (historyFlushPromise === current) historyFlushPromise = null;
    };
    void current.then(clearIfCurrent, clearIfCurrent);
    void current.catch((error) => console.error('[FluentRead] 配置历史保存失败', error));
    return current;
}

function scheduleHistorySnapshot(value: unknown): void {
    pendingHistorySnapshot = toRestorableConfig(value);
    if (pendingHistoryTimer) clearTimeout(pendingHistoryTimer);
    pendingHistoryTimer = setTimeout(() => {
        const snapshot = takePendingHistorySnapshot();
        if (snapshot) flushHistorySnapshot(snapshot);
    }, CONFIG_HISTORY_DEBOUNCE_MS);
}

export async function flushConfigHistory(): Promise<void> {
    const snapshot = takePendingHistorySnapshot();
    let current = snapshot ? flushHistorySnapshot(snapshot) : historyFlushPromise;
    while (current) {
        await current;
        current = historyFlushPromise === current ? null : historyFlushPromise;
    }
}

function notifyListeners(nextConfig: Config): void {
    const snapshot = normalizeConfig(nextConfig);
    listeners.forEach((listener) => listener(snapshot));
}

function applyConfig(nextConfig: Config): void {
    Object.assign(config, nextConfig);
    notifyListeners(config);
}

const trustedCredentialStorageContext = isTrustedCredentialStorageContext();
const configStorageWriteOwner = storage.writeOwner !== false;
let credentialCleanupRequired = false;
let localCredentialSnapshotPresent = false;
let sessionCredentialWatchRegistered = false;
let sessionCredentialStorageAvailable = false;
let configStorageWritesBlocked = false;

function assertConfigStorageWritesAllowed(): void {
    if (!configStorageWriteOwner) {
        throw new Error('当前上下文必须通过后台配置协议保存');
    }
    if (configStorageWritesBlocked) {
        throw new Error('配置安全迁移未完成，暂不写入存储；请重新加载扩展后重试');
    }
}

async function writeAndVerifyCredentials(
    key: typeof SESSION_CREDENTIALS_STORAGE_KEY | typeof LOCAL_CREDENTIALS_STORAGE_KEY,
    credentials: ConfigCredentials,
): Promise<void> {
    await storage.setItem<ConfigCredentials>(key, credentials);
    await verifyStoredCredentials(key, credentials);
}

async function verifyStoredCredentials(
    key: typeof SESSION_CREDENTIALS_STORAGE_KEY | typeof LOCAL_CREDENTIALS_STORAGE_KEY,
    credentials: ConfigCredentials,
): Promise<void> {
    const verified = parseStoredCredentials(await storage.getItem<unknown>(key));
    if (!verified || !credentialsEqual(credentials, verified)) {
        throw new Error(`${key} 凭据写入校验失败`);
    }
    if (key === SESSION_CREDENTIALS_STORAGE_KEY) sessionCredentialStorageAvailable = true;
}

async function sanitizeStoredHistory(rawHistory?: unknown): Promise<void> {
    const storedHistory = arguments.length > 0
        ? rawHistory
        : await storage.getItem<unknown>(CONFIG_HISTORY_STORAGE_KEY);
    if (storedHistory === null || storedHistory === undefined) return;
    const sanitized = sanitizeConfigHistoryCredentials(storedHistory);
    if (serializeConfig(storedHistory) === serializeConfig(sanitized)) return;
    if (sanitized === null) {
        await storage.removeItem(CONFIG_HISTORY_STORAGE_KEY);
        return;
    }
    await storage.setItem(CONFIG_HISTORY_STORAGE_KEY, sanitized);
}

function queueStorageWrite(nextConfig: Config, serialized: string, revision: number): Promise<void> {
    writeQueue = writeQueue
        .catch(() => undefined)
        .then(async () => {
            // 只写最后一次快照，避免连续输入或多个页面初始化时排队回写旧配置。
            if (revision !== writeRevision || lastPersistedSerialized !== serialized) return;
            assertConfigStorageWritesAllowed();
            try {
                // revision 代表已经成功提交到 local:config 的版本，不能在写入前发布。
                // 若 storage 暂时失败，下一次保存仍应从原版本继续，而不是永久冲突。
                const storedRevision = persistedConfigRevision + 1;
                if (!trustedCredentialStorageContext) {
                    // userscript 和扩展 content script 可以持久化公开配置，但无法访问
                    // 扩展专属的 session 凭据存储。兜底写入前，toPublicConfig 会移除凭据。
                    await storage.setItem(CONFIG_STORAGE_KEY, createStoredConfigRecord(nextConfig, storedRevision));
                    persistedConfigRevision = Math.max(persistedConfigRevision, storedRevision);
                    return;
                }

                const credentials = extractConfigCredentials(nextConfig);
                const mustCheckpointCredentials = hasCredentialData(credentials)
                    || credentialCleanupRequired
                    || localCredentialSnapshotPresent
                    || sessionCredentialStorageAvailable
                    || nextConfig.persistCredentials;

                if (storage.setItems) {
                    const entries = new Map<string, unknown>();
                    const removeKeys: string[] = [];
                    if (mustCheckpointCredentials) entries.set(SESSION_CREDENTIALS_STORAGE_KEY, credentials);
                    if (nextConfig.persistCredentials) entries.set(LOCAL_CREDENTIALS_STORAGE_KEY, credentials);
                    entries.set(CONFIG_STORAGE_KEY, createStoredConfigRecord(nextConfig, storedRevision));

                    const shouldCleanupLocalCredentials = !nextConfig.persistCredentials
                        && (credentialCleanupRequired || localCredentialSnapshotPresent);
                    if (shouldCleanupLocalCredentials) {
                        const storedHistory = await storage.getItem<unknown>(CONFIG_HISTORY_STORAGE_KEY);
                        if (storedHistory !== null && storedHistory !== undefined) {
                            const sanitized = sanitizeConfigHistoryCredentials(storedHistory);
                            if (serializeConfig(storedHistory) !== serializeConfig(sanitized)) {
                                if (sanitized === null) removeKeys.push(CONFIG_HISTORY_STORAGE_KEY);
                                else entries.set(CONFIG_HISTORY_STORAGE_KEY, sanitized);
                            }
                        }
                        removeKeys.push(LOCAL_CREDENTIALS_STORAGE_KEY);
                    }

                    await storage.setItems(entries, removeKeys);
                    if (mustCheckpointCredentials) {
                        await verifyStoredCredentials(SESSION_CREDENTIALS_STORAGE_KEY, credentials);
                    }
                    if (nextConfig.persistCredentials) {
                        await verifyStoredCredentials(LOCAL_CREDENTIALS_STORAGE_KEY, credentials);
                        localCredentialSnapshotPresent = true;
                    }
                    persistedConfigRevision = Math.max(persistedConfigRevision, storedRevision);
                    if (shouldCleanupLocalCredentials) {
                        credentialCleanupRequired = false;
                        localCredentialSnapshotPresent = false;
                    }
                    return;
                }

                if (mustCheckpointCredentials) {
                    await writeAndVerifyCredentials(SESSION_CREDENTIALS_STORAGE_KEY, credentials);
                }
                if (nextConfig.persistCredentials) {
                    await writeAndVerifyCredentials(LOCAL_CREDENTIALS_STORAGE_KEY, credentials);
                    localCredentialSnapshotPresent = true;
                }

                await storage.setItem(CONFIG_STORAGE_KEY, createStoredConfigRecord(nextConfig, storedRevision));
                persistedConfigRevision = Math.max(persistedConfigRevision, storedRevision);

                if (!nextConfig.persistCredentials && (credentialCleanupRequired || localCredentialSnapshotPresent)) {
                    // 先保证 session 中有已读回确认的快照，并清理历史泄漏，再删除本地凭据。
                    await sanitizeStoredHistory();
                    await storage.removeItem(LOCAL_CREDENTIALS_STORAGE_KEY);
                    credentialCleanupRequired = false;
                    localCredentialSnapshotPresent = false;
                }
            } catch (error) {
                if (lastPersistedSerialized === serialized) lastPersistedSerialized = '';
                throw error;
            }
        });
    return writeQueue;
}

async function persistNormalizedConfig(nextConfig: Config, serialized = serializeConfig(nextConfig)): Promise<void> {
    if (serialized === lastPersistedSerialized) return;

    lastPersistedSerialized = serialized;
    const revision = ++writeRevision;
    await queueStorageWrite(nextConfig, serialized, revision);
}

interface StoredConfigChangeOptions {
    confirmedRequestRevision?: number;
    confirmedRequestSerialized?: string;
}

function takeDeferredStoredConfigChange(): {hasValue: boolean; value: unknown} {
    const result = {hasValue: hasDeferredStoredConfigChange, value: deferredStoredConfigChange};
    hasDeferredStoredConfigChange = false;
    deferredStoredConfigChange = undefined;
    return result;
}

function handleStoredConfigChange(value: unknown, options: StoredConfigChangeOptions = {}): void {
    storageRevision += 1;
    const parsed = parseStoredConfig(value);
    if (!parsed) return;

    const normalized = normalizeConfig(mergeConfigCredentials(parsed, extractConfigCredentials(config)));
    const serialized = serializeConfig(normalized);
    const storedRevision = getStoredConfigRevision(parsed);
    if (storedRevision && storedRevision < persistedConfigRevision) return;
    const revisionAdvanced = storedRevision > persistedConfigRevision;
    const isConfirmedRequestEcho = options.confirmedRequestRevision === storedRevision
        && Boolean(options.confirmedRequestSerialized);

    // runtime 消息的 storage 回声可能早于响应，并且后台会保留 count、凭据等
    // canonical 字段，因此不能靠整份 serialized 猜测归属。先暂存，收到响应
    // revision 后再判断它是本次提交还是更新的外部恢复。
    if (revisionAdvanced && activeRequestSerialized && !isConfirmedRequestEcho) {
        hasDeferredStoredConfigChange = true;
        deferredStoredConfigChange = value;
        return;
    }

    // 普通 watch 的更高 revision 不能只因内容等于 lastPersistedSerialized 就认作
    // 本地回声：session 凭据事件可能先把 last 更新成另一个页面的新状态。
    const isLocalEcho = isConfirmedRequestEcho
        || (!revisionAdvanced && serialized === lastPersistedSerialized);
    if (storedRevision) persistedConfigRevision = storedRevision;

    // 一个更高 revision 且无法归属于本页面保存请求的快照，必然来自恢复、导入
    // 或其他页面。立即采用它并取消排队的旧整份快照，不能只借用它的 revision。
    if (revisionAdvanced && !isLocalEcho && latestRequestedSerialized) {
        requestGeneration += 1;
        latestRequestedSerialized = '';
    }
    // 同一个短生命周期页面可能在极短时间内产生多个快照。storage.watch
    // 可能先回传前一个快照，不能让它覆盖页面尚未完成发送的最新快照。
    if (isConfirmedRequestEcho
        && latestRequestedSerialized
        && latestRequestedSerialized !== options.confirmedRequestSerialized) return;
    if (!isConfirmedRequestEcho
        && isLocalEcho
        && latestRequestedSerialized
        && serialized !== latestRequestedSerialized) return;
    if (!revisionAdvanced && latestRequestedSerialized && serialized !== latestRequestedSerialized) return;
    const persistedCountOperations = parsePersistedCountOperations(value);
    if (persistedCountOperations) {
        replaceCompletedCountOperations(persistedCountOperations, normalized.count);
    }
    if (serialized === lastPersistedSerialized) return;

    // 外部上下文已经产生了新快照，使尚未写入的旧快照失效。
    writeRevision += 1;
    lastPersistedSerialized = serialized;
    applyConfig(normalized);
}

// 在首次读取前注册监听，避免设置页打开期间丢失其他上下文的更新。
storage.watch(CONFIG_STORAGE_KEY, (value) => handleStoredConfigChange(value));
storage.watch(CONFIG_HISTORY_STORAGE_KEY, handleStoredHistoryChange);

function registerSessionCredentialWatch(): void {
    if (!trustedCredentialStorageContext || sessionCredentialWatchRegistered) return;
    try {
        storage.watch(SESSION_CREDENTIALS_STORAGE_KEY, (value) => {
            const nextCredentials = parseStoredCredentials(value) || extractConfigCredentials({});
            const normalized = normalizeConfig(mergeConfigCredentials(config, nextCredentials));
            const serialized = serializeConfig(normalized);
            if (serialized === serializeConfig(config)) return;
            lastPersistedSerialized = serialized;
            applyConfig(normalized);
        });
        sessionCredentialWatchRegistered = true;
    } catch (error) {
        console.warn('[FluentRead] 当前浏览器不支持 session 凭据监听', error);
    }
}

async function initializeConfig(): Promise<void> {
    let safePublicConfig: Config | null = null;
    let storedValueRevision = storageRevision;
    try {
        let storedValue: unknown = null;

        // 读取过程中若收到 storage.onChanged，重新读取一次，避免旧读结果覆盖新配置。
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const revisionAtRead = storageRevision;
            storedValue = await storage.getItem<unknown>(CONFIG_STORAGE_KEY);
            storedValueRevision = revisionAtRead;
            if (revisionAtRead === storageRevision) break;
        }

        const parsed = parseStoredConfig(storedValue);
        persistedConfigRevision = getStoredConfigRevision(storedValue);
        const publicConfig = parsed
            ? normalizeConfig(sanitizeConfigCredentials(parsed))
            : new Config();
        safePublicConfig = publicConfig;

        // 计数操作日志与公开配置同属 local:config，必须在任何凭据 I/O 前恢复。
        // 即使 session 读取、迁移或检查点失败，同一 operationId 的重试仍能保持幂等。
        const persistedCountOperations = parsePersistedCountOperations(storedValue);
        if (persistedCountOperations) {
            replaceCompletedCountOperations(persistedCountOperations, publicConfig.count);
        }

        if (!trustedCredentialStorageContext) {
            if (storedValueRevision !== storageRevision) return initializeConfig();
            // content script 的 location 属于网页 origin，且默认无权访问 storage.session。
            // 只加载公开配置，不在此上下文迁移、回写或监听凭据。
            initialized = true;
            lastPersistedSerialized = serializeConfig(publicConfig);
            applyConfig(publicConfig);
            return;
        }

        const legacyCredentials = parsed && hasCredentialFields(parsed)
            ? extractConfigCredentials(parsed)
            : null;
        const localCredentialsValue = await storage.getItem<unknown>(LOCAL_CREDENTIALS_STORAGE_KEY);
        const localCredentials = parseStoredCredentials(localCredentialsValue);
        localCredentialSnapshotPresent = localCredentials !== null;
        const rawHistory = await storage.getItem<unknown>(CONFIG_HISTORY_STORAGE_KEY);
        const sanitizedRawHistory = sanitizeConfigHistoryCredentials(rawHistory);
        const historyNeedsSanitizing = rawHistory !== null
            && rawHistory !== undefined
            && serializeConfig(rawHistory) !== serializeConfig(sanitizedRawHistory);

        let sessionCredentials: ConfigCredentials | null = null;
        let sessionReadError: unknown;
        try {
            sessionCredentials = parseStoredCredentials(
                await storage.getItem<unknown>(SESSION_CREDENTIALS_STORAGE_KEY),
            );
            // “读取到 null”只说明当前没有会话记录，不代表底层 storage.session
            // 可写；旧 Firefox 会在真正创建随机材料时才暴露 API 缺失。
            sessionCredentialStorageAvailable = sessionCredentials !== null;
        } catch (error) {
            sessionReadError = error;
        }

        // config 读完后还要等待 local/history/session 凭据。若这段水合窗口内其他
        // 页面提交了更高 revision，当前 parsed 与凭据不再属于同一个原子快照；
        // 整轮重读，禁止旧配置在新 watch 已应用后回滚 UI 并覆盖新设置。
        if (storedValueRevision !== storageRevision) return initializeConfig();

        const activeCredentials = sessionCredentials
            || localCredentials
            || legacyCredentials
            || extractConfigCredentials({});
        const normalized = parsed
            ? normalizeConfig(mergeConfigCredentials(parsed, activeCredentials))
            : normalizeConfig(mergeConfigCredentials(new Config(), activeCredentials));
        const serialized = serializeConfig(normalized);

        initialized = true;
        applyConfig(normalized);

        // popup/options/document 可以从后台读取完整凭据，但不是 IndexedDB 写入所有者。
        // 后台已经完成旧存储迁移与检查点；远程页面只水合并监听，不能再次 setItem。
        if (!configStorageWriteOwner) {
            if (sessionReadError) configStorageWritesBlocked = true;
            lastPersistedSerialized = serialized;
            registerSessionCredentialWatch();
            return;
        }

        const hasLegacyCredentialStorage = Boolean(legacyCredentials || localCredentials || historyNeedsSanitizing);
        credentialCleanupRequired = hasLegacyCredentialStorage && !normalized.persistCredentials;
        const mustCheckpointCredentials = hasCredentialData(activeCredentials) || hasLegacyCredentialStorage;

        // 凭据迁移严格先写 session 并读回。失败时不改写旧 config/history，亦不删除 local 凭据。
        if (mustCheckpointCredentials) {
            try {
                if (sessionReadError) throw sessionReadError;
                await writeAndVerifyCredentials(SESSION_CREDENTIALS_STORAGE_KEY, activeCredentials);
            } catch (error) {
                configStorageWritesBlocked = true;
                lastPersistedSerialized = serialized;
                console.warn('[FluentRead] session 凭据不可用，保留旧凭据存储以避免数据丢失', error);
                registerSessionCredentialWatch();
                return;
            }
        }

        if (!normalized.persistCredentials
            && legacyCredentials
            && hasCredentialData(legacyCredentials)
            && !localCredentials) {
            // 旧 config 的迁移可能在后续 config/history 写入时中断。先建立一个
            // 可读回的 local 临时检查点，成功清理全部旧载体后再删，避免崩溃窗口丢 Key。
            await writeAndVerifyCredentials(LOCAL_CREDENTIALS_STORAGE_KEY, activeCredentials);
            localCredentialSnapshotPresent = true;
        }
        if (normalized.persistCredentials) {
            await writeAndVerifyCredentials(LOCAL_CREDENTIALS_STORAGE_KEY, activeCredentials);
            localCredentialSnapshotPresent = true;
        }

        const nextStoredConfig = createStoredConfigRecord(normalized, persistedConfigRevision);
        const storedNeedsMigration = !isConfigRecord(storedValue)
            || typeof storedValue === 'string'
            || serializeConfig(storedValue) !== serializeConfig(nextStoredConfig);
        if (storedNeedsMigration) {
            const migratedRevision = persistedConfigRevision + 1;
            await storage.setItem(CONFIG_STORAGE_KEY, createStoredConfigRecord(normalized, migratedRevision));
            persistedConfigRevision = Math.max(persistedConfigRevision, migratedRevision);
        }
        if (historyNeedsSanitizing) await sanitizeStoredHistory(rawHistory);
        if (!normalized.persistCredentials && hasLegacyCredentialStorage) {
            await storage.removeItem(LOCAL_CREDENTIALS_STORAGE_KEY);
            credentialCleanupRequired = false;
            localCredentialSnapshotPresent = false;
        }
        lastPersistedSerialized = serialized;
        registerSessionCredentialWatch();
    } catch (error) {
        // 凭据 I/O 可能在更高 revision 的 watch 到达后失败。此时旧轮次的
        // safePublicConfig 已经过期；先用最新主记录整轮重试。若同一 I/O 继续失败，
        // 下一轮 fallback 也会基于最新公开配置，不能出现旧内容搭配新 revision。
        if (storedValueRevision !== storageRevision) return initializeConfig();
        // 在任何读取或迁移边界不确定时禁止后续覆盖 local:config；重新加载后会重新尝试水合。
        configStorageWritesBlocked = true;
        if (initialized) {
            lastPersistedSerialized = serializeConfig(config);
            console.error('[FluentRead] 配置安全迁移未完成，保留当前运行时与旧存储以便重试', error);
            return;
        }
        // local:config 已成功读取时至少保留其公开字段；凭据相关 I/O 的失败不能把计数等
        // 用户状态回滚到默认值。若连公开配置也无法读取，才使用安全默认配置。
        console.error('[FluentRead] 配置读取或安全迁移失败，保留已读取的公开配置', error);
        const fallback = safePublicConfig ?? new Config();
        initialized = true;
        lastPersistedSerialized = safePublicConfig ? serializeConfig(fallback) : '';
        applyConfig(fallback);
        // 读取失败时不做清理或迁移，避免把暂时不可用误判为“没有凭据”。
    }
}

export const configReady = initializeConfig();
export const configHistoryReady = initializeConfigHistory();

export function subscribeConfig(listener: ConfigListener): () => void {
    listeners.add(listener);
    if (initialized) listener(normalizeConfig(config));
    return () => listeners.delete(listener);
}

export function getConfigRevision(): number {
    return persistedConfigRevision;
}

/** 翻译计数只做后台原子增量，不携带可能过期的整份用户配置。 */
export async function incrementConfigCount(delta: number, operationId?: string): Promise<number> {
    const normalizedDelta = parseConfigCountIncrement(delta);
    if (normalizedDelta === null) throw new TypeError('无效的翻译计数增量');
    const normalizedOperationId = operationId === undefined ? undefined : parseConfigCountOperationId(operationId);
    if (operationId !== undefined && normalizedOperationId === null) throw new TypeError('无效的翻译计数操作标识');

    if (normalizedOperationId) {
        const completed = completedCountOperations.get(normalizedOperationId);
        if (completed) {
            if (completed.delta !== normalizedDelta) throw new Error('翻译计数操作标识与增量不一致');
            return completed.count;
        }
        const active = activeCountOperations.get(normalizedOperationId);
        if (active) {
            if (active.delta !== normalizedDelta) throw new Error('翻译计数操作标识与增量不一致');
            return active.promise;
        }
    }

    const operation = (async () => {
        await configReady;
        // 请求可能早于首次 local:config 读取完成；初始化水合后必须再次检查，
        // 否则后台重启期间的同一 operationId 仍会被重复累加。
        if (normalizedOperationId) {
            const completed = completedCountOperations.get(normalizedOperationId);
            if (completed) {
                if (completed.delta !== normalizedDelta) throw new Error('翻译计数操作标识与增量不一致');
                return {count: completed.count, persistedOperations: getPersistedCountOperations()};
            }
        }
        assertConfigStorageWritesAllowed();
        if (!Number.isSafeInteger(config.count) || config.count < 0) {
            throw new TypeError('当前翻译计数不是非负安全整数');
        }
        const nextCount = config.count + normalizedDelta;
        if (!Number.isSafeInteger(nextCount)) throw new RangeError('翻译计数超过安全整数范围');
        const nextConfig = normalizeConfig({...config, count: nextCount});
        const nextOperation = normalizedOperationId
            ? {id: normalizedOperationId, delta: normalizedDelta, count: nextConfig.count}
            : undefined;
        const persistedOperations = getPersistedCountOperations(nextOperation);
        // count 与 operationId 同属一个 storage 记录；后台在响应前退出后，新实例仍能识别已提交操作。
        await storage.setItem(
            CONFIG_STORAGE_KEY,
            createStoredConfigRecord(nextConfig, persistedConfigRevision, persistedOperations),
        );
        writeRevision += 1;
        lastPersistedSerialized = serializeConfig(nextConfig);
        applyConfig(nextConfig);
        return {count: nextConfig.count, persistedOperations};
    });
    const operationPromise = operation();
    if (!normalizedOperationId) return operationPromise.then((result) => result.count);

    const promise = operationPromise.then((result) => {
        replaceCompletedCountOperations(result.persistedOperations, result.count);
        return result.count;
    });

    activeCountOperations.set(normalizedOperationId, {delta: normalizedDelta, promise});
    try {
        return await promise;
    } finally {
        activeCountOperations.delete(normalizedOperationId);
    }
}

type ConfigCountMessageResponse = {success?: boolean; error?: string; count?: number} | undefined;
type ConfigCountMessageSender = (message: {
    type: typeof CONFIG_COUNT_INCREMENT_MESSAGE;
    delta: number;
    operationId: string;
}) => Promise<ConfigCountMessageResponse>;

export async function requestConfigCountIncrement(
    delta: number,
    sendMessage?: ConfigCountMessageSender,
    operationId?: string,
): Promise<number> {
    const normalizedDelta = parseConfigCountIncrement(delta);
    if (normalizedDelta === null) throw new TypeError('无效的翻译计数增量');
    const normalizedOperationId = parseConfigCountOperationId(operationId);
    if (normalizedOperationId === null) throw new TypeError('无效的翻译计数操作标识');
    if (!sendMessage) return incrementConfigCount(normalizedDelta, normalizedOperationId);

    const response = await sendMessage({
        type: CONFIG_COUNT_INCREMENT_MESSAGE,
        delta: normalizedDelta,
        operationId: normalizedOperationId,
    });
    if (response?.success === false) throw new Error(response.error || '翻译计数保存失败');
    if (typeof response?.count !== 'number') throw new Error('翻译计数保存没有返回结果');
    return response.count;
}

/**
 * 网页/content 发来的保存请求只能修改公开配置；凭据与持久化偏好必须由
 * popup/options 等扩展 origin 明确更新，避免无凭据的 content 快照清空后台 session。
 */
export function prepareConfigSaveRequest(
    value: unknown,
    currentValue: unknown = config,
    allowCredentialUpdates = false,
): Config {
    const currentConfig = normalizeConfig(currentValue);
    const incomingConfig = normalizeConfig(value);
    if (allowCredentialUpdates) {
        return normalizeConfig({
            ...incomingConfig,
            count: currentConfig.count,
            videoServiceDefaultMigrated: currentConfig.videoServiceDefaultMigrated,
        });
    }

    return normalizeConfig(mergeConfigCredentials({
        ...sanitizeConfigCredentials(incomingConfig),
        count: currentConfig.count,
        persistCredentials: currentConfig.persistCredentials,
        videoServiceDefaultMigrated: currentConfig.videoServiceDefaultMigrated,
    }, extractConfigCredentials(currentConfig)));
}

export function getConfigHistorySnapshot(): ConfigHistoryState {
    return cloneConfigHistory(
        historyState || createBaselineConfigHistory(config, persistedConfigRevision),
    );
}

export function subscribeConfigHistory(listener: ConfigHistoryListener): () => void {
    historyListeners.add(listener);
    if (historyInitialized && historyState) listener(cloneConfigHistory(historyState));
    return () => historyListeners.delete(listener);
}

/**
 * 配置唯一写入口。调用方可以传入编辑中的快照，也可以省略参数保存运行时配置。
 * 写入前会归一化、去重，并串行淘汰旧快照，避免设置页和 popup 互相回灌。
 */
export interface SaveConfigOptions {
    recordHistory?: boolean;
    immediateHistory?: boolean;
}

export async function saveConfig(value: unknown = config, options: SaveConfigOptions = {}): Promise<void> {
    await configReady;

    // 普通设置、导入与恢复都无权回滚统计；计数只能经专用增量协议修改。
    const normalized = normalizeConfig({...normalizeConfig(value), count: config.count});
    const serialized = serializeConfig(normalized);
    if (serializeConfig(config) !== serialized) applyConfig(normalized);
    await persistNormalizedConfig(normalized, serialized);
    if (options.recordHistory) {
        if (options.immediateHistory) {
            await flushConfigHistory();
            await flushHistorySnapshot(toRestorableConfig(normalized));
        } else {
            scheduleHistorySnapshot(normalized);
        }
    }
}

/**
 * 从 popup/options 等短生命周期页面请求后台保存配置。
 * Firefox 可能在 popup 关闭时销毁页面上下文，不能依赖页面内的异步 storage.set 完成。
 */
type ConfigMessageResponse = { success?: boolean; error?: string; revision?: number } | undefined;
type ConfigMessageSender = (message: {
    type: typeof CONFIG_PERSIST_MESSAGE;
    config: Config;
    clientId: string;
    sequence: number;
    baseRevision: number;
}) => Promise<ConfigMessageResponse>;

export async function requestConfigSave(value: unknown = config, sendMessage?: ConfigMessageSender): Promise<void> {
    const normalized = normalizeConfig(value);
    const serialized = serializeConfig(normalized);
    // 必须在第一个 await 前登记最新请求；否则即使 configReady 已 resolved，微任务
    // 让出期间到达的旧 storage 回声也会被误当外部更新并回滚本地编辑。
    latestRequestedSerialized = serialized;
    const sequence = ++requestSequence;

    if (!sendMessage) {
        try {
            await configReady;
            if (configStorageWritesBlocked) {
                throw new Error('配置安全水合未完成，暂不保存；请重新加载扩展后重试');
            }
            await saveConfig(normalized, {recordHistory: true, immediateHistory: true});
        } finally {
            if (latestRequestedSerialized === serialized) latestRequestedSerialized = '';
        }
        return;
    }

    const generation = requestGeneration;
    const request = requestQueue
        .catch(() => undefined)
        .then(async () => {
            await configReady;
            // 远程扩展页在凭据水合失败后只有公开配置，绝不能把空 token/ak/sk 当成
            // 用户修改发给后台并清除仍安全保存的 API Key。完整重载成功前统一拒绝保存。
            if (configStorageWritesBlocked) {
                throw new Error('配置安全水合未完成，暂不保存；请重新加载扩展后重试');
            }
            // 外部恢复/导入导致 revision 冲突后，不能继续发送已经排队的旧整份快照。
            if (generation !== requestGeneration) {
                throw new Error('配置已更新，请根据最新配置重新修改');
            }

            activeRequestSerialized = serialized;
            let response: ConfigMessageResponse;
            try {
                response = await sendMessage({
                    type: CONFIG_PERSIST_MESSAGE,
                    config: normalized,
                    clientId: requestClientId,
                    sequence,
                    // 在真正发送时读取版本，让同一页面的连续编辑按前一次提交后的 revision 串行。
                    baseRevision: persistedConfigRevision,
                });
            } catch (error) {
                activeRequestSerialized = '';
                const deferred = takeDeferredStoredConfigChange();
                if (deferred.hasValue) handleStoredConfigChange(deferred.value);
                throw error;
            }

            if (response?.success === false) {
                requestGeneration += 1;
                latestRequestedSerialized = '';
                let deferred = takeDeferredStoredConfigChange();
                let storedValue: unknown;
                try {
                    storedValue = deferred.hasValue
                        ? deferred.value
                        : await storage.getItem<unknown>(CONFIG_STORAGE_KEY);
                    // storage.getItem 期间可能又收到更新，以最后一个 watch 快照为准。
                    deferred = takeDeferredStoredConfigChange();
                } finally {
                    activeRequestSerialized = '';
                }
                handleStoredConfigChange(deferred.hasValue ? deferred.value : storedValue);
                throw new Error(response.error || '后台保存配置失败');
            }
            if (typeof response?.revision !== 'number'
                || !Number.isSafeInteger(response.revision)
                || response.revision < 0) {
                activeRequestSerialized = '';
                const deferred = takeDeferredStoredConfigChange();
                if (deferred.hasValue) handleStoredConfigChange(deferred.value);
                throw new Error('后台保存配置没有返回有效 revision');
            }

            let deferred = takeDeferredStoredConfigChange();
            let storedValue: unknown;
            if (deferred.hasValue) {
                storedValue = deferred.value;
            } else {
                try {
                    storedValue = await storage.getItem<unknown>(CONFIG_STORAGE_KEY);
                } catch {
                    // 保存已经成功；读取暂时失败时至少同步本次用户快照与 revision，
                    // 后续 storage.watch 仍会补齐后台保留的 canonical 字段。
                    activeRequestSerialized = '';
                    persistedConfigRevision = Math.max(persistedConfigRevision, response.revision);
                    if (latestRequestedSerialized === serialized) applyConfig(normalized);
                    return;
                }
                deferred = takeDeferredStoredConfigChange();
                if (deferred.hasValue) storedValue = deferred.value;
            }
            activeRequestSerialized = '';

            const storedRevision = getStoredConfigRevision(storedValue);
            if (storedRevision > response.revision) {
                handleStoredConfigChange(storedValue);
                throw new Error('配置已由其他页面更新，请根据最新配置重新修改');
            }
            if (storedRevision === response.revision) {
                handleStoredConfigChange(storedValue, {
                    confirmedRequestRevision: response.revision,
                    confirmedRequestSerialized: serialized,
                });
            } else {
                persistedConfigRevision = Math.max(persistedConfigRevision, response.revision);
                if (latestRequestedSerialized === serialized) applyConfig(normalized);
            }
            if (generation !== requestGeneration) {
                throw new Error('配置已由其他页面更新，请根据最新配置重新修改');
            }
        });
    requestQueue = request.then(() => undefined, () => undefined);

    try {
        await request;
    } finally {
        if (latestRequestedSerialized === serialized) latestRequestedSerialized = '';
    }
}

export async function applyConfigHistoryAction(action: ConfigHistoryAction, version?: number): Promise<ConfigHistoryState> {
    await configHistoryReady;
    await flushConfigHistory();

    const targetIndex = resolveConfigHistoryTargetIndex(historyState, action, version);

    if (targetIndex === historyState.cursor) return getConfigHistorySnapshot();
    const target = historyState.entries[targetIndex];
    const normalized = restoreRestorableConfig(target.config, config);
    await persistNormalizedConfig(normalized);
    if (serializeConfig(config) !== serializeConfig(normalized)) applyConfig(normalized);

    if (action === 'restore') {
        // 恢复不是把游标永久退回旧版本，而是把目标快照作为一次新的修改追加。
        // 这样恢复前的状态和原有 redo 条目都仍可查看，之后继续编辑也不会静默丢失它们。
        const historyWithLatestCursor = {
            ...historyState,
            cursor: historyState.entries.length - 1,
        };
        const restoredHistory = appendConfigHistorySnapshot(historyWithLatestCursor, normalized);
        await queueHistoryWrite(restoredHistory || historyWithLatestCursor);
        return getConfigHistorySnapshot();
    }

    await queueHistoryWrite({
        ...historyState,
        cursor: targetIndex,
    });
    return getConfigHistorySnapshot();
}

type ConfigHistoryMessageResponse = {success?: boolean; error?: string; history?: ConfigHistoryState} | undefined;
type ConfigHistoryMessageSender = (message: {
    type: typeof CONFIG_HISTORY_MESSAGE;
    action: ConfigHistoryAction;
    version?: number;
}) => Promise<ConfigHistoryMessageResponse>;

export async function requestConfigHistoryAction(
    action: ConfigHistoryAction,
    version?: number,
    sendMessage?: ConfigHistoryMessageSender,
): Promise<ConfigHistoryState> {
    if (!sendMessage) return applyConfigHistoryAction(action, version);

    let response: ConfigHistoryMessageResponse;
    try {
        response = await sendMessage({type: CONFIG_HISTORY_MESSAGE, action, version});
    } catch (error) {
        // 只有明确“没有后台接收端”时才允许本地兜底。后台已经返回的保存失败
        // 不能再执行一次，否则可能绕过共享 mutation 队列或造成重复恢复。
        if (!(error instanceof Error) || !error.message.includes('Receiving end')) throw error;
        return applyConfigHistoryAction(action, version);
    }
    if (response?.success === false) throw new Error(response.error || '配置历史操作失败');
    if (!response?.history) throw new Error('配置历史操作没有返回结果');
    return response.history;
}
