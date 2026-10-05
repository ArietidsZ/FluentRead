# 固定英日 tokenizer 的未知词 ID 修正

这是独立于 GPU 配置的窄修复，不等于英→日翻译质量修复。

## 可复现问题

`Xenova/opus-mt-en-jap` 的 revision `9d418190be3aa945eae5bab1bd96bc5e349ad784` 中，`tokenizer.json`（SHA256 `240dd3befcfb8727158fb23fbc8a94a41e5b827ad486601ea0805c17fb9f6fd9`）声明 `model.unk_id=2`，但完整词表的 ID2 为逗号，`<unk>` 为 ID1。官方 Marian source.spm 到 vocab.json 的映射使用 ID1。

修正仅匹配上述仓库、版本、路径、原始SHA；固定JSON结构不符则失败。下载与校验后的原始缓存不动，Transformers读取的是将 unk_id 改为1的运行时JSON副本。其他文件、模型、版本和词表不改动。

最小 Unigram 实际编码测试证明：缺失的 `0`、`2030` 和 emoji 原来被映射为2，修正后为1；真实逗号仍为2，已知字符不变。缓存测试确认先校验再提供副本，不写回原始Blob。

## 质量结论仍然有限

官方原始模型 `Helsinki-NLP/opus-mt-en-jap` revision `a863894cdd2b80f3bc1c5966734aee9ffec207d1` 的配置没有语言前缀要求，decoder配置与导出一致。原始 SentencePiece+vocab 与 Transformers 对 “Save changes” 和完整打印机否定句的输入ID完全一致，但两句原本仍输出不相关文本。因此未知词错误不能解释全部质量问题。

日期句另有 SentencePiece 和导出 Unigram 的切分差异。只修正 unk_id 后，真实 Q8 推理输出发生变化，但仍无关且丢失数字。按官方4 beams并去掉额外重复惩罚的对照也没有修复三条样例。没有把这项修正包装成“英→日现在可用”，也没有将该方向加入新 GPU 配置。

- 原始ID与文件证据：`tests/fixtures/local-translation/opus-en-jap-tokenization-diagnosis.json`
- 实际输出对照：`opus-qualification-results.json` 中 `en-ja-q8-baseline`、`en-ja-reference-beams`、`en-ja-unk-correction`
- 官方依据：[模型卡](https://huggingface.co/Helsinki-NLP/opus-mt-en-jap)、[固定原始版本](https://huggingface.co/Helsinki-NLP/opus-mt-en-jap/tree/a863894cdd2b80f3bc1c5966734aee9ffec207d1)
