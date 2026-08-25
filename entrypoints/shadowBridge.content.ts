import {startShadowBridgeApp} from '@/src/app/content/shadowBridge';

export default defineContentScript({
    matches: ['<all_urls>'],
    runAt: 'document_start',
    world: 'MAIN',
    globalName: false,
    main: startShadowBridgeApp,
});
