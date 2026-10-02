/**
 * @file src/platform/google-drive/auth.ts
 * 文件职责：连接 Chrome 原生身份 API，并将一次同步绑定到同一个 Google 账号。
 * 主要内容：校验客户端和扩展 ID、用户点击授权、短期令牌刷新与账号切换保护。
 * 模块边界：不保存令牌、不读取配置；账号和令牌只在后台请求期间使用。
 */
import {GOOGLE_DRIVE_DEFAULT_CLIENT_ID, GOOGLE_DRIVE_EXTENSION_ID, GOOGLE_DRIVE_SCOPES} from './constants';

export interface DriveAccount {id: string; email: string}
export interface DriveSession {
    account: DriveAccount;
    request<T>(operation: (token: string) => Promise<T>): Promise<T>;
}
export interface DriveIdentity {
    getAuthToken(details: {interactive: boolean; enableGranularPermissions: boolean; scopes: string[]}): Promise<{token?: string; grantedScopes?: string[]}>;
    removeCachedAuthToken(details: {token: string}): Promise<void>;
    clearAllCachedAuthTokens(): Promise<void>;
}
export class DriveError extends Error {
    constructor(message: string, readonly status?: number) {super(message); this.name = 'DriveError';}
}
export interface DriveAuthPorts {
    userAgent(): string;
    identity?: DriveIdentity;
    runtime: {id: string; getManifest(): {oauth2?: {client_id?: string; scopes?: string[]}}};
    fetch: typeof fetch;
}

export function createDriveAuth(ports: DriveAuthPorts) {
    function availability(): {available: boolean; reason: string} {
        const oauth = ports.runtime.getManifest().oauth2;
        if (!/\bChrome\//u.test(ports.userAgent()) || /\b(?:Edg|OPR)\//u.test(ports.userAgent()) || !ports.identity?.getAuthToken || !oauth?.client_id) return {available: false, reason: 'Google Drive 同步目前支持 Chrome 扩展；其他浏览器可使用下方完整数据备份。'};
        if (oauth.client_id === GOOGLE_DRIVE_DEFAULT_CLIENT_ID && ports.runtime.id !== GOOGLE_DRIVE_EXTENSION_ID) return {available: false, reason: '当前开发版扩展 ID 与 Google OAuth 客户端不匹配，请按维护者指南设置扩展公钥或单独创建开发客户端。'};
        if (!GOOGLE_DRIVE_SCOPES.every(scope => oauth.scopes?.includes(scope))) return {available: false, reason: '扩展缺少 Google Drive 应用数据授权范围，请重新构建。'};
        return {available: true, reason: ''};
    }
    async function token(interactive: boolean): Promise<string> {
        const state = availability();
        if (!state.available) throw new DriveError(state.reason);
        let result: Awaited<ReturnType<DriveIdentity['getAuthToken']>>;
        try {result = await ports.identity!.getAuthToken({interactive, enableGranularPermissions: true, scopes: [...GOOGLE_DRIVE_SCOPES]});}
        catch {throw new DriveError('Google 授权未完成，请点击连接账号后重试。');}
        if (!result.token || (result.grantedScopes && !GOOGLE_DRIVE_SCOPES.every(scope => result.grantedScopes!.includes(scope)))) throw new DriveError('Google 授权范围不完整，请重新连接并允许应用数据与邮箱权限。');
        return result.token;
    }
    async function account(accessToken: string): Promise<DriveAccount> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        const operation = (async () => {
            const response = await ports.fetch('https://www.googleapis.com/oauth2/v2/userinfo', {headers: {Authorization: `Bearer ${accessToken}`}, signal: controller.signal});
            if (!response.ok) throw new DriveError(`读取 Google 账号失败（HTTP ${response.status}）。`, response.status);
            const data: unknown = await response.json();
            if (!data || typeof data !== 'object' || !('id' in data) || !('email' in data) || typeof data.id !== 'string' || !data.id || typeof data.email !== 'string' || !data.email) throw new DriveError('Google 账号响应无效，请重新连接。');
            return {id: data.id, email: data.email};
        })();
        return operation.catch(error => {
            if (error instanceof DriveError) throw error;
            throw new DriveError('无法读取 Google 账号，请检查网络后重试。');
        }).finally(() => clearTimeout(timer));
    }
    async function open(interactive = false): Promise<DriveSession> {
        let accessToken = await token(interactive);
        let owner: DriveAccount;
        try {owner = await account(accessToken);} catch (error) {
            if (!(error instanceof DriveError) || error.status !== 401) throw error;
            await ports.identity!.removeCachedAuthToken({token: accessToken});
            accessToken = await token(false);
            owner = await account(accessToken);
        }
        return {
            account: owner,
            async request(operation) {
                try {return await operation(accessToken);} catch (error) {
                    if (!(error instanceof DriveError) || error.status !== 401) throw error;
                    await ports.identity!.removeCachedAuthToken({token: accessToken});
                    accessToken = await token(false);
                    const refreshed = await account(accessToken);
                    if (refreshed.id !== owner.id) throw new DriveError('Google 账号已切换，请重新生成同步预览。');
                    return operation(accessToken);
                }
            },
        };
    }
    async function disconnect() {
        if (ports.identity) await ports.identity.clearAllCachedAuthTokens();
    }
    return {availability, open, disconnect};
}
