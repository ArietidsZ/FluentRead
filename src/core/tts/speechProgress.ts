/**
 * @file src/core/tts/speechProgress.ts
 * 文件职责：把真实音频播放位置和可用句段时间映射成安全的跟读文字范围。
 * 主要内容：校验跨上下文句段和进度，保留原始字符索引；有词边界时直接使用，没有词时间戳时按句段时长估算扫读并标记精度；切片保留原文字符与空白。
 * 模块边界：纯计算，不操作 DOM、不生成音频、不推断墙钟播放进度。
 */
export interface SpeechCue {startChar: number; endChar: number; startTime: number; endTime: number}
export interface SpeechProgress {start: number; end: number; fraction: number; estimated: boolean}

export function parseSpeechCues(value: unknown): SpeechCue[] {
    if (!Array.isArray(value) || value.length > 2048) return [];
    let previousChar = 0, previousTime = 0;
    const cues: SpeechCue[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') return [];
        const {startChar, endChar, startTime, endTime} = item;
        if (![startChar,endChar].every(Number.isSafeInteger) || startChar < previousChar || endChar <= startChar
            || ![startTime,endTime].every(Number.isFinite) || startTime < previousTime || endTime <= startTime) return [];
        cues.push({startChar,endChar,startTime,endTime}); previousChar=endChar; previousTime=endTime;
    }
    return cues;
}

export function parseSpeechProgress(value: unknown): SpeechProgress | null {
    if (!value || typeof value !== 'object') return null;
    const p = value as SpeechProgress;
    if (!Number.isSafeInteger(p.start) || !Number.isSafeInteger(p.end) || p.start < 0 || p.end <= p.start
        || !Number.isFinite(p.fraction) || p.fraction < 0 || p.fraction > 1 || typeof p.estimated !== 'boolean') return null;
    return {start:p.start,end:p.end,fraction:p.fraction,estimated:p.estimated};
}

export function audioSpeechProgress(text: string, time: number, duration: number, cues: readonly SpeechCue[] = []): SpeechProgress | null {
    if (!text || !Number.isFinite(time) || !Number.isFinite(duration) || time < 0 || duration <= 0) return null;
    // 句段间隙保持上一个句段，结束后保持最后一个词，避免进度跳回整篇文字。
    const cue = cues.find(c => time < c.endTime) ?? cues.at(-1);
    const start = cue?.startChar ?? 0, end = Math.min(text.length, cue?.endChar ?? text.length);
    const begin = cue?.startTime ?? 0, finish = cue?.endTime ?? duration;
    if (start >= end) return null;
    const fraction = Math.min(1,Math.max(0,(time-begin)/(finish-begin)));
    const reached = start + (end-start)*fraction;
    // 汉字按字推进，其他文字按词推进；标点与空白保持原样。时间仍是估算，不能当作词时间戳。
    const words = [...text.slice(start,end).matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{P}\p{S}\p{C}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+(?:['’][^\s\p{P}\p{S}\p{C}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+)*/gu)];
    const word = words.find(w => start+w.index+w[0].length > reached) ?? words.at(-1);
    if (!word) return {start,end,fraction,estimated:true};
    const wordStart = start+word.index, wordEnd = wordStart+word[0].length;
    return {start:wordStart,end:wordEnd,fraction:Math.min(1,Math.max(0,(reached-wordStart)/(wordEnd-wordStart))),estimated:true};
}

export function boundarySpeechProgress(text: string, start: number, length: number): SpeechProgress | null {
    if (!Number.isSafeInteger(start) || start < 0 || start >= text.length) return null;
    const size = Number.isSafeInteger(length) && length > 0 ? length : (text.slice(start).match(/^\S+/u)?.[0].length ?? 1);
    return {start,end:Math.min(text.length,start+size),fraction:1,estimated:false};
}

export function speechTextSlices(text: string, offset: number, progress: SpeechProgress | null) {
    if (!progress) return {before:'',active:'',after:text,fraction:0};
    const start=Math.max(0,Math.min(text.length,progress.start-offset)),end=Math.max(0,Math.min(text.length,progress.end-offset));
    if (end <= start) return {before:'',active:'',after:text,fraction:0};
    const reached=progress.start+(progress.end-progress.start)*progress.fraction;
    return {before:text.slice(0,start),active:text.slice(start,end),after:text.slice(end),fraction:Math.max(0,Math.min(1,(reached-offset-start)/(end-start)))};
}
