/**
 * @file src/core/language/detect.ts
 *
 * 文件职责：对待翻译文本执行轻量语言识别，为不依赖外部检测服务的翻译流程提供源语言线索。
 * 主要内容：detectlang 调用 franc-min 得到 ISO 639-3 识别结果，再把 cmn、eng、fra、jpn、kor、rus 映射为 FluentRead 使用的语言代码；未登记结果保留 franc 原代码。 可核对的公开符号包括 detectlang。
 * 模块边界：本文件属于 core 领域层，只定义规则、类型与纯转换；不直接读写浏览器存储、不发起网络请求、不挂载 Vue/WXT 入口，持久化、协议调用和界面编排分别由 services、providers 与 features 承担。
 */

import {franc} from 'franc-min';

const FLUENTREAD_LANGUAGE_CODES: Readonly<Record<string, string>> = {
    cmn: 'zh-Hans',
    eng: 'en',
    fra: 'fr',
    jpn: 'ja',
    kor: 'ko',
    rus: 'ru',
};

/** 将 franc 的 ISO 639-3 结果映射为 FluentRead 配置使用的语言代码。 */
export function detectlang(origin: string): string {
    const detected = franc(origin, {minLength: 0});
    return FLUENTREAD_LANGUAGE_CODES[detected] ?? detected;
}
