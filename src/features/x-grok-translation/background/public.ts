/**
 * @file src/features/x-grok-translation/background/public.ts
 * 文件职责：定义 X/Grok 原生翻译 feature 的后台公共出口，隔离配置存储和 scripting 动态注册副作用。
 * 主要内容：只再导出 installXGrokPageBridgeRegistration，供后台 composition root 在 worker 启动时安装首屏激活器协调器。
 * 模块边界：内容脚本不得通过此出口导入后台配置运行时；纯匹配和注册算法位于 registrationCore，页面桥位于 content。
 */

export {installXGrokPageBridgeRegistration} from './registration';
