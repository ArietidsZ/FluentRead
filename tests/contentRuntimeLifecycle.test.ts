import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

describe('content runtime 页面生命周期', () => {
    it('beforeunload 与其他页面监听器共用 context 失效信号', () => {
        const source = readFileSync(resolve(__dirname, '../src/app/content/runtime.ts'), 'utf8');

        expect(source).toContain(
            "window.addEventListener('beforeunload', cleanup, {once: true, signal: pageEventController.signal});",
        );
        expect(source).not.toContain("window.addEventListener('beforeunload', cleanup, {once: true});");
    });

    it('图片 decode await 后重新校验取消信号和 controller 所有权再发布结果', () => {
        const source = readFileSync(resolve(__dirname, '../src/features/image-translation/content/runtime.ts'), 'utf8');

        expect(source).toMatch(/const translatedImage = await loadImage\(result\.image\);\s+if \(controller\.signal\.aborted \|\| state\.abortController !== controller\) return;\s+state\.translatedImage = translatedImage;/u);
    });
});
