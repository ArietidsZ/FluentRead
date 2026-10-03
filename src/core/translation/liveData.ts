/**
 * @file src/core/translation/liveData.ts
 * 文件职责：识别页面中无需翻译的独立数值、日期、时钟和时长展示。
 * 主要内容：按完整文本匹配常见数字格式、时分秒和相对时长，保留含时间或数字的完整句子。
 * 模块边界：纯文本判定，不读取 DOM、配置或时间，不创建监听器，也不影响主动划词翻译。
 */

const number = String.raw`[+-]?\p{Nd}+(?:[.,\s]\p{Nd}+)*`;
const unit = String.raw`(?:milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|毫秒|秒钟?|分钟?|小时|时|天)`;
const duration = new RegExp(String.raw`^(?:in\s+)?(?:${number}\s*${unit}\s*[,，]?\s*)+(?:ago|前|后|後)?$`, 'iu');
const numeric = new RegExp(String.raw`^[\p{Sc}]?\s*${number}\s*(?:[%‰]|[kmb])?$`, 'iu');
const clock = /^(?:am\s*|pm\s*)?\d{1,3}\s*:\s*[0-5]\d(?:\s*:\s*[0-5]\d(?:[.,]\d+)?)?(?:\s*(?:am|pm|[+-]\d{2}:?\d{2}|z))?$/iu;
const dateTime = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[t\s]+\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:\s*(?:z|[+-]\d{2}:?\d{2}|am|pm))?)?$/iu;
const localizedDate = /^\d{4}年\d{1,2}月\d{1,2}日(?:\s*\d{1,2}(?:时|時|点|點)\d{1,2}分(?:\d{1,2}秒)?)?$/u;

/** 仅匹配整个展示值；“The task takes 5 minutes” 等正文继续翻译。 */
export function isNonTranslatableLiveData(value: string): boolean {
    const text = value.normalize('NFKC').replace(/[\s\u3000]+/gu, ' ').trim();
    return text !== '' && text.length <= 128 && (numeric.test(text) || clock.test(text) || dateTime.test(text) ||
        localizedDate.test(text) || duration.test(text));
}
