/**
 * @file src/app/content/xGrokPageBridge.ts
 * 文件职责：为 X/Grok MAIN-world 时间线请求桥和动态激活器提供 app 层稳定启动入口。
 * 主要内容：把 feature 内的安装与激活函数分别重命名为 WXT entrypoint 可直接调用的 start 函数。
 * 模块边界：本文件不决定配置、不注册动态脚本，也不改写 URL；所有网络边界与宿主方法恢复留在 feature 页面桥内。
 */

export {
    activateXGrokPageBridge as startXGrokPageBridgeActivatorApp,
    installXGrokPageBridge as startXGrokPageBridgeApp,
} from '@/src/features/x-grok-translation/content/pageBridge';
