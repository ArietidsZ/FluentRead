# CW Xvfb 安装后 Neo 启动前检查

输入路由离线检查点已先完成：源码 `5c8dc0864016044fe2578c06b059fade722fe24e` / tree `b7e1e92636d00463cc0c01a7e59d8f51b4309748`，证据 `b6afd87fca8b556214037a34288565a8d898f431`，已普通推送并核对远端 SHA。全量 9,747/9,747、399 文件、四维覆盖率 100%。本目录只记录随后独立的安装／前置检查，不将上述应用版本混入指定的 Port 验收版本。

用户明确批准 Xvfb 后，实机确认主机为 `arietids-cw`。先模拟包事务，再从现有 Ubuntu 官方 `resolute-updates` 源安装 `xvfb 2:21.1.22-1ubuntu1.2`，仅新增一个包，零升级、零卸载。没有改源、密钥或系统安全设置，没有启动新显示或 D-Bus 会话，也没有更改现有 Cua／Neo／Recovery 服务。安装命令和实际退出码、官方源及版本记录在 `records/`；没有执行 Neo DEB postinst。

Neo 固定为 [官方 browserclaw/v0.51.0](https://github.com/browseros-ai/BrowserOS/releases/tag/browserclaw/v0.51.0)。官方 API 再次确认 `BrowserOS_neo_v0.51.0_amd64.deb` SHA256 为 `caebdfd1d105ee4fc69886361cd42a1f7c6bffaba50fd9da6c68c7977aae4d15`，本地公开暂存包完全相同。已装 browserclaw 155.0.8309.26 的浏览器 binary SHA256 `0994937730e362e40653610fd40e38d62d4160152b590f90e99971005c2e0881` 与该官方 DEB 的对应 binary 相同。只解析公开包，没有重装、执行安装脚本或读认证文件。

发现启动前阻塞：[固定版代理源码](https://github.com/browseros-ai/BrowserOS/blob/browserclaw/v0.51.0/packages/browseros/chromium_patches/chrome/browser/browseros/server/browseros_server_proxy.cc) 的 HTTP 和 HTTPS listener 均绑定 `0.0.0.0`。manager 在代理 Start 后才调用 SetAllowRemote；`allow_remote_in_mcp=false` 控制请求，不能改监听地址。Xvfb 只隔离显示，不能将新 MCP listener 隔离在主机 loopback 内。因此普通的独立 Neo MCP 启动不满足「禁止对外扩大监听」，本轮停在启动前，没有试用非许可 Cua/CDP 路径或改防火墙／网络命名空间。

一个具体、尚未执行的候选是 Neo 官方自有 loopback CDP 加 `--disable-browseros-server`：官方 [manager 源码](https://github.com/browseros-ai/BrowserOS/blob/browserclaw/v0.51.0/packages/browseros/chromium_patches/chrome/browser/browseros/server/browseros_server_manager.cc) 的 CDP factory 仅绑定 127.0.0.1／::1，启动顺序是在 sidecar-disabled 返回之前启动 CDP，在返回之后才启动代理。三个本地审计文件已与官方固定 tag 逐字比对，并记录官方 git blob 和 SHA256。具体候选 flags、独立显示／bus／profile 约束、风险和待确认范围在 `records/CONTROL-CHANNEL-PROPOSAL.json`。它会禁用该临时实例的 MCP sidecar，并允许 BrowserOS 自有 CDP 的 JavaScript/DOM 自动化；不能将其当作 GUI-only Cua 已批准能力。原委托要求网络／隐私／安全设置变更逐项确认，因此在主线程确认该精确控制模式前不执行。

Port 验收仍指定干净的 `89fd05806c4c41778e8a47817988130ef09ca583`，tree `8b7ee997b8a30f90640d888a85703fbc416fe409`；没有修改该应用工作树或把输入路由版本产物拿来替代。Linux focus-safe helper 尚未实现。既有图片／区域脚本要求 Playwright，在已检查的有限本机 package 路径没有找到可复用包；没有安装额外 Node 驱动依赖。后续可评审较小的本机 BrowserOS 通道夹具驱动，或单独明确所需依赖范围，不能伪造 macOS 标签。

本轮实际 GUI 用例 **0**。没有新 Neo、Xvfb display、独立 D-Bus、临时 profile、夹具 HTTP server 或 MCP/CDP listener；因此没有本轮进程／测试窗口需要清理。WinRects 只读 GetRects 保留窗口 ID、PID、矩形与焦点，过滤标题，未调用 Activate/Capture/输入。初轮沙箱无法连接 session bus 的记录与获准只读重试的结果分开保留。未关闭用户浏览器、迁移数据或改默认项。真实 Port 正常／并发／取消／导航／新 owner、GPU 与当前桌面 Cua 全链路均未执行。

最小下一步：主线程确认是否允许上述临时 Neo 官方 loopback CDP、禁用 managed MCP 的精确替代方案；随后实现并验证真实 Linux 隔离 helper，证明显示、D-Bus、profile、PID 和端点归属，再执行指定 89fd0580 的合成 Port 用例。虚拟显示结果只能作为该夹具运行证据，不能作为 RTX5090 WebGPU 或当前桌面 Cua 的验收结果。
