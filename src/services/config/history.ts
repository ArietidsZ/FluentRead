/**
 * @file src/services/config/history.ts
 *
 * 文件职责：实现公开配置快照的撤销、重做和恢复状态机，限制历史长度并拒绝损坏或含凭据的旧记录。
 * 主要内容：定义 history schema、entry/state/action 类型，提供基线创建、序列化解析、克隆、追加快照、目标索引计算和结果应用，保持 cursor 与 revision 一致。 可核对的公开符号包括 CONFIG_HISTORY_LIMIT、CONFIG_HISTORY_SCHEMA_VERSION、ConfigHistoryAction、ConfigHistoryEntry、ConfigHistoryState、toPublicConfig、serializeConfigHistory、cloneConfigHistory。
 * 模块边界：本文件位于配置 application service 层，可协调 core 规则与浏览器存储端口；不包含设置页面组件，也不实现具体翻译供应商协议，调用方应通过公开服务 API 订阅或提交配置。
 */

import {normalizeConfig} from '@/src/core/config/model';
import {sanitizeConfigCredentials, type PublicConfig} from '@/src/core/config/credentials';
import {isConfigRecord, parseStoredConfig, serializeConfig} from './schema';

export const CONFIG_HISTORY_LIMIT = 5 as const;
export const CONFIG_HISTORY_SCHEMA_VERSION = 1 as const;

export type ConfigHistoryAction = 'undo' | 'redo' | 'restore';

export interface ConfigHistoryEntry {
    version: number;
    savedAt: string;
    config: PublicConfig;
}

export interface ConfigHistoryState {
    schemaVersion: typeof CONFIG_HISTORY_SCHEMA_VERSION;
    entries: ConfigHistoryEntry[];
    cursor: number;
    nextVersion: number;
}

export function toPublicConfig(value: unknown): PublicConfig {
    return sanitizeConfigCredentials(normalizeConfig(value)) as PublicConfig;
}

export function serializeConfigHistory(value: ConfigHistoryState): string {
    return JSON.stringify(value);
}

export function cloneConfigHistory(value: ConfigHistoryState): ConfigHistoryState {
    return {
        schemaVersion: CONFIG_HISTORY_SCHEMA_VERSION,
        entries: value.entries.map((entry) => ({
            version: entry.version,
            savedAt: entry.savedAt,
            config: toPublicConfig(entry.config),
        })),
        cursor: value.cursor,
        nextVersion: value.nextVersion,
    };
}

export function createBaselineConfigHistory(
    value: unknown,
    persistedRevision: number,
    savedAt = new Date().toISOString(),
): ConfigHistoryState {
    const version = Math.max(1, persistedRevision || 1);
    return {
        schemaVersion: CONFIG_HISTORY_SCHEMA_VERSION,
        entries: [{version, savedAt, config: toPublicConfig(value)}],
        cursor: 0,
        nextVersion: version + 1,
    };
}

export function parseConfigHistory(value: unknown): ConfigHistoryState | null {
    if (!isConfigRecord(value) || !Array.isArray(value.entries)) return null;
    if (value.schemaVersion !== undefined && value.schemaVersion !== CONFIG_HISTORY_SCHEMA_VERSION) return null;

    const validEntries = value.entries
        .map((entry, rawIndex) => {
            if (!isConfigRecord(entry)
                || typeof entry.version !== 'number'
                || !Number.isSafeInteger(entry.version)
                || entry.version < 1
                || typeof entry.savedAt !== 'string') return null;
            const parsedConfig = parseStoredConfig(entry.config);
            if (!parsedConfig) return null;
            return {
                rawIndex,
                entry: {
                    version: entry.version,
                    savedAt: entry.savedAt,
                    config: toPublicConfig(parsedConfig),
                } satisfies ConfigHistoryEntry,
            };
        })
        .filter((item): item is {rawIndex: number; entry: ConfigHistoryEntry} => item !== null);

    if (validEntries.length === 0) return null;
    const retained = validEntries.slice(-CONFIG_HISTORY_LIMIT);
    const entries = retained.map((item) => item.entry);
    const rawCursor = typeof value.cursor === 'number' && Number.isSafeInteger(value.cursor)
        ? value.cursor
        : value.entries.length - 1;
    let retainedCursor = -1;
    for (const [index, item] of retained.entries()) {
        if (item.rawIndex <= rawCursor) retainedCursor = index;
    }
    const cursor = retainedCursor >= 0 ? retainedCursor : 0;
    const maxVersion = entries.reduce((max, entry) => Math.max(max, entry.version), 0);
    const rawNextVersion = typeof value.nextVersion === 'number'
        && Number.isSafeInteger(value.nextVersion)
        && value.nextVersion >= 1
        ? value.nextVersion
        : maxVersion + 1;

    return {
        schemaVersion: CONFIG_HISTORY_SCHEMA_VERSION,
        entries,
        cursor,
        nextVersion: Math.max(rawNextVersion, maxVersion + 1),
    };
}

export function appendConfigHistorySnapshot(
    state: ConfigHistoryState,
    value: unknown,
    savedAt = new Date().toISOString(),
): ConfigHistoryState | null {
    const normalized = toPublicConfig(value);
    const currentEntries = state.entries.slice(0, state.cursor + 1);
    const current = currentEntries[currentEntries.length - 1];
    if (current && serializeConfig(current.config) === serializeConfig(normalized)) return null;

    let entries = [...currentEntries, {
        version: state.nextVersion,
        savedAt,
        config: normalized,
    }];
    if (entries.length > CONFIG_HISTORY_LIMIT) entries = entries.slice(-CONFIG_HISTORY_LIMIT);

    return {
        schemaVersion: CONFIG_HISTORY_SCHEMA_VERSION,
        entries,
        cursor: entries.length - 1,
        nextVersion: state.nextVersion + 1,
    };
}

export function resolveConfigHistoryTargetIndex(
    state: ConfigHistoryState,
    action: ConfigHistoryAction,
    version?: number,
): number {
    if (action === 'undo') return Math.max(0, state.cursor - 1);
    if (action === 'redo') return Math.min(state.entries.length - 1, state.cursor + 1);
    if (version === undefined) return state.cursor;
    const index = state.entries.findIndex((entry) => entry.version === version);
    return index >= 0 ? index : state.cursor;
}
