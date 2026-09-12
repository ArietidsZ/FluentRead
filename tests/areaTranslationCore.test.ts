import { describe, expect, it } from 'vitest';
import { areaRectToImageCrop, isUsableAreaRect, normalizeAreaRect } from '@/src/features/area-translation/core';
import {
    areaTranslationHotkeyDisplayName,
    AREA_TRANSLATION_HOTKEY_OPTIONS,
    DEFAULT_AREA_TRANSLATION_HOTKEY,
    matchesAreaTranslationHotkey,
    normalizeAreaTranslationHotkey,
    normalizeCustomAreaTranslationHotkey,
    resolveAreaTranslationHotkey,
} from '@/src/core/config/areaTranslation';

function keyboardEvent(init: Partial<KeyboardEvent>): KeyboardEvent {
    return {
        key: '',
        code: '',
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        ...init,
    } as KeyboardEvent;
}

describe('圈选翻译快捷键配置', () => {
    it('预设只接受列表内的组合键，其他取值回到默认 Shift+Z', () => {
        expect(DEFAULT_AREA_TRANSLATION_HOTKEY).toBe('Shift+Z');
        expect(AREA_TRANSLATION_HOTKEY_OPTIONS.map(option => option.value)).toContain('Alt+Z');
        expect(normalizeAreaTranslationHotkey('custom')).toBe('custom');
        expect(normalizeAreaTranslationHotkey('shift+x')).toBe('Shift+X');
        expect(normalizeAreaTranslationHotkey('option+z')).toBe('Alt+Z');
        for (const invalid of [undefined, null, 42, '', 'none', 'Shift', 'Ctrl+C', 'Alt+F4']) {
            expect(normalizeAreaTranslationHotkey(invalid)).toBe('Shift+Z');
        }
    });

    it('自定义组合键保存为规范写法，无法解析时留空', () => {
        expect(normalizeCustomAreaTranslationHotkey('option+shift+k')).toBe('Alt+Shift+K');
        expect(normalizeCustomAreaTranslationHotkey('ctrl+f9')).toBe('Ctrl+F9');
        for (const invalid of [undefined, null, 7, '', 'z', 'cmd+z']) {
            expect(normalizeCustomAreaTranslationHotkey(invalid)).toBe('');
        }
    });

    it('选择自定义但尚未录制成功时仍然保留默认入口', () => {
        expect(resolveAreaTranslationHotkey('Shift+X', 'Alt+K')).toBe('Shift+X');
        expect(resolveAreaTranslationHotkey('custom', 'alt+k')).toBe('Alt+K');
        expect(resolveAreaTranslationHotkey('custom', '')).toBe('Shift+Z');
        expect(resolveAreaTranslationHotkey('custom', 'cmd+k')).toBe('Shift+Z');
        // 显示名称跟随平台习惯：macOS 写作 Control/Option，其他系统写作 Ctrl/Alt。
        expect(['Ctrl+Shift+K', 'Control+Shift+K']).toContain(areaTranslationHotkeyDisplayName('custom', 'ctrl+shift+k'));
        expect(areaTranslationHotkeyDisplayName('Shift+X', '')).toBe('Shift+X');
    });

    it('按已配置的组合键匹配事件，修饰键必须完全一致', () => {
        const shiftZ = keyboardEvent({key: 'Z', code: 'KeyZ', shiftKey: true});
        expect(matchesAreaTranslationHotkey(shiftZ, 'Shift+Z', '')).toBe(true);
        expect(matchesAreaTranslationHotkey(keyboardEvent({key: 'z', code: 'KeyZ'}), 'Shift+Z', '')).toBe(false);
        expect(matchesAreaTranslationHotkey(keyboardEvent({key: 'Z', code: 'KeyZ', shiftKey: true, altKey: true}), 'Shift+Z', '')).toBe(false);
        expect(matchesAreaTranslationHotkey(shiftZ, 'custom', 'Alt+X')).toBe(false);
        // macOS 上 Option+X 会把 key 变成不可配置字形，匹配必须回退到物理 code。
        expect(matchesAreaTranslationHotkey(keyboardEvent({key: '≈', code: 'KeyX', altKey: true}), 'custom', 'Alt+X')).toBe(true);
    });
});

describe('圈选翻译区域几何', () => {
    it('支持从任意方向拖拽，并把矩形限制在视口内', () => {
        expect(normalizeAreaRect({ x: 500, y: 400 }, { x: -20, y: 40 }, { width: 480, height: 360 })).toEqual({
            left: 0,
            top: 40,
            width: 480,
            height: 320,
        });
        expect(normalizeAreaRect({ x: Number.NaN, y: Number.POSITIVE_INFINITY }, { x: 8, y: 9 }, { width: Number.NaN, height: 0 })).toEqual({
            left: 0,
            top: 0,
            width: 1,
            height: 1,
        });
    });

    it('过滤过小的误触区域', () => {
        expect(isUsableAreaRect({ left: 0, top: 0, width: 11, height: 40 })).toBe(false);
        expect(isUsableAreaRect({ left: 0, top: 0, width: 12, height: 12 })).toBe(true);
    });

    it('把 CSS 视口矩形映射为高 DPI 截图像素坐标', () => {
        expect(areaRectToImageCrop({
            left: 50,
            top: 25,
            width: 200,
            height: 100,
            viewportWidth: 500,
            viewportHeight: 250,
        }, 1000, 500)).toEqual({ left: 100, top: 50, width: 400, height: 200 });
    });
});
