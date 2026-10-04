/**
 * @file src/core/config/cloudSync.ts
 * 文件职责：定义配置云备份与存储供应商之间共用的账号、会话、文件版本和安全错误契约。
 * 主要内容：账号身份隔离、带版本及只读恢复能力的密文快照、受控异常和共享的强 ETag 验证。
 * 模块边界：只声明结构和校验标识，不访问浏览器、配置存储或网络；供应商实现会话和条件写入。
 */
export class CloudSyncError extends Error {}
export interface CloudSyncAccount {id: string; email: string}
export interface CloudSyncSession {
    account: CloudSyncAccount;
    request<T>(operation: (credential: string) => Promise<T>): Promise<T>;
}
export interface CloudSyncFile {id: string; version: string; modifiedTime: string; etag?: string; readOnly?: true}
export interface CloudSyncRemote {file: CloudSyncFile; content: string}

/** RFC 9110 强实体标识；缺少有效标识时只能读取，不允许无条件覆盖已有备份。 */
export function strongCloudEtag(value: string | null | undefined): string | undefined {
    return value && value.length <= 512 && /^"[\x21\x23-\x7e\x80-\xff]*"$/u.test(value) ? value : undefined;
}
