/**
 * @file userscript/buildDataEncoding.ts
 * 文件职责：在构建期把已有 gzip 静态资源编码为 ASCII Base85，或为 standalone 编码为 Base91。
 * 主要内容：按格式编码原始字节，并与运行时共享字母表及识别前缀。
 * 模块边界：仅转换传入字节，不修改图片、CSS、词典、许可、gzip 算法或可执行源码；资源选择由构建插件负责。
 */
import {USERSCRIPT_DATA_ALPHABET, USERSCRIPT_DATA_PREFIX, USERSCRIPT_COMPACT_DATA_ALPHABET, USERSCRIPT_COMPACT_DATA_PREFIX} from './dataEncoding';

/** 紧凑格式仅用于 standalone；原 Base85 与 Base64 解码继续保留。 */
export function encodeUserscriptDataCompact(bytes: Uint8Array): string {
    let encoded = USERSCRIPT_COMPACT_DATA_PREFIX, buffer = 0, bits = 0;
    for (const byte of bytes) {
        buffer |= byte << bits;
        bits += 8;
        if (bits > 13) {
            let value = buffer & 8191;
            if (value > 88) { buffer >>>= 13; bits -= 13; }
            else { value = buffer & 16383; buffer >>>= 14; bits -= 14; }
            encoded += USERSCRIPT_COMPACT_DATA_ALPHABET[value % 91] + USERSCRIPT_COMPACT_DATA_ALPHABET[Math.floor(value / 91)];
        }
    }
    if (bits) {
        encoded += USERSCRIPT_COMPACT_DATA_ALPHABET[buffer % 91];
        if (bits > 7 || buffer > 90) encoded += USERSCRIPT_COMPACT_DATA_ALPHABET[Math.floor(buffer / 91)];
    }
    return encoded;
}

export function encodeUserscriptData(bytes: Uint8Array): string {
    let encoded = USERSCRIPT_DATA_PREFIX + (4 - bytes.length % 4) % 4;
    for (let index = 0; index < bytes.length; index += 4) {
        let block = bytes[index] * 0x1000000 + (bytes[index + 1] ?? 0) * 0x10000
            + (bytes[index + 2] ?? 0) * 0x100 + (bytes[index + 3] ?? 0);
        let characters = '';
        for (let digit = 0; digit < 5; digit += 1) {
            characters = USERSCRIPT_DATA_ALPHABET[block % 85] + characters;
            block = Math.floor(block / 85);
        }
        encoded += characters;
    }
    return encoded;
}
