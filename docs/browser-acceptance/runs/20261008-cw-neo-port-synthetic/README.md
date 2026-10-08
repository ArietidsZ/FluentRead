# CW Neo 首组真实 Port 合成验收

实际完成 5/5，通过生产图片文档 Port 的来源挑战与图片读取、真实 captureVisibleTab 截图、同 ID 双 Port 并发、跨 peer 拒绝取消及原 peer 中止、同 URL 导航后新文档复用 ID。加载应用固定为 `89fd05806c4c41778e8a47817988130ef09ca583`，tree `8b7ee997b8a30f90640d888a85703fbc416fe409`；本分支只增加测试驱动与证据。797 个产物在运行前后无变化，完整绑定见 [BINDING.json](./BINDING.json)。

使用官方 Neo `browserclaw/v0.51.0` / `155.0.8309.26`、现有 Node WebSocket/fetch、已装 Xvfb，无新增依赖。真实 headed 窗口为 normal 1280×900，位于本次认证 Xvfb 的 1440×1000 显示；独立 HOME/XDG/profile 与 D-Bus。只使用官方 `--disable-browseros-server` + `--browseros-cdp-port`，本次实际监听仅 `127.0.0.1`，启动前后日常 GNOME WinRects 中测试 PID 均为 0。未传 `--no-sandbox`，renderer 的 Seccomp=2、NoNewPrivs=1、CapEff=0；Cua GUI-only 策略 SHA 保持不变。

生产图片策略拒绝回环 HTTP，驱动因此在获批 CDP 边界为 `https://fluentread-fixture.example.com` 注入合成 PNG 响应，DNS 仍阻断外部解析。原生 Port、来源校验、offscreen 原生 fetch 与 AbortSignal 路径均实际执行；取消及导航使原生 Network.loadingFailed 报告取消，迟到响应未送到新 peer。没有访问公网图片、TLS 服务或真实供应商/模型/搜索 API。不得将合成响应当作公网传输、OCR、应用 UI 自动重连、无 documentId Firefox 或 GPU 验收。

初轮独立 D-Bus 会话中观察到密钥环提示进程，同时页面导航阻塞；两者目前仅有时序相关证据，未单独验证因果，阻塞原因仍未完全判定。本次测试 bus 在拥有的临时目录采用不加载系统服务自动启动目录的配置后，导航及首组测试完成；未修改系统或日常会话服务、密钥环、凭据或密码存储方式。六轮诊断分别保留：创建窗口参数约束、上下文/导航超时、来源协议拒绝；最终第七轮记录与诊断分开。早期驱动曾以环境匹配发现辅助进程，最终已去除；额外的全用户 `/proc/*/environ` 扫描被自动批准审查拒绝且未执行，最终驱动枚举 `/proc/*/stat`，按 UID、已知 PID/startTicks、进程组与祖先关系筛选归属，只对已归属进程读取 cmdline/status/exe/fd 等详细信息，并核验该浏览器引用的 Crashpad PID。没有输出环境或认证文件正文，公开 telemetry query key 已脱敏。

[最终报告](./records/final/browser-report.json)、[原生内容上下文](./records/final/native-content-context.json)、[窗口与控制前归属](./records/final/ownership-before-control.json)、[控制后归属](./records/final/ownership-after-cases.json)、[实际截图](./records/final/production-area-capture.png)、[清理](./records/final/cleanup.json) 均保留。测试后剩余拥有 PID、TCP listener、X socket 为 0，HTTP fixture 已关闭；临时 profile 留在受控目录供复核，未发布 profile、认证或 cookies。前三輪记录/引用 PID 的额外复核均无残留。

驱动为 [会话 helper](./driver/neo-owned-session.mjs) 与 [合成测试驱动](./driver/run-neo-port-fixture.mjs)；执行时要求上述固定 clean 应用工作树与精确 manifest/background SHA，先验证实际 PID/display/bus/profile/listener 归属，再控制本地夹具。最终驱动文件 SHA 与运行时快照逐项相符。运行只创建隔离 profile，不连接日常浏览器，正常结束或错误均按归属清理。

首组验收当时，取消工作已另存 clean 检查点 `9da3fd9f01f912268cc7c919db4a804c250f62ca`：232/232 针对性测试、注册表/传输/输入 handler 四项 100% 覆盖与类型检查通过；当时全量冻结回归和三目标构建尚未运行，不能据此宣称取消批次完成。本 Neo 记录不混用该应用版本。

初始发布检查核验 90 个运行记录／payload 的哈希和其中 68 个 JSON；随后加入的 5 个发布检查记录使 manifest 为 95 项。导航诊断说明另加 3 个发布记录后为 98 项；本次计数范围说明另加 3 个文档检查记录后为 101 项，并对全部 101 项重新核验公开哈希。旧 90／68 计数只表示当时的检查范围，不包含这些后来添加的发布记录。manifest 不计自身及 README/BINDING/DOCS-VALIDATION 等元数据，这些由本证据提交的 Git tree 绑定。
