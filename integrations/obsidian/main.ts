/**
 * FluentRead 的 Obsidian 桌面插件入口：显式触发翻译，并在库内创建相邻双语笔记。
 */
import {MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl} from 'obsidian';
import {translationLanguageOptions} from '../../src/core/language/catalog';
import {DOCUMENT_MAX_BYTES, parseDocument, renderDocument} from '../../src/features/document-translation/core/document';
import {prepareMarkdownSegments} from './markdown';
import {renderBilingualPdfNote} from './output';
import {disposePdfWorker, extractPdfSegments} from './pdf';
import {createObsidianTranslator} from './translation';
import {createBilingualNote} from './vault';

interface FluentReadObsidianSettings {
    sourceLanguage: string;
    targetLanguage: string;
}

const LANGUAGE_OPTIONS: Record<string, string> = Object.fromEntries(
    translationLanguageOptions.map(({value, label}) => [value, label]),
);

const DEFAULT_SETTINGS: FluentReadObsidianSettings = {sourceLanguage: 'auto', targetLanguage: 'zh-Hans'};

function canTranslate(file: TFile | null): file is TFile {
    return !!file && ['md', 'markdown', 'pdf'].includes(file.extension.toLowerCase());
}

class FluentReadSettingsTab extends PluginSettingTab {
    constructor(private readonly plugin: FluentReadObsidianPlugin) {
        super(plugin.app, plugin);
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();
        new Setting(containerEl).setName('FluentRead document translation').setHeading();
        containerEl.createEl('p', {
            text: 'Choose the languages for translated notes. Source text is sent to Microsoft Translator when you run a command; the original vault file is never changed.',
        });
        new Setting(containerEl).setName('Source language').addDropdown((dropdown) => {
            dropdown.addOption('auto', 'Auto detect');
            Object.entries(LANGUAGE_OPTIONS).forEach(([code, label]) => dropdown.addOption(code, label));
            dropdown.setValue(this.plugin.settings.sourceLanguage);
            dropdown.onChange(async (value) => {
                this.plugin.settings.sourceLanguage = value;
                await this.plugin.saveSettings();
            });
        });
        new Setting(containerEl).setName('Target language').addDropdown((dropdown) => {
            Object.entries(LANGUAGE_OPTIONS).forEach(([code, label]) => dropdown.addOption(code, label));
            dropdown.setValue(this.plugin.settings.targetLanguage);
            dropdown.onChange(async (value) => {
                this.plugin.settings.targetLanguage = value;
                await this.plugin.saveSettings();
            });
        });
    }
}

export default class FluentReadObsidianPlugin extends Plugin {
    settings: FluentReadObsidianSettings = {...DEFAULT_SETTINGS};
    private readonly translator = createObsidianTranslator(requestUrl);
    private readonly jobs = new Map<string, {controller: AbortController; notice: Notice}>();

    async onload(): Promise<void> {
        const stored = await this.loadData() as Partial<FluentReadObsidianSettings> | null;
        const source = stored?.sourceLanguage;
        const target = stored?.targetLanguage;
        this.settings = {
            sourceLanguage: source && (source === 'auto' || Object.hasOwn(LANGUAGE_OPTIONS, source))
                ? source : DEFAULT_SETTINGS.sourceLanguage,
            targetLanguage: target && Object.hasOwn(LANGUAGE_OPTIONS, target)
                ? target : DEFAULT_SETTINGS.targetLanguage,
        };
        this.addSettingTab(new FluentReadSettingsTab(this));
        this.addCommand({
            id: 'translate-active-document',
            name: 'Translate current Markdown note or PDF',
            checkCallback: (checking) => {
                const file = this.app.workspace.getActiveFile();
                if (!canTranslate(file)) return false;
                if (!checking) void this.translateFile(file);
                return true;
            },
        });
        this.addCommand({
            id: 'cancel-document-translation',
            name: 'Cancel document translation',
            checkCallback: (checking) => {
                if (this.jobs.size === 0) return false;
                if (!checking) this.jobs.forEach(({controller}) => controller.abort());
                return true;
            },
        });
        this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
            if (!(file instanceof TFile) || !canTranslate(file)) return;
            menu.addItem((item) => item
                .setTitle('Translate with FluentRead')
                .setIcon('languages')
                .onClick(() => { void this.translateFile(file); }));
        }));
    }

    onunload(): void {
        this.jobs.forEach(({controller, notice}) => {
            controller.abort();
            notice.hide();
        });
        this.jobs.clear();
        disposePdfWorker();
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    private async translateFile(file: TFile): Promise<void> {
        if (!canTranslate(file)) return;
        if (this.jobs.has(file.path)) {
            new Notice('FluentRead is already translating this file.');
            return;
        }
        if (file.stat.size > DOCUMENT_MAX_BYTES) {
            new Notice('This file exceeds FluentRead’s 10 MB document limit.');
            return;
        }
        const sourceSnapshot = {mtime: file.stat.mtime, size: file.stat.size};
        const controller = new AbortController();
        const notice = new Notice(`FluentRead: reading ${file.name}…`, 0);
        this.jobs.set(file.path, {controller, notice});
        try {
            const isPdf = file.extension.toLowerCase() === 'pdf';
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            const source = isPdf ? '' : activeView?.file?.path === file.path
                ? activeView.getViewData() : await this.app.vault.read(file);
            if (!isPdf && new TextEncoder().encode(source).byteLength > DOCUMENT_MAX_BYTES) {
                throw new Error('This note exceeds FluentRead’s 10 MB document limit.');
            }
            const document = isPdf ? null : parseDocument(file.name, source);
            const segments = isPdf
                ? await extractPdfSegments(await this.app.vault.readBinary(file))
                : document!.segments;
            if (controller.signal.aborted) return;
            if (segments.length === 0) throw new Error('No translatable text was found in this file.');
            const translations = await this.translator(isPdf ? segments : prepareMarkdownSegments(segments), {
                fileName: file.name,
                sourceLanguage: this.settings.sourceLanguage,
                targetLanguage: this.settings.targetLanguage,
                signal: controller.signal,
                onProgress: ({completed, total}) => notice.setMessage(`FluentRead: ${file.name} · ${completed}/${total}`),
            });
            if (controller.signal.aborted) return;
            if (!isPdf && activeView?.file?.path === file.path && activeView.getViewData() !== source) {
                throw new Error('The source note changed during translation. Please try again.');
            }
            const content = isPdf
                ? renderBilingualPdfNote(file.path, segments, translations)
                : renderDocument(document!, translations, 'bilingual');
            const output = await createBilingualNote(this.app.vault, file, sourceSnapshot, content, controller.signal);
            if (!controller.signal.aborted) {
                await this.app.workspace.getLeaf('split').openFile(output);
                new Notice(`FluentRead: created ${output.name}`);
            }
        } catch (error) {
            if (!controller.signal.aborted) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                new Notice(`FluentRead: ${message}`);
            }
        } finally {
            notice.hide();
            this.jobs.delete(file.path);
        }
    }
}
