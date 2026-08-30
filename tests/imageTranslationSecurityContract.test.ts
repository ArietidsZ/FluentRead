import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/src/services/config/store', () => ({
    config: {on: true, from: 'auto'},
}));

import {getImageData} from '@/src/features/image-translation/content/runtime';

const PROJECT_ROOT = resolve(__dirname, '..');
const SRC_ROOT = resolve(PROJECT_ROOT, 'src');

function sourceText(): string {
    const sources: string[] = [];
    const visit = (directory: string) => {
        for (const entry of readdirSync(directory)) {
            const path = resolve(directory, entry);
            if (statSync(path).isDirectory()) visit(path);
            else if (path.endsWith('.ts') || path.endsWith('.vue')) sources.push(readFileSync(path, 'utf8'));
        }
    };
    visit(SRC_ROOT);
    return sources.join('\n');
}

function imageElement(): HTMLImageElement {
    return {
        naturalWidth: 40,
        naturalHeight: 20,
        currentSrc: 'https://attacker.example/rebinding.png',
        src: 'https://attacker.example/rebinding.png',
    } as HTMLImageElement;
}

describe('图片翻译跨域读取安全契约', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('源码不再暴露网页 URL 的后台特权抓取协议或客户端', () => {
        const source = sourceText();
        for (const removedSymbol of [
            ['fluentRead', 'ImageFetch'].join(''),
            ['fetchImage', 'InExtension'].join(''),
            ['fetchRemoteImage', 'ForOcr'].join(''),
            ['remoteImage', 'Fetcher'].join(''),
        ]) {
            expect(source).not.toContain(removedSymbol);
        }
        expect(existsSync(resolve(
            SRC_ROOT,
            'features/image-translation/background',
            ['remoteImage', 'Fetcher.ts'].join(''),
        ))).toBe(false);
        expect(existsSync(resolve(
            SRC_ROOT,
            'features/image-translation/services',
            ['remote', 'Image.ts'].join(''),
        ))).toBe(false);
    });

    it('Canvas 可读时仍生成本地 data URL，不请求 runtime', async () => {
        const sendMessage = vi.fn();
        const context = {
            drawImage: vi.fn(),
            getImageData: vi.fn(() => ({})),
        };
        const canvas = {
            width: 0,
            height: 0,
            getContext: vi.fn(() => context),
            toDataURL: vi.fn(() => 'data:image/png;base64,local'),
        };
        vi.stubGlobal('browser', {runtime: {sendMessage}});
        vi.stubGlobal('document', {createElement: vi.fn(() => canvas)});

        await expect(getImageData(imageElement())).resolves.toBe('data:image/png;base64,local');
        expect(context.drawImage).toHaveBeenCalledOnce();
        expect(context.getImageData).toHaveBeenCalledOnce();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it.each(['pixel-read', 'serialization'] as const)(
        'Canvas 跨域污染在 %s 阶段失败时关闭，不把 URL 发给 runtime',
        async (failureStage) => {
            const sendMessage = vi.fn();
            const securityError = new DOMException('The canvas has been tainted', 'SecurityError');
            const context = {
                drawImage: vi.fn(),
                getImageData: vi.fn(() => {
                    if (failureStage === 'pixel-read') throw securityError;
                    return {};
                }),
            };
            const canvas = {
                width: 0,
                height: 0,
                getContext: vi.fn(() => context),
                toDataURL: vi.fn(() => {
                    if (failureStage === 'serialization') throw securityError;
                    return 'data:image/png;base64,unused';
                }),
            };
            vi.stubGlobal('browser', {runtime: {sendMessage}});
            vi.stubGlobal('document', {createElement: vi.fn(() => canvas)});

            await expect(getImageData(imageElement())).rejects.toThrow('跨域 CORS 限制');
            expect(sendMessage).not.toHaveBeenCalled();
        },
    );
});
