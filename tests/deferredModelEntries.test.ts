import {describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({translation:vi.fn(),tts:vi.fn(),video:vi.fn(),qwen:vi.fn(),deferred:vi.fn(async(load:()=>Promise<void>)=>load())}));
vi.mock('@/src/app/offscreen/deferredWorker',()=>({startDeferredWorker:mocks.deferred}));
vi.mock('@/src/features/local-translation/offscreen/translation.worker',()=>({startLocalTranslationWorker:mocks.translation}));
vi.mock('@/src/features/local-tts/offscreen/tts.worker',()=>({startLocalTtsWorker:mocks.tts}));
vi.mock('@/src/features/video-subtitle/offscreen/transcription.worker',()=>({startVideoTranscriptionWorker:mocks.video}));
vi.mock('@/src/features/video-subtitle/offscreen/qwen/worker',()=>({startQwenAsrWorker:mocks.qwen}));
import {startQwenAsrWorkerApp} from '@/src/app/offscreen/qwenAsrWorker';
import {startLocalTranslationWorkerApp} from '@/src/app/offscreen/localTranslationWorker';
import {startLocalTtsWorkerApp} from '@/src/app/offscreen/localTtsWorker';
import {startVideoTranscriptionWorkerApp} from '@/src/app/offscreen/videoTranscriptionWorker';
describe('model worker composition',()=>{
    it('defers all heavy runtimes through the request-preserving startup boundary',async()=>{
        expect(mocks.translation).not.toHaveBeenCalled();expect(mocks.tts).not.toHaveBeenCalled();expect(mocks.video).not.toHaveBeenCalled();
        await startLocalTranslationWorkerApp();await startLocalTtsWorkerApp();await startVideoTranscriptionWorkerApp();await startQwenAsrWorkerApp();
        expect(mocks.deferred).toHaveBeenCalledTimes(4);expect(mocks.translation).toHaveBeenCalledOnce();expect(mocks.tts).toHaveBeenCalledOnce();expect(mocks.video).toHaveBeenCalledOnce();expect(mocks.qwen).toHaveBeenCalledOnce();
    });
});
