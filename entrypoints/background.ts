import {startBackgroundApp} from '@/src/app/background/runtime';

/**
 * WXT 后台入口只声明 worker 生命周期；消息、菜单与缓存维护由 app composition root 组装。
 */
export default defineBackground({
    persistent: {
        safari: false,
    },
    main: startBackgroundApp,
});
