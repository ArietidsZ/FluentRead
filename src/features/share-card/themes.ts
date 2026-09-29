/**
 * @file src/features/share-card/themes.ts
 * 文件职责：定义分享卡片的四套视觉语言，并绘制不承载用户内容的背景材质。
 * 主要内容：珊瑚的红白分区、晴空的透亮蓝色、流光的深色彩字、月白的珠光双栏；保留文字对比度，装饰随内容高度适配。
 * 模块边界：只在已确定尺寸的 Canvas 上绘图，不测量或裁切正文，不访问配置存储、网络及宿主页面，也不加载外部设计素材。
 */
import type {ShareCardTheme} from '@/src/core/config/shareCard';

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
const SERIF = 'Georgia, "Songti SC", "Noto Serif CJK SC", "SimSun", serif';
export const CARD_THEMES = {
    coral: {background: '#eb4635', ink: '#fff8ea', secondary: '#573a30', accent: '#c53325', muted: '#8b6854', font: `500 {size}px ${SERIF}`, inset: 48, uiAccent: '#c53325'},
    sky: {background: '#eaf5ff', ink: '#153d65', secondary: '#315e80', accent: '#306fa3', muted: '#47728f', font: `600 {size}px ${SANS}`, inset: 48, uiAccent: '#22689e'},
    prism: {background: '#12131a', ink: '#b6b7ff', secondary: '#e1e2e9', accent: '#bcb4e7', muted: '#a8aabf', font: `600 {size}px ${SANS}`, inset: 48, uiAccent: '#5653b8'},
    pearl: {background: '#eaeaf0', ink: '#292b34', secondary: '#5e6270', accent: '#777d96', muted: '#7b7e8c', font: `600 {size}px ${SANS}`, inset: 48, uiAccent: '#4a4e5c'},
} as const satisfies Record<ShareCardTheme, unknown>;
export const CARD_SECONDARY_FONT = SANS;

function glow(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, width: number, height: number): void {
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color); gradient.addColorStop(1, `${color.slice(0, 7)}00`);
    context.fillStyle = gradient; context.fillRect(0, 0, width, height);
}
export function paintCardBackground(context: CanvasRenderingContext2D, theme: ShareCardTheme, width: number, height: number, split: number): void {
    context.fillStyle = CARD_THEMES[theme].background;
    context.fillRect(0, 0, width, height);
    context.save();
    if (theme === 'coral') {
        // 已选定的默认版式保持红白比例、字体和细节不变。
        context.fillStyle = '#fff3dd'; context.fillRect(0, split, width, height - split);
        context.strokeStyle = '#fff8ea38'; context.lineWidth = 1;
        for (const radius of [27, 35, 43]) {context.beginPath(); context.arc(width - 21, 10, radius, 0, Math.PI * 2); context.stroke();}
        context.fillStyle = '#f4ce94'; context.fillRect(48, 22, 22, 3);
        context.fillStyle = '#c53325'; context.fillRect(width - 33, height - 45, 7, 7);
    } else if (theme === 'sky') {
        const gradient = context.createLinearGradient(0, 0, width * .25, height);
        gradient.addColorStop(0, '#f5faff'); gradient.addColorStop(.6, '#d8edff'); gradient.addColorStop(1, '#9bcbf2');
        context.fillStyle = gradient; context.fillRect(0, 0, width, height);
        glow(context, width * .65, -10, 330, '#ffffff', width, height);
        // 光线只落在下沿，避免在正文背后堆叠图形。
        context.beginPath(); context.moveTo(0, height - 57);
        context.bezierCurveTo(width * .38, height - 115, width * .7, height + 30, width, height - 70);
        context.lineTo(width, height); context.lineTo(0, height); context.closePath();
        context.fillStyle = '#ffffff52'; context.fill();
        context.strokeStyle = '#ffffff80'; context.lineWidth = 1; context.stroke();
    } else if (theme === 'prism') {
        glow(context, 90, height + 140, 290, '#3759c945', width, height);
        glow(context, width - 30, height + 140, 290, '#c1478c38', width, height);
    } else {
        const gradient = context.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#e6effc'); gradient.addColorStop(.45, '#f4eaf1'); gradient.addColorStop(1, '#dcebed');
        context.fillStyle = gradient; context.fillRect(0, 0, width, height);
        context.shadowColor = '#47436e1a'; context.shadowBlur = 16; context.shadowOffsetY = 5;
        context.fillStyle = '#ffffffed'; context.strokeStyle = '#ffffff'; context.lineWidth = 1;
        context.beginPath();
        // 老浏览器缺少 roundRect 时使用直角面板，装饰不会阻断导出。
        if (typeof context.roundRect === 'function') context.roundRect(12, 12, width - 24, height - 24, 18);
        else context.rect(12, 12, width - 24, height - 24);
        context.fill(); context.shadowColor = 'transparent'; context.stroke();
    }
    context.restore();
}
export function cardPrismInk(context: CanvasRenderingContext2D, width: number, top: number): CanvasGradient {
    const gradient = context.createLinearGradient(48, top, width - 48, top + 80);
    gradient.addColorStop(0, '#77b7ff'); gradient.addColorStop(.36, '#b09cff');
    gradient.addColorStop(.7, '#ef9dcd'); gradient.addColorStop(1, '#ffc3a3');
    return gradient;
}
