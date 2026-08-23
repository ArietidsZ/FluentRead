import {method, urls} from "../utils/constant";
import {services} from "../utils/option";
import {commonMsgTemplate} from "../utils/template";
import CryptoJS from 'crypto-js';
import {config} from "@/entrypoints/utils/config";
import {isApiKeyRequired} from "@/entrypoints/utils/configValidation";
import {createHttpStatusError, readJsonResponse} from '@/entrypoints/utils/httpError';
import {runtimeFetch} from '@/entrypoints/utils/http';


const JWT_CACHE_DURATION_MS = 3600000 * 24;
const jwtCache = new Map<string, {apiKey: string; secret: string; expiration: number}>();

// 文档参考：https://open.bigmodel.cn/dev/api#nosdk
async function zhipu(message: any) {
    const service = message.serviceOverride || services.zhipu;
    // 智谱根据 token 获取 secret（签名密钥） 和 expiration
    const token = config.token[service];
    const cached = jwtCache.get(service);
    let secret = cached?.apiKey === token && cached.expiration > Date.now()
        ? cached.secret
        : undefined;
    if (!token?.trim() && !isApiKeyRequired(service, config)) {
        secret = undefined;
        jwtCache.delete(service);
    } else if (!secret) {
        secret = generateToken(token);
        if (!secret) throw new Error('无法生成令牌');
        // JWT 是可复算的派生凭据，只在当前后台进程内缓存，不进入 Config/storage/history/export。
        jwtCache.set(service, {apiKey: token, secret, expiration: Date.now() + JWT_CACHE_DURATION_MS});
    }

    // 构建请求头
    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    if (secret) headers.append('Authorization', `Bearer ${secret}`);

    // 发起 fetch 请求
    const resp = await runtimeFetch(urls[services.zhipu], {
        method: method.POST,
        headers: headers,
            body: commonMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage, message.modelOverride)
    });

    if (resp.ok) {
        const result = await readJsonResponse<any>(resp, '智谱返回的不是有效 JSON');
        return result.choices[0].message.content;
    } else {
        throw createHttpStatusError(resp, '翻译失败');
    }
}

function generateToken(APIKey: string) {
    if (!APIKey || !APIKey.includes('.')) {
        return;
    }
    const duration = JWT_CACHE_DURATION_MS; // 生成的 token 默认24小时后过期
    const [key, secret] = APIKey.split('.');

    return generateJWT(secret, {alg: "HS256", sign_type: "SIGN", typ: "JWT"}, {
        api_key: key,
        exp: Math.floor(Date.now() / 1000) + (duration / 1000),
        timestamp: Math.floor(Date.now() / 1000)
    });
}

// 生成JWT（JSON Web Token）
function generateJWT(secret: string, header: any, payload: any) {
    // 对header和payload部分进行UTF-8编码，然后转换为Base64URL格式
    const encodedHeader = base64UrlSafe(btoa(JSON.stringify(header)));
    const encodedPayload = base64UrlSafe(btoa(JSON.stringify(payload)));
    // 生成 jwt 签名
    let hmacsha256 = base64UrlSafe(CryptoJS.HmacSHA256(encodedHeader + "." + encodedPayload, secret).toString(CryptoJS.enc.Base64))
    return `${encodedHeader}.${encodedPayload}.${hmacsha256}`;
}

// 将Base64字符串转换为Base64URL格式的函数
function base64UrlSafe(base64String: string) {
    return base64String.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default zhipu;
