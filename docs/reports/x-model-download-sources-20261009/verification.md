# X 本地 AI 模型下载来源与默认模型验证

## 行为

Small · 高质量成为新配置、缺少选择的旧配置及非法模型值的统一默认；明确保存的 Tiny/Base/Small 均保留。

设置页提供自动选择、国内优先、官方优先以及三个模型页面入口，来源偏好只影响后续请求。国内优先使用魔搭、HF Mirror、Hugging Face；官方优先依次使用 Hugging Face、HF Mirror、魔搭。自动选择仅以浏览器语言排列初始来源，不判定用户实际地区。

下载流保持原有模型精度与 canonical Cache Storage 键，完整文件复用。连接头等待最多 10 秒，连续无数据最多 20 秒，Tiny/Base 单文件每源最多 120 秒、Small 最多 300 秒。所有来源与文件共用 600 秒总下载预算，后台缓存准备消息留出 30 秒清理与回包余量；已缓存模型的推理预热预算不变。取消和存储空间不足立即终止。底层 fetch、read 或消费端未及时响应取消时，墙钟边界仍允许切换来源；迟到响应清理不会阻塞下一请求。

真实字节与来源枚举通过既有 offscreen → background → settings 通道传送，来源切换不受字节限频压制。界面区分连接、换源、接收，失败提供重试入口。内容脚本仍无权直接读取受信配置存储；查询仅返回归一化的单项下载进度。

## 公网来源核验

[来源核验 JSON](./source-probe-summary.json)记录本机网络的实际 HTTP 响应。Hugging Face 官方仓库当前 Small revision 为 `36050c46d777d46dc4b5f43f6d90574fc38f8732`。三入口的五个完整 JSON 文件 SHA256 与本机已校验缓存一致；两个权重的 1024 字节 Range 响应、总大小和服务端 linked SHA256 与本机重新校验的完整权重相符。既有 Small 七文件共 588,744,805 字节，编码器 FP32、解码器 q4。

- [Hugging Face 官方模型文件](https://huggingface.co/onnx-community/whisper-small/tree/main)提供当前提交与文件清单。
- [魔搭模型页面](https://modelscope.cn/models/onnx-community/whisper-small)对应实际配置和独立魔搭 CDN 权重响应。
- [HF Mirror 自身说明](https://hf-mirror.com/)公布 `.com` 镜像入口。本机测试的七文件均重定向到 Hugging Face，不能称为此网络中的独立备用传输通道。

移除未核实为同运营方的 `hf-mirror.net` 新网络下载入口；历史已缓存模型仍按精确仓库、revision、路径和查询串校验其 provenance，不重新请求该域名。

HTTP 测试只证明此时此网络的小文件和权重元数据/片段可读取，没有重新完整下载远端 590 MB 权重，没有证明各国网络可达性、实际识别质量或所有浏览器运行时。

## 验证记录

最终测试、构建和浏览器记录随交付补齐。
