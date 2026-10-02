/**
 * @file src/core/config/driveSync.ts
 * 文件职责：定义包含全部配置凭据的云同步快照和不泄露凭据的差异预览。
 * 主要内容：验证完整快照、保留凭据明确删除语义、执行三方字段合并，并将请求体、
 * 地址、请求头、密钥和未知字段统一投影为隐藏内容；数组作为一个整体合并。
 * 模块边界：只处理纯数据；不拥有口令、加密、存储、浏览器消息或 Google API。
 */
import {CONFIG_CREDENTIAL_FIELDS} from './credentials';
import {isConfigImportValid, prepareConfigForExport} from './transfer';
export class DriveConfigError extends Error {}

export type DriveSyncConfig = Record<string, unknown>;
export type DriveChoice = 'local' | 'remote';
export interface DriveSyncChange {
    id: string;
    label: string;
    sensitive: boolean;
    local: string;
    remote: string;
    conflict: boolean;
    recommended: DriveChoice | null;
}
export interface DriveSyncField {
    path: string[];
    local: unknown;
    remote: unknown;
    recommended: DriveChoice | null;
}
export interface DriveSyncDiff {
    draft: DriveSyncConfig;
    fields: DriveSyncField[];
    changes: DriveSyncChange[];
}

function record(value: unknown): value is DriveSyncConfig {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function driveValuesEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((value, index) => driveValuesEqual(value, right[index]));
    }
    if (!record(left) || !record(right)) return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length
        && keys.every(key => Object.hasOwn(right, key) && driveValuesEqual(left[key], right[key]));
}

/** 防止解密得到的扩展参数带入原型键，或以过深结构阻断设置页与合并流程。 */
function validateTree(value: unknown, depth = 0, budget = {nodes: 0}): void {
    if (depth > 40 || ++budget.nodes > 50_000) throw new DriveConfigError('同步配置结构过于复杂');
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new DriveConfigError('同步配置包含无效字段');
        validateTree(child, depth + 1, budget);
    }
}

export function toDriveSyncConfig(value: unknown): DriveSyncConfig {
    validateTree(value);
    const snapshot = prepareConfigForExport(value);
    delete snapshot.uiLanguageSetupCompleted;
    delete snapshot.videoServiceDefaultMigrated;
    const result = JSON.parse(JSON.stringify(snapshot)) as DriveSyncConfig;
    validateTree(result);
    return result;
}

export function parseDriveSyncPayload(value: unknown): DriveSyncConfig {
    if (!record(value) || value.format !== 'fluentread-complete-config' || value.version !== 1
        || !isConfigImportValid(value.config)
        || !CONFIG_CREDENTIAL_FIELDS.every(field => Object.hasOwn(value.config as object, field))) {
        throw new DriveConfigError('云端文件不包含完整的配置和凭据快照');
    }
    validateTree(value.config);
    // 快照省略运行时迁移状态，但必须按已完成迁移的用户配置解析，保留用户选择。
    return toDriveSyncConfig({...value.config, videoServiceDefaultMigrated: true});
}

export function driveSyncPayload(config: DriveSyncConfig): unknown {
    return {format: 'fluentread-complete-config', version: 1, config};
}

const VISIBLE_FIELDS: Record<string, string> = {
    on: '插件开关', service: '默认翻译服务', from: '源语言', to: '目标语言',
    display: '翻译模式', language: '界面语言', uiLanguage: '界面语言', theme: '主题',
    fontStyle: '译文字体', fontColor: '译文颜色',
};
// 端点、路由模型与凭据一起选择，防止自动合并把某端的密钥绑定到另一端的新地址。
const CONNECTION_FIELDS = new Set<string>([
    ...CONFIG_CREDENTIAL_FIELDS, 'proxy', 'deeplx', 'customBody', 'customOpenAIProviders',
    'newApiUrl', 'azureOpenaiEndpoint', 'deeplApiPlan', 'minimaxBillingPlan', 'minimaxRegion',
    'mimoBillingPlan', 'mimoRegion', 'model', 'customModel', 'documentModel', 'documentCustomModel',
]);
function partition(config: DriveSyncConfig) {
    const connection: DriveSyncConfig = {};
    const settings: DriveSyncConfig = {};
    for (const [key, value] of Object.entries(config)) (CONNECTION_FIELDS.has(key) ? connection : settings)[key] = value;
    return {connection, settings};
}

function previewValue(value: unknown, sensitive: boolean): string {
    if (value === undefined) return '已删除';
    if (value === '' || value === null || (Array.isArray(value) && value.length === 0)
        || (record(value) && Object.keys(value).length === 0)) return '空值';
    if (sensitive) return '已设置（内容隐藏）';
    return JSON.stringify(value).slice(0, 160);
}

export function buildDriveSyncDiff(base: DriveSyncConfig | null, local: DriveSyncConfig, remote: DriveSyncConfig): DriveSyncDiff {
    const fields: DriveSyncField[] = [];
    const changes: DriveSyncChange[] = [];
    const walk = (path: string[], before: unknown, left: unknown, right: unknown, atomic = false): unknown => {
        if (driveValuesEqual(left, right)) return left;
        if (!atomic && record(left) && record(right)) {
            const result: DriveSyncConfig = {};
            const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
            for (const key of keys) {
                const value = walk([...path, key], record(before) ? before[key] : undefined, left[key], right[key]);
                if (value !== undefined) result[key] = value;
            }
            return result;
        }
        const recommended = base === null ? null : driveValuesEqual(left, before) ? 'remote'
            : driveValuesEqual(right, before) ? 'local' : null;
        const root = path[0];
        const sensitive = atomic || !Object.hasOwn(VISIBLE_FIELDS, root);
        const id = String(fields.length);
        fields.push({path, local: left, remote: right, recommended});
        changes.push({
            id, label: `${atomic ? '翻译连接与凭据（整组）' : VISIBLE_FIELDS[root] ?? '私密或自定义设置'} · ${fields.length}`,
            sensitive, local: previewValue(left, sensitive), remote: previewValue(right, sensitive),
            conflict: recommended === null, recommended,
        });
        return recommended === 'remote' ? right : left;
    };
    const left = partition(local);
    const right = partition(remote);
    const before = base === null ? null : partition(base);
    const settings = walk([], before?.settings, left.settings, right.settings) as DriveSyncConfig;
    const connection = walk([], before?.connection, left.connection, right.connection, true) as DriveSyncConfig;
    return {draft: structuredClone({...settings, ...connection}), fields, changes};
}

export function resolveDriveSyncDiff(diff: DriveSyncDiff, choices: unknown): DriveSyncConfig {
    if (!record(choices)) throw new DriveConfigError('同步差异选择无效');
    const result = structuredClone(diff.draft);
    diff.fields.forEach((field, index) => {
        const choice = choices[String(index)] ?? field.recommended;
        if (choice !== 'local' && choice !== 'remote') throw new DriveConfigError('请为每个冲突选择本机或云端配置');
        if (field.path.length === 0) {
            for (const key of CONNECTION_FIELDS) delete result[key];
            Object.assign(result, structuredClone(field[choice]));
            return;
        }
        let target = result;
        for (const key of field.path.slice(0, -1)) target = target[key] as DriveSyncConfig;
        const key = field.path.at(-1)!;
        const value = field[choice];
        if (value === undefined) delete target[key];
        else target[key] = structuredClone(value);
    });
    return result;
}
