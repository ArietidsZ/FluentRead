/** 油猴缺少原生 runtime sender 私密身份；保留导入字段供回传扩展，关闭扩展专属路由。 */
import type {IncognitoRoute} from '../src/core/config/incognitoRoute';
export {normalizeIncognitoRouteField} from '../src/core/config/incognitoRoute';
export const NATIVE_PRIVATE_ROUTE_SUPPORTED = false;
const unavailable = (_context: object): undefined => undefined;
export {unavailable as initializeIncognitoRouteConfig, unavailable as normalizeIncognitoRouteConfig,
    unavailable as resolveIncognitoRoute, unavailable as getLockedIncognitoRoute,
    unavailable as resolvePageTranslationRouteHint, unavailable as fullPageTranslationConfigKey};
export {unavailable as getTranslationSourcePrivacy, unavailable as assertTranslationSourcePrivacy};
export {hasTrustedPrivateSource as hasConfiguredIncognitoRoute};
export function hasTrustedPrivateSource(_message: object): false {return false;}
export function attachTrustedPrivateSource<T extends object>(message: T, _privacy?: unknown): T {return message;}
export {attachTrustedPrivateSource as attachTranslationSourcePrivacy};
export function lockIncognitoRoute<T extends object>(config: T, _route: IncognitoRoute): T {return config;}
