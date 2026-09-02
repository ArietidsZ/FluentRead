/**
 * @file src/features/settings/ui/useTranslationShortcutSettings.ts
 * 文件职责：协调设置页旧快捷键入口与额外快捷翻译方案之间的冲突、对话框生命周期和取消恢复。
 * 主要内容：集中管理悬浮、全文、划词及输入框快捷键的选择、校验、显示名称与自定义录制状态。
 * 模块边界：本模块只编排 Vue 设置状态和提示，不注册网页按键、不保存配置、不执行翻译；持久化仍由 SettingsSections 的统一配置链路负责。
 */
import {ref, type Ref} from 'vue';
import {ElMessage} from 'element-plus';

import type {Config} from '@/src/core/config/model';
import {
    findEnabledQuickTranslationHotkeyConflict,
    inputBoxTranslationTriggerHotkey,
} from '@/src/core/config/quickTranslation';
import {parseHotkey, resolveConfiguredHotkey} from '@/src/core/hotkey';
import {useUiI18n} from '@/src/ui/i18n';

const selectionShortcutTriggers = new Set(['Control', 'Alt', 'Shift', 'custom']);

export function useTranslationShortcutSettings(config: Ref<Config>) {
    const {t, translateLegacy} = useUiI18n();
    const showCustomHotkeyDialog = ref(false);
    const showCustomMouseHotkeyDialog = ref(false);
    const showCustomSelectionHotkeyDialog = ref(false);
    const previousFullPageHotkey = ref('');
    const previousMouseHotkey = ref('');
    const previousSelectionTrigger = ref('');

    function quickTranslationConflictMessage(hotkey: string): string {
        const conflict = findEnabledQuickTranslationHotkeyConflict(config.value.quickTranslationProfiles, hotkey);
        if (!conflict) return '';
        const group = t(`quickTranslation.heading.${conflict.action === 'hover' ? 'hover' : 'fullPage'}`);
        return t('quickTranslation.conflictProfile', {group});
    }

    const validateCustomFullPageHotkey = (hotkey: string) => quickTranslationConflictMessage(hotkey);
    const validateCustomMouseHotkey = (hotkey: string) => quickTranslationConflictMessage(hotkey);

    function handleHotkeyChange(value: string) {
        const conflictMessage = quickTranslationConflictMessage(resolveConfiguredHotkey(
            value,
            config.value.customFloatingBallHotkey,
        ));
        if (conflictMessage) {
            ElMessage.warning(conflictMessage);
            return;
        }
        if (value === 'custom' && !config.value.customFloatingBallHotkey) {
            previousFullPageHotkey.value = config.value.floatingBallHotkey;
        }
        config.value.floatingBallHotkey = value;
        if (value === 'custom' && !config.value.customFloatingBallHotkey) {
            setTimeout(() => openCustomHotkeyDialog(), 100);
        }
    }

    function openCustomHotkeyDialog() {
        showCustomHotkeyDialog.value = true;
    }

    function handleCustomHotkeyConfirm(hotkey: string) {
        if (quickTranslationConflictMessage(hotkey)) return;
        config.value.customFloatingBallHotkey = hotkey === 'none' ? '' : hotkey;
        config.value.floatingBallHotkey = hotkey === 'none' ? 'none' : 'custom';
        showCustomHotkeyDialog.value = false;
        previousFullPageHotkey.value = '';
        ElMessage({
            message: hotkey === 'none'
                ? t('quickTranslation.shortcutDisabled')
                : t('quickTranslation.shortcutSet', {shortcut: getCustomHotkeyDisplayName()}),
            type: 'success',
            duration: 2000,
        });
    }

    function handleCustomHotkeyCancel() {
        if (!config.value.customFloatingBallHotkey) {
            config.value.floatingBallHotkey = previousFullPageHotkey.value || 'Alt+T';
        }
        previousFullPageHotkey.value = '';
    }

    function getCustomHotkeyDisplayName(): string {
        if (!config.value.customFloatingBallHotkey) return '';
        if (config.value.customFloatingBallHotkey === 'none') return translateLegacy('已禁用');
        const parsed = parseHotkey(config.value.customFloatingBallHotkey);
        return parsed.isValid ? parsed.displayName : config.value.customFloatingBallHotkey;
    }

    function handleMouseHotkeyChange(value: string) {
        const conflictMessage = quickTranslationConflictMessage(resolveConfiguredHotkey(
            value,
            config.value.customHotkey,
        ));
        if (conflictMessage) {
            ElMessage.warning(conflictMessage);
            return;
        }
        if (value === 'custom' && !config.value.customHotkey) previousMouseHotkey.value = config.value.hotkey;
        config.value.hotkey = value;
        if (value === 'custom' && !config.value.customHotkey) {
            setTimeout(() => openCustomMouseHotkeyDialog(), 100);
        }
    }

    function handleInputBoxTranslationTriggerChange(value: string) {
        const hotkey = inputBoxTranslationTriggerHotkey(value);
        const conflictMessage = hotkey ? quickTranslationConflictMessage(hotkey) : '';
        if (conflictMessage) {
            ElMessage.warning(conflictMessage);
            return;
        }
        config.value.inputBoxTranslationTrigger = value;
    }

    function handleSelectionTriggerChange(value: string) {
        if (value === 'custom' && !config.value.customSelectionTranslatorHotkey) {
            previousSelectionTrigger.value = config.value.selectionTranslatorTrigger;
        }
        config.value.selectionTranslatorTrigger = value;
        config.value.selectionTranslatorHotkey = selectionShortcutTriggers.has(value) ? value : 'none';
        if (value === 'custom' && !config.value.customSelectionTranslatorHotkey) {
            setTimeout(() => openCustomSelectionHotkeyDialog(), 100);
        }
    }

    function openCustomSelectionHotkeyDialog() {
        showCustomSelectionHotkeyDialog.value = true;
    }

    function handleCustomSelectionHotkeyConfirm(hotkey: string) {
        if (hotkey === 'none') {
            config.value.customSelectionTranslatorHotkey = '';
            config.value.selectionTranslatorTrigger = 'icon';
            config.value.selectionTranslatorHotkey = 'none';
        } else {
            config.value.customSelectionTranslatorHotkey = hotkey;
            config.value.selectionTranslatorTrigger = 'custom';
            config.value.selectionTranslatorHotkey = 'custom';
        }
        showCustomSelectionHotkeyDialog.value = false;
        previousSelectionTrigger.value = '';
        ElMessage({
            message: hotkey === 'none'
                ? t('quickTranslation.selectionShortcutDisabled')
                : t('quickTranslation.selectionShortcutSet', {shortcut: getCustomSelectionHotkeyDisplayName()}),
            type: 'success',
            duration: 2000,
        });
    }

    function handleCustomSelectionHotkeyCancel() {
        if (!config.value.customSelectionTranslatorHotkey) {
            const trigger = previousSelectionTrigger.value || 'icon';
            config.value.selectionTranslatorTrigger = trigger;
            config.value.selectionTranslatorHotkey = selectionShortcutTriggers.has(trigger) ? trigger : 'none';
        }
        previousSelectionTrigger.value = '';
    }

    function getCustomSelectionHotkeyDisplayName(): string {
        if (!config.value.customSelectionTranslatorHotkey) return '';
        if (config.value.customSelectionTranslatorHotkey === 'none') return translateLegacy('已禁用');
        const parsed = parseHotkey(config.value.customSelectionTranslatorHotkey);
        return parsed.isValid ? parsed.displayName : config.value.customSelectionTranslatorHotkey;
    }

    function openCustomMouseHotkeyDialog() {
        showCustomMouseHotkeyDialog.value = true;
    }

    function handleCustomMouseHotkeyConfirm(hotkey: string) {
        if (quickTranslationConflictMessage(hotkey)) return;
        config.value.customHotkey = hotkey === 'none' ? '' : hotkey;
        config.value.hotkey = hotkey === 'none' ? 'none' : 'custom';
        showCustomMouseHotkeyDialog.value = false;
        previousMouseHotkey.value = '';
        ElMessage({
            message: hotkey === 'none'
                ? t('quickTranslation.shortcutDisabled')
                : t('quickTranslation.shortcutSet', {shortcut: getCustomMouseHotkeyDisplayName()}),
            type: 'success',
            duration: 2000,
        });
    }

    function handleCustomMouseHotkeyCancel() {
        if (!config.value.customHotkey) config.value.hotkey = previousMouseHotkey.value || 'Control';
        previousMouseHotkey.value = '';
    }

    function getCustomMouseHotkeyDisplayName(): string {
        if (!config.value.customHotkey) return '';
        if (config.value.customHotkey === 'none') return translateLegacy('已禁用');
        const parsed = parseHotkey(config.value.customHotkey);
        return parsed.isValid ? parsed.displayName : config.value.customHotkey;
    }

    return {
        getCustomHotkeyDisplayName,
        getCustomMouseHotkeyDisplayName,
        getCustomSelectionHotkeyDisplayName,
        handleCustomHotkeyCancel,
        handleCustomHotkeyConfirm,
        handleCustomMouseHotkeyCancel,
        handleCustomMouseHotkeyConfirm,
        handleCustomSelectionHotkeyCancel,
        handleCustomSelectionHotkeyConfirm,
        handleHotkeyChange,
        handleInputBoxTranslationTriggerChange,
        handleMouseHotkeyChange,
        handleSelectionTriggerChange,
        openCustomHotkeyDialog,
        openCustomMouseHotkeyDialog,
        openCustomSelectionHotkeyDialog,
        quickTranslationConflictMessage,
        showCustomHotkeyDialog,
        showCustomMouseHotkeyDialog,
        showCustomSelectionHotkeyDialog,
        validateCustomFullPageHotkey,
        validateCustomMouseHotkey,
    };
}
