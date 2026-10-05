/**
 * @file src/features/image-translation/services/gpuPaddle.ts
 * 文件职责：以显式 WebGPU 会话初始化轻量 Paddle 识别器，避免 SDK 默认自动切换 CPU。
 * 主要内容：顺序创建检测与识别会话以降低启动峰值，直接复用 SDK 的公开检测与识别适配器，完整释放部分初始化资源并保留原始错误。
 * 模块边界：只接收已校验的模型字节和 OCR 参数；不下载、不选语言、不访问网页，不实现软件 GPU 或 CPU 生产回退。
 */
import {PaddleOcrService, DetectionService, RecognitionService, type PaddleOptions} from 'ppu-paddle-ocr/web';
import {InferenceSession} from 'onnxruntime-web/webgpu';
import {captureGpuSessionFailure, gpuSessionOptions} from '@/src/shared/onnx/gpuSession';
import {assertMangaOcrActive} from './mangaOcrAssets';

type ModelBytes = {detection: ArrayBuffer; recognition: ArrayBuffer; charactersDictionary: ArrayBuffer};

export class GpuPaddleService extends PaddleOcrService {
    private checks: Array<() => void> = [];
    constructor(private modelBytes: ModelBytes | undefined, options: PaddleOptions, private signal?: AbortSignal) {
        super(options);
    }
    override async initialize(): Promise<void> {
        const model = this.modelBytes;
        if (!model) throw new Error('GPU OCR 模型已释放，请重新创建识别会话');
        try {
            assertMangaOcrActive(this.signal);
            const charactersDictionary = new TextDecoder().decode(model.charactersDictionary).split(/\r?\n/);
            if (!charactersDictionary.some(character => character.length > 0)) throw new Error('GPU OCR 字典为空');
            this.detectionSession = await InferenceSession.create(model.detection, gpuSessionOptions());
            assertMangaOcrActive(this.signal);
            this.recognitionSession = await InferenceSession.create(model.recognition, gpuSessionOptions('paddle-recognition-shapes'));
            assertMangaOcrActive(this.signal);
            this.checks = [this.detectionSession, this.recognitionSession].map(captureGpuSessionFailure);
            this.options.recognition = {...this.options.recognition, charactersDictionary};
            this.detector = new DetectionService(this.detectionSession, this.options.detection, this.options.debugging);
            this.recognitor = new RecognitionService(this.recognitionSession, this.options.recognition, this.options.debugging);
        } catch (error) {
            await this.destroy();
            throw error;
        } finally {
            // SDK 不需要重新下载或重载模型；会话初始化后立即解除对原始模型字节的持有。
            this.modelBytes = undefined;
            this.signal = undefined;
        }
    }
    async recognizeManga(canvas: HTMLCanvasElement, options: {flatten: true; noCache: true; strategy: 'per-box'}) {
        try { return await this.recognize(canvas, options); }
        finally { this.checks.forEach(check => check()); }
    }
    override async destroy(): Promise<void> {
        const sessions = [this.detectionSession, this.recognitionSession];
        this.detectionSession = null; this.recognitionSession = null;
        this.detector = null; this.recognitor = null;
        this.modelBytes = undefined; this.signal = undefined; this.checks = [];
        // 驱动失效时一个释放失败仍必须尝试释放另一个，清理异常不得覆盖推理错误。
        await Promise.allSettled(sessions.map(session => Promise.resolve().then(() => session?.release())));
    }
}
