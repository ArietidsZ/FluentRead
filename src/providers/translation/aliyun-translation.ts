/**
 * @file src/providers/translation/aliyun-translation.ts
 *
 * 文件职责：适配阿里云机器翻译通用版 TranslateGeneral（2018-10-12），使用 AccessKey 与 RPC 1.0 HMAC-SHA1 签名调用官方接口。
 * 主要内容：从请求快照读取 token[aliyunTranslation]（AccessKey ID）、secret[aliyunTranslation]（AccessKey Secret）与所选地域，按 RFC 3986 规范化公共参数并计算 Signature，以表单 POST 调用地域域名，解析 Data.Translated 并回显安全错误码。 可核对的公开符号包括 buildAliyunSignedForm、default:aliyunTranslation。
 * 模块边界：本文件位于 provider 适配层，只把统一翻译请求转换为外部或浏览器服务协议；不管理页面 DOM、UI 生命周期或配置持久化，缓存、去重和超时总预算由 translation broker 统一协调。
 */

import {resolveCloudRegion, services} from '@/src/core/config/catalog';
import {getAliyunTranslationEndpoint, method} from '@/src/core/config/constants';
import {config} from '@/src/services/config/store';
import {getTranslationLanguages} from '@/src/services/translation/languages';
import {createHttpStatusError, createProviderCodeError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {getTranslationProviderConfig, type TranslationProviderRequest} from '@/src/services/translation/requestSnapshot';
import {resolveCloudLanguages} from './cloud/languages';
import {canonicalQueryString, hmacSha1, percentEncode, toBase64} from './cloud/signature';

type AliyunResponse = {
    Code?: unknown;
    Message?: unknown;
    Data?: {Translated?: string};
};

export interface AliyunSignatureInput {
    accessKeyId: string;
    accessKeySecret: string;
    parameters: Record<string, string>;
    /** 便于测试注入固定时间与随机数。 */
    now?: Date;
    nonce?: string;
}

/** 生成带 Signature 的完整表单参数；签名串遵循 POP RPC 1.0：METHOD&%2F&encode(query)。 */
export async function buildAliyunSignedForm(input: AliyunSignatureInput): Promise<Record<string, string>> {
    const now = input.now ?? new Date();
    const parameters: Record<string, string> = {
        ...input.parameters,
        Format: 'JSON',
        Version: '2018-10-12',
        AccessKeyId: input.accessKeyId,
        SignatureMethod: 'HMAC-SHA1',
        SignatureVersion: '1.0',
        SignatureNonce: input.nonce ?? crypto.randomUUID(),
        Timestamp: now.toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    };
    const stringToSign = `POST&${percentEncode('/')}&${percentEncode(canonicalQueryString(parameters))}`;
    const signature = toBase64(await hmacSha1(`${input.accessKeySecret}&`, stringToSign));
    return {...parameters, Signature: signature};
}

async function aliyunTranslation(message: TranslationProviderRequest<string>) {
    const current = getTranslationProviderConfig(message, config);
    const accessKeyId = current.token[services.aliyunTranslation]?.trim();
    const accessKeySecret = current.secret[services.aliyunTranslation]?.trim();
    if (!accessKeyId || !accessKeySecret) {
        throw new Error('阿里云机器翻译尚未配置 AccessKey ID 与 AccessKey Secret，请先在设置中填写');
    }
    const region = resolveCloudRegion(services.aliyunTranslation, current.serviceRegion?.[services.aliyunTranslation]);

    const {sourceLanguage, targetLanguage} = getTranslationLanguages(message);
    const {source, target} = resolveCloudLanguages('aliyunTranslation', sourceLanguage, targetLanguage);

    const form = await buildAliyunSignedForm({
        accessKeyId,
        accessKeySecret,
        parameters: {
            Action: 'TranslateGeneral',
            FormatType: 'text',
            Scene: 'general',
            SourceLanguage: source,
            TargetLanguage: target,
            SourceText: message.origin,
        },
    });

    const response = await runtimeFetch(getAliyunTranslationEndpoint(region), {
        method: method.POST,
        headers: {'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'},
        body: new URLSearchParams(form).toString(),
        signal: message.abortSignal,
    });

    if (!response.ok) {
        throw createHttpStatusError(response, '阿里云机器翻译请求失败');
    }

    const result = await readJsonResponse<AliyunResponse>(response, '阿里云机器翻译返回的不是有效 JSON');
    if (String(result.Code ?? '') !== '200') {
        throw createProviderCodeError('阿里云机器翻译错误', result.Code);
    }
    const translated = result.Data?.Translated;
    if (typeof translated === 'string') return translated;
    throw new Error('阿里云机器翻译返回格式异常');
}

export default aliyunTranslation;
