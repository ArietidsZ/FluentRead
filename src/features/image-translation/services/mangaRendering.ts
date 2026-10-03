/**
 * @file src/features/image-translation/services/mangaRendering.ts
 * 文件职责：在整段漫画区域中绘制适合阅读的译文，避免整行逐框放大和复杂背景扩散条纹。
 * 主要内容：统一限制译文字号、保留整段内容和裁剪边界；均匀气泡使用原背景色，已修补的复杂背景直接绘字，未修补的独立调用使用可读底板。
 * 模块边界：只操作调用方提供的画布和像素，不运行 OCR/翻译、不修改宿主页面；绘制区域局限于识别框，完整原图仍可通过现有按钮对照。
 */
import type {MangaRegion} from './mangaRegions';
import {drawTranslatedImageText, getImageTextBackgroundColor} from './rendering';

export function mangaRegionBackground(pixels: Uint8ClampedArray, width: number, height: number, box: MangaRegion['bbox']) {
    const sampled = getImageTextBackgroundColor(pixels, width, height, box);
    const channels = sampled.match(/\d+/g)!.map(Number);
    let matching = 0, samples = 0;
    const sample = (x: number, y: number) => {
        const offset = (y * width + x) * 4; samples += 1;
        if (pixels[offset + 3] >= 128 && channels.every((value, index) => Math.abs(pixels[offset + index] - value) <= 20)) matching += 1;
    };
    for (let x = Math.floor(box.x0); x < box.x1; x += Math.max(1, Math.floor((box.x1 - box.x0) / 32))) {
        sample(x, Math.max(0, Math.floor(box.y0) - 1)); sample(x, Math.min(height - 1, Math.ceil(box.y1)));
    }
    for (let y = Math.floor(box.y0); y < box.y1; y += Math.max(1, Math.floor((box.y1 - box.y0) / 32))) {
        sample(Math.max(0, Math.floor(box.x0) - 1), y); sample(Math.min(width - 1, Math.ceil(box.x1)), y);
    }
    return {color: sampled, uniform: matching / samples >= 0.9};
}

/** 同页统一上限，短译文不会因原框很高而变成巨大单字。 */
export function drawMangaTranslations(context: CanvasRenderingContext2D, pixels: Uint8ClampedArray,
    width: number, height: number, regions: Array<MangaRegion & {sourceText?: string}>, repaired = false) {
    if (![width, height].every(value => Number.isSafeInteger(value) && value > 0) || pixels.length < width * height * 4) return;
    for (const region of regions) {
        const box = region.bbox;
        const left = Math.max(0, box.x0), top = Math.max(0, box.y0);
        const right = Math.min(width, box.x1), bottom = Math.min(height, box.y1);
        if (right <= left || bottom <= top) continue;
        const sampled = mangaRegionBackground(pixels, width, height, {x0:left,y0:top,x1:right,y1:bottom});
        const background = sampled.uniform ? sampled.color : 'rgb(255,255,255)';
        context.save();
        try {
            if (sampled.uniform || !repaired) {
                context.fillStyle = background;
                context.fillRect(left, top, right - left, bottom - top);
            }
            const fontSize = Math.min(region.fontSize * 1.05, width * 0.034);
            drawTranslatedImageText(context, region.text, left + 3, top + 3, Math.max(1, right - left - 6),
                Math.max(1, bottom - top - 6), background, fontSize);
        } finally { context.restore(); }
    }
}
