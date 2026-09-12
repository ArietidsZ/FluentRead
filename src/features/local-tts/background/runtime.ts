/**
 * @file src/features/local-tts/background/runtime.ts
 * 文件职责：装配本地 TTS 模型管理的后台消息 handler。
 */

import {LOCAL_TTS_MODEL_STATE_KEY} from '@/src/core/config/localTts';
import {localTtsOffscreenAdapter} from './offscreenAdapter';
import {createLocalTtsBackgroundHandlers} from './handlers';

export function createLocalTtsBackgroundRuntime() {
    return createLocalTtsBackgroundHandlers({
        offscreen: localTtsOffscreenAdapter,
        storage: {
            get: async (key) => browser.storage.local.get(key),
            set: async (value) => { await browser.storage.local.set(value); },
        },
    });
}

export {LOCAL_TTS_MODEL_STATE_KEY};
