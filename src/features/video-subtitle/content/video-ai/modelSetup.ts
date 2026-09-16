/**
 * @file src/features/video-subtitle/content/video-ai/modelSetup.ts
 * 文件职责：编排首次请求 X 本地 AI 字幕时的模型确认：读取已下载模型，缺失时提供带推荐的模型选择，确认后下载并启动识别。
 * 主要内容：维护检查中、下载中与待确认选择三种状态；默认推荐 Tiny，读取与下载期间的视频、源语言或模型变化会作废旧结果，失败时交给运行时展示错误。
 * 模块边界：只通过注入的消息端口与回调工作，不读写 DOM、配置存储或播放器；菜单渲染、焦点和识别会话由 runtime 与 playerMenu 负责。
 */
import {
    requestDownloadedLocalVideoModels,
    requestLocalVideoModelDownload,
    type LocalVideoModelDownloadSender,
    type LocalVideoModelStatusSender,
} from '../localModelReadiness';
import {
    VIDEO_LOCAL_TRANSCRIPTION_RECOMMENDED_MODEL,
    type VideoLocalTranscriptionModel,
} from '@/src/features/video-subtitle/transcription';

export interface VideoAiModelChoice {
    readonly downloaded: readonly VideoLocalTranscriptionModel[];
    readonly recommended: VideoLocalTranscriptionModel;
    readonly selected: VideoLocalTranscriptionModel;
}

export interface VideoAiModelSetupDependencies {
    readonly sendMessage: LocalVideoModelStatusSender & LocalVideoModelDownloadSender;
    readonly getConfiguredModel: () => VideoLocalTranscriptionModel;
    /** 记录发起请求时的视频与语言，返回的函数在异步结果到达时判断请求是否仍然有效。 */
    readonly captureRequest: () => () => boolean;
    readonly persistModel: (model: VideoLocalTranscriptionModel) => void;
    readonly startGeneration: () => void;
    readonly setError: (message: string) => void;
    readonly formatDownloadError: (message: string) => string;
    readonly onChange: () => void;
}

export interface VideoAiModelSetup {
    readonly checking: boolean;
    readonly downloading: boolean;
    readonly choice: VideoAiModelChoice | null;
    /** 缓存未命中后调用：模型已下载则直接生成，否则在允许时打开模型确认。 */
    request(canShowChoice: () => boolean): Promise<void>;
    select(model: VideoLocalTranscriptionModel): void;
    cancel(): void;
    confirm(): Promise<void>;
}

export function createVideoAiModelSetup(dependencies: VideoAiModelSetupDependencies): VideoAiModelSetup {
    let checking = false;
    let downloading = false;
    let choice: VideoAiModelChoice | null = null;

    return {
        get checking() { return checking; },
        get downloading() { return downloading; },
        get choice() { return choice; },

        async request(canShowChoice) {
            if (checking || downloading) return;
            const isCurrent = dependencies.captureRequest();
            const model = dependencies.getConfiguredModel();
            checking = true;
            dependencies.setError('');
            dependencies.onChange();
            let downloaded: VideoLocalTranscriptionModel[];
            try {
                downloaded = await requestDownloadedLocalVideoModels(dependencies.sendMessage);
            } catch (error) {
                // 状态端口只抛出带可展示文案的 Error；失效请求不覆盖新视频的状态。
                if (isCurrent()) dependencies.setError((error as Error).message);
                return;
            } finally {
                checking = false;
                dependencies.onChange();
            }
            if (!isCurrent() || model !== dependencies.getConfiguredModel()) return;
            if (downloaded.includes(model)) {
                dependencies.startGeneration();
                return;
            }
            if (!canShowChoice()) return;
            // 已下载的其他模型无需等待下载；否则沿用设置中的模型，默认即推荐的 Tiny。
            choice = {downloaded, recommended: VIDEO_LOCAL_TRANSCRIPTION_RECOMMENDED_MODEL, selected: downloaded[0] ?? model};
            dependencies.onChange();
        },

        select(model) {
            if (!choice) return;
            choice = {...choice, selected: model};
            dependencies.onChange();
        },

        cancel() {
            if (!choice) return;
            choice = null;
            dependencies.onChange();
        },

        async confirm() {
            const confirmed = choice;
            if (!confirmed) return;
            choice = null;
            const model = confirmed.selected;
            const isCurrent = dependencies.captureRequest();
            if (model !== dependencies.getConfiguredModel()) dependencies.persistModel(model);
            if (!confirmed.downloaded.includes(model)) {
                downloading = true;
                dependencies.setError('');
                dependencies.onChange();
                try {
                    await requestLocalVideoModelDownload(model, dependencies.sendMessage);
                } catch (error) {
                    dependencies.setError(dependencies.formatDownloadError((error as Error).message));
                    return;
                } finally {
                    downloading = false;
                    dependencies.onChange();
                }
            } else {
                dependencies.onChange();
            }
            // 下载期间可能换视频、改源语言、改模型或关闭翻译；此时只保留已下载的模型，不启动识别。
            if (isCurrent() && model === dependencies.getConfiguredModel()) dependencies.startGeneration();
        },
    };
}
