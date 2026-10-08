# Neo 临时 profile 批准后的技术前提

用户在 2026-10-08 08:00 UTC 批准隔离临时 Neo profile 开启开发者模式、加载已核验扩展，并要求测试窗口不抢焦点。本轮不重复请求同一许可。

验收构建仍为 **`89fd05806c4c41778e8a47817988130ef09ca583`** / tree **`8b7ee997b8a30f90640d888a85703fbc416fe409`**，797 个产物 SHA256 全部复核一致，工作区干净。它与无痕修正 `4868aabe` 分开记录；没有把任一版本的离线结果当作另一个版本的运行验收。

已验证的机制：

- CW 是 GNOME Wayland。Cua 0.34.0 binary SHA256 `5fa60c7ab35194e0e050a337521ca0e0b0ae0a8fe898813b340f65c94e15264c`，原 19 GUI 工具策略 SHA256 `99b5606209886bf57e04e3bd456479afc2b24b7965f15dd0667be85a68bb540a` 未变，没有扩大策略。
- 已运行 WinRects **v8**，只做 D-Bus Introspect/GetVersion。其 GetRects 能提供矩形与焦点观察，另有 Activate；没有窗口创建、移动/放置或不激活启动方法。未调用 Activate/Capture/输入。
- 当前 Neo MCP **0.0.67** 的 tools/list 文档支持现有会话后台 tabs.new；windows.create 仅有 action/session/windowId，没有 focus、geometry 或新 profile 参数。现有实例属于 pi-agent profile，不能直接替代获准的新临时 profile。没有调用这些 GUI 方法或创建窗口。
- 仓库一键浏览器回归强制 helper；图片专项要求 `launchFocusSafePersistentContext` / `newPageWithoutForeground`，返回 context、launchMode、focusPolicy、windowPlacement 和 close，区域还需 `activateExtensionTabWithoutForeground`。旧图片脚本硬断言 `macos-background-cdp`、`launchservices-no-foreground`、`background-visible-no-focus`、browserFrontmost=false；Linux 不能伪造这些标签。符合相同约束的原生 Linux 小型测试路径需要真实的隔离和焦点证据，不能静默用普通启动替代。
- 宿主没有 Xvfb、Xephyr、Xvnc 或 Xtigervnc。`/tmp/.X11-unix/X0/X1` 都由当前 GNOME/Xwayland 持有，不是隔离显示。另一个 Xvnc 的 `/opt/base/bin/Xvnc` 只存在于不同 mnt/net/ipc/user 命名空间，父进程为 cinit/conmon；宿主不可用，没有进入或复用它。
- dbus-run-session 与 xauth 已安装，但独立显示、独立 session bus/显示绑定和新 Neo 实例受支持的 MCP 连接尚未建立。只有不同 DISPLAY/profile 不能作为隔离证明。没有创建显示、bus、helper 或新 listener，没有读认证文件正文。

因此停在启动之前：**真实扩展 GUI 用例 0、GUI 输入 0**。没有新建临时 profile、改开发者模式、加载扩展、启动合成夹具服务、修改全局 DISPLAY、影响 Recovery/日常会话。并发重连、取消、导航/新 owner 和 RTX5090 WebGPU 均未运行。

下一步由主线程选择最小方案：准备在当前政策内可证实的原生非激活窗口路径；或另行批准为独立 headed 虚拟显示补齐软件及独立 bus/authority/Neo 连接；或向用户说明具体焦点影响后选择严格限定的临时前台测试。当前批准没有豁免焦点限制，也不需要用户搬运 helper 路径。将来虚拟显示结果仅可作为 Port 夹具证据，不可宣称日常桌面或真实 RTX5090 验收。
