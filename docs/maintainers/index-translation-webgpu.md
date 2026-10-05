# Index translation WebGPU candidate

## Scope

Index Translate 2B Q6 is an optional local model. Existing OPUS, Hy-MT2,
M2M100 and NLLB selections and defaults remain available. This change does not
establish that Index dominates them on quality, latency, memory or download size.

The pinned GGUF is `IndexTeam/Index-Translate-2B-GGUF` at
`449c9e6457b3632d328c6cbb78ae8e8e0c8059a5`. Its 1,606,323,712-byte Q6 file
has SHA-256 `3ec6fa4e5a5efa25620f17ecfce8daec1ec8fb35a53c82b419a6707581a505b9`.
Tokenizer files are separately pinned in the existing artifact manifest. They
are read offline through the same verified chunk cache as the GGUF.

## Native runtime contract

The existing wllama 3.6.1 and static extension worker are reused. The pinned
[llama.cpp WebGPU backend](https://github.com/ggml-org/llama.cpp/blob/83d855c5a6d70487121edbf4020b25c96b7a04e7/ggml/src/ggml-webgpu/ggml-webgpu.cpp)
requires shader-f16 and requests adapter limits as device required limits.
Admission rejects software adapters and missing JSPI/memory64/f16. The native
loader decides tensor placement. A successful load, full requested-layer record
and a positive actual WebGPU model-buffer allocation are required. There is
no Index CPU retry. Device-loss records invalidate the session.

The offload counter alone only reflects requested layer placement and can
appear even when no GPU tensors were placed. The pinned loader separately logs
actual allocated model buffers; CPU-only or compute-buffer-only evidence is
rejected. Neither signal claims that every graph operation runs on GPU. Actual adapter/runtime inference
validation remains necessary. No generated-runtime instrumentation is added.

The [wllama 3.6.1 public API](https://github.com/ngxson/wllama/blob/3.6.1/src/wllama.ts)
has no public tokenization or chat-template application method. The existing
Hugging Face tokenizer library supplies input-budget estimates; wllama applies
the GGUF chat template itself. All 248,066 defined HF vocabulary entries and
merges match the GGUF metadata; its remaining entries are padding. The chat
template also matches. Fourteen text/chat cases match the independent Rust
tokenizer on Chinese, Japanese, mixed names/numbers, emoji, HTML and placeholders.
This is artifact/tokenizer parity; native runtime tokenization is still pending.

## Generation and structure

Use the [official prompt and non-thinking greedy policy](https://github.com/bilibili/Index-Translate/blob/main/docs/prompts.md).
One native sequence uses a 2,048-token context and at most 768 output tokens.
Input packing is limited to 1,024 tokenizer tokens including instructions and
optional hints. The remaining budget covers the native template; tested simple
chat cases add 16 tokens. Native reported prompt use above 1,280 is rejected.
Context shifting is disabled. The loader does not keep idle native slots.

Adjacent sentences are packed within a line. Newline delimiters remain separate
and are copied unchanged. Oversized individual sentences or terminology are
rejected rather than truncated. Optional reference context is limited to 320
Unicode code points and explicitly treated as untrusted material. Glossary
translations are never truncated. Protected-placeholder counts and spellings
must match before accepting output. Existing repetition and empty-output checks
remain active. Native prompt caching is enabled; a matched-quality performance
ablation is pending before making a speed claim.

## Validation status

Focused mocked-session tests cover capability rejection, full/partial offload,
device loss, cancellation, cleanup failures, generation limits, placeholder
corruption, line preservation, and unchanged legacy behavior. The new pure
prompt, capability, and session modules have four-dimensional 100% test coverage.
These tests do not prove real model quality or physical GPU performance.

The available SwiftShader adapter lacks shader-f16. A separate real Lavapipe
software adapter supports it. Native Index Q6 with `n_gpu_layers: 99` completed
English-to-Chinese translation with EOS and 8,983 real GPU dispatches. Native
logs reported 26/26 layers offloaded, 397.85 MiB CPU model buffers and 1,075.98 MiB
GPU model buffers. Native source and operator traces identify CPU embedding
lookup and vocabulary projection at this device limit; main transformer SSM and
attention operations execute on GPU. This is substantial hybrid acceleration. One run took 38.377 seconds, with peak process RSS
2,530,532 KiB; these are software measurements, not hardware performance.

The earlier 417,177,600-byte adapter binding gate was disproven: native loading
and inference succeeded with a 128 MiB binding limit, and every observed GPU
allocation was at most 132,668,544 bytes. The gate and unused limit telemetry
were removed. A custom 24-layer profile was also unnecessary: requesting all
layers worked and produced the same correct text. No runtime patch was needed.

The actual production wrapper then completed three cases with native stop and
40,572 GPU dispatches; peak tracked GPU buffers were 1,182,428,840 bytes and
process RSS 2,734,404 KiB. Japanese translation and Chinese-to-English date,
name, decimal and negation facts were preserved. A context/glossary case resolved
“plant” as a factory and used the requested carbon-fiber term, but “will not open”
became “will close/be closed”, a temporal nuance that fails strict equivalence.
Index has not earned default promotion or a universal quality advantage.

Native prompt-token counts were 39, 51 and 101; all three reported zero cached
prompt tokens. These are distinct prompts, not a cache-mode performance
ablation. Broader glossary/placeholder quality, sentence-packing and cache
comparisons remain open. Native-tokenizer compatibility beyond the measured
prompts is also not a global guarantee. Temporary-profile browser extension validation is also
blocked by the cloud Chromium socket restriction.

The existing OPUS directional packs have a smaller download. NLLB exposes
languages outside the current Index product-language subset. Neither baseline
is dominated merely by adding Index. A final comparison must retain those axes
and language eligibility instead of averaging away failures.


The allocation-proof regression is grounded in the pinned
[loader implementation](https://github.com/ggml-org/llama.cpp/blob/83d855c5a6d70487121edbf4020b25c96b7a04e7/src/llama-model.cpp#L1680-L1699):
requested-layer counts are distinct from the following allocated-buffer report.
A full requested count plus CPU-only buffers must fail. Positive WebGPU model
allocation plus full requested count passes; zero allocation, compute buffers
alone, later partial placement or device loss fail. The proof is fresh per
native model instance and retains only booleans, not user text or full logs.
