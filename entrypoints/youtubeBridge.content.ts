import {startYoutubeTimedTextBridgeApp} from '@/src/app/content/youtubeTimedTextBridge';

export default defineContentScript({
  matches: ['*://*.youtube.com/watch*', '*://*.youtube.com/shorts*', '*://youtube.com/watch*', '*://youtube.com/shorts*'],
  runAt: 'document_start',
  world: 'MAIN',
  globalName: false,
  main: startYoutubeTimedTextBridgeApp,
});
