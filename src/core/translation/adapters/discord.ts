/**
 * @file src/core/translation/adapters/discord.ts
 * 文件职责：保护 Discord 消息正文中的编辑时间戳，避免日期与 edited 标记进入翻译请求。
 * 主要内容：按消息内容容器的直属子节点识别当前及旧版时间戳类名，统一全文发现、悬浮解析与文本槽保护。
 * 模块边界：只声明 Discord 域名及最小 DOM 规则，不读取配置、不监听消息更新、不改变宿主布局，也不调用翻译服务。
 */
import {createDeclarativeAdapter} from './declarative';

const editedMetadata = [
    'div[id^="message-content-"] > span[class*="timestamp_"]',
    'div[id^="message-content-"] > span[class*="-timestamp"]',
];

export const discordAdapter = createDeclarativeAdapter({
    id: 'discord',
    priority: 400,
    hosts: [{hostname: 'discord.com', includeSubdomains: true}],
    prune: [{selector: editedMetadata, reason: 'discord-edited-message-metadata'}],
    keepOriginal: [{selector: editedMetadata, reason: 'discord-edited-message-metadata'}],
    omitFromTranslation: [{selector: editedMetadata, reason: 'discord-edited-message-metadata'}],
});
