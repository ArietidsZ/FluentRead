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

    it('图片请求期间离开后在取消或错误恢复为空闲态时释放悬浮状态', () => {
        const source = readFileSync(resolve(__dirname, '../src/features/image-translation/content/runtime.ts'), 'utf8');

        expect(source).toContain('if (state.phase !== \'idle\' || state.hovered) return;');
        expect(source).toContain("if (state.phase === 'idle' && !state.hovered) removeState(state);");
        expect(source).toMatch(/function hideImageButton[\s\S]*?if \(!state\) return;\s+setStateHovered\(state, false\);/u);
        expect(source).not.toContain("if (!state || state.phase !== 'idle') return;");
        expect(source).toMatch(/function restoreImageTranslation[\s\S]*?setButtonState\(state, 'idle', '翻译图片'\);\s+updateOverlayPosition\(state\);\s+scheduleIdleStateRemoval\(state\);/u);
        expect(source).toMatch(/const errorResetTimer = window\.setTimeout[\s\S]*?if \(state\.errorResetTimer !== errorResetTimer\) return;\s+state\.errorResetTimer = null;/u);
        expect(source).toMatch(/if \(state.phase === 'error' && states\.get\(state\.image\) === state\)[\s\S]*?scheduleIdleStateRemoval\(state\);/u);
        expect(source.match(/clearErrorResetTimer\(state\);/gu)).toHaveLength(4);
    });
});
