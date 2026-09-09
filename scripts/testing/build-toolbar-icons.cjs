/** 工具栏状态资源：保留原始品牌图标，在 16 CSS px 图标右下角绘制直径 6.5 px、不透明度 78% 的状态叠层。 */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.env.FLUENTREAD_SHARP_PATH || 'sharp');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'public/icon/toolbar');
fs.mkdirSync(output, {recursive: true});
const marks = {
    translated: ['#15803d', '<path d="m10.25 12.1 1.25 1.25 2.55-2.8"/>'],
    translating: ['#2563eb', '<path d="M12.25 10.45v1.8l1.25.7"/>'],
    error: ['#b45309', '<path d="M12.25 10.35v2.1m0 1.2h0"/>'],
};
(async () => {
    for (const size of [16, 32, 48, 64, 128]) {
        for (const [status, [color, mark]] of Object.entries(marks)) {
            const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16"><g opacity=".78"><circle cx="12.25" cy="12.25" r="3.25" fill="${color}" stroke="white" stroke-opacity=".85" stroke-width=".55"/><g fill="none" stroke="white" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round">${mark}</g></g></svg>`);
            await sharp(path.join(root, `public/icon/${size}.png`)).composite([{input: overlay}]).png().toFile(path.join(output, `${status}-${size}.png`));
        }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
