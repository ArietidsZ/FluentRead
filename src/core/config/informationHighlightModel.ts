/**
 * @file src/core/config/informationHighlightModel.ts
 * 文件职责：固定唯一信息高亮模型的来源、版本、字节数和内容校验值。
 * 主要内容：Qwen2.5-0.5B Base 的 Apache-2.0 ONNX q4f16 清单；模型正文与 tokenizer 均固定同一 revision。
 * 模块边界：纯元数据，不初始化推理、不下载权重；SHA-256 来自官方 LFS 元数据及该固定版本实际小文件。
 */
export const INFORMATION_HIGHLIGHT_MODEL = 'onnx-community/Qwen2.5-0.5B';
export const INFORMATION_HIGHLIGHT_MODEL_NAME = 'Qwen2.5 0.5B';
export const INFORMATION_HIGHLIGHT_MODEL_REVISION = 'bae5ceaee026f0d0592858b2bd27645a06f19c42';
export const INFORMATION_HIGHLIGHT_MODEL_FILES = [
    {path: 'config.json', size: 691, sha256: '90ad34e62bb47572a06e0235696076976d59e9fcf5ab173d9a44689ba01b7d52'},
    {path: 'generation_config.json', size: 117, sha256: '113ab032dbddc84029290361700100d7f448db7b21c20c6c81b798bb09062fc1'},
    {path: 'special_tokens_map.json', size: 616, sha256: '6676f091c8bc4d1b50146427cfde92073402866b87b6e39223227931b70083e9'},
    {path: 'tokenizer.json', size: 7031673, sha256: 'a8506e7111b80c6d8635951a02eab0f4e1a8e4e5772da83846579e97b16f61bf'},
    {path: 'tokenizer_config.json', size: 7229, sha256: 'cefaa66de8fae4a09ca18a9c3a7fd8b61311ed568e5f4e634f6a3d95a2a9e889'},
    {path: 'onnx/model_q4f16.onnx', size: 483003582, sha256: '30a39f89fab8f30d0f99aa1e28d3e3be6fca66a3fab915f77584ac52a8361d25'},
] as const;
export const INFORMATION_HIGHLIGHT_MODEL_BYTES = INFORMATION_HIGHLIGHT_MODEL_FILES.reduce((sum, file) => sum + file.size, 0);
