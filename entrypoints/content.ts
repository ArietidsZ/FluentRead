import {startContentApp} from '@/src/app/content/runtime';

/**
 * WXT 内容脚本入口只声明注入元数据；页面生命周期由 app composition root 统一管理。
 */
export default defineContentScript({
    matches: ['<all_urls>'],
    runAt: 'document_end',
    cssInjectionMode: 'ui',
    main: startContentApp,
});
