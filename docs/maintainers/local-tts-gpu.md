# Local speech GPU execution

## Execution policy and migration

`selectionTtsExecution` is `gpu` by default. Missing or invalid values normalize
to `gpu`, including older imported configurations. The existing online-first,
local-first, online-only and local-only source policies remain separate.

GPU execution requires a usable hardware WebGPU adapter. Neither the worker nor
its owner retries on CPU. A failed or timed-out GPU session is terminated; the
next request can create a fresh GPU worker. A result labeled WASM is rejected.

The explicitly selected `compatible` option retains the previous GPU-first,
fresh-worker CPU retry. Switching execution policy replaces the worker, so a
previous CPU session cannot satisfy a later GPU request. Settings and new errors
are localized in all seven interface languages.

The source model, precision, revision, voices and model-cache keys are unchanged:
Kokoro v1.1-zh FP32 at `6cc0f0d2ebe369a68b0df87c2b65c1af8c0ac3e3`.
The cache stores model artifacts, not synthesized audio. Execution policy does
not create an alternate alias for unverified weights.

## Resource and lifecycle changes

The owner counts admitted synthesis from before asynchronous cache inspection
through queued inference. Model deletion refuses while any admitted work
exists, and new synthesis is refused during deletion. Explicit disposal rejects
active work as cancellation and invalidates queued/preflight work. It cannot
resurrect a CPU worker through the lifecycle retry path. Cache download/removal
serialization is a separate protection and remains necessary.

WAV encoding writes chunk snapshots into the final PCM16 buffer without first
allocating a merged float buffer. Seeded 240,000-sample, subarray and empty-chunk
fixtures produce byte-identical output; the removed float allocation is 960,000
bytes. Snapshots remain necessary because a generator can reuse its audio
buffer. No first-chunk playback claim is made: the public message still returns
a complete WAV.

The original-owner ablation fails the new cache-preflight/removal test. The new
owner passes pending, queued, preflight, failed-removal and cancellation cases.
For WAV assembly, inline nested conversion was slower in the Node microcheck;
a small per-chunk conversion function removed that measured slowdown. Remaining
timing variation does not establish an end-to-end speed improvement. The
verified benefit is reduced temporary float allocation with unchanged PCM.

## Model selection and open quality gates

Current Chinese/English and mixed reading are retained. FP16 variants are not
promoted on file size alone: earlier failures included nonfinite samples.

The [Kokoro wrapper](https://github.com/uzen-zone/kokoro-js) only forwards its
listed loading options. It does not forward arbitrary ONNX session options.
Actual pinned FP32 partitioning on Lavapipe assigned 1,859 nodes to WebGPU and
426 to CPU, including six neural LSTMs. All four shipped voices and five extended text fixtures produced finite,
unclipped audio. The first voice used 3,494 native GPU dispatches. This is hybrid GPU acceleration. The
execution policy prohibits a whole-model CPU retry; it does not assert every
neural operator runs on GPU. Pronunciation and prosody listening acceptance
remain open.

Candidate review as of 2026-10-04:

- [Pocket's English ONNX export](https://huggingface.co/IgnitiveLabs/PocketTTS-ONNX)
  has an approximately 125 MB int8 synthesis graph set, or 400 MB float set, before
  conditioning assets. The English export is distinct from the latest native
  multilingual model. Its GPU operator, preset voice and quality contracts have
  not passed this project's gates.
- [Sopro v2 Turbo](https://huggingface.co/samuel-vitorino/sopro-v2-turbo) documents
  a browser runtime and four languages, excluding Chinese. Its card warns of
  limited normalization and mixed-language behavior. Its official 0.3.0 offline WebGPU pack totals 361,327,755 bytes;
  the current Kokoro model/config/voice files total 341,463,503 bytes. The semantic/reference stages use WASM, while acoustic and
  vocoder stages use GPU. This explicit hybrid remains a possible challenger;
  matched end-to-end quality and timing have not justified promotion. The
  official package ships no preset voices and requires reference audio or a
  compatible conditioning pack; existing Kokoro style files are not compatible.
- [Supertonic3](https://github.com/supertone-oss-archive/supertonic) has browser
  examples and 31 languages excluding Chinese. The repository is archived. It
  cannot replace the current Chinese lane.
- Qwen3-TTS 0.6B is a larger multilingual candidate; export existence alone has
  not established a complete, bounded browser implementation here.

None of these observations proves Kokoro is globally optimal or dominates all
older choices. Promotion requires matched voices/texts and quality checks for
Chinese, English, mixed names, numerals, dates, abbreviations, punctuation and
long passages. Finite audio and ASR round trips are useful checks but do not
establish pronunciation or prosody quality. Listening and physical GPU latency,
RTF and memory measurements remain outstanding. Software WebGPU measurements
must be labeled as such, and temporary-profile browser acceptance is separate.


## Complete long Chinese text

The previous 180-character stream limit was not a token limit. A 175-character
Chinese fixture produced 602 phoneme tokens including BOS/EOS, while the native
Kokoro stream requested tokenizer truncation at 512. Its ending could be lost.

The official loader still establishes the pinned voice path. A public
`KokoroTTS` constructor reuses that loaded model and accepts a guarded native
tokenizer. The guard disables truncation, counts the actual native tensor and
rejects overflow before neural inference. No phonemizer implementation is copied.
Native `TextSplitterStream` retains sentence boundaries; bounded parts use public
`generate` directly, avoiding duplicate sentence splitting inside `stream`.

Unspaced Chinese uses native word/grapheme-safe boundaries. Numeric compounds
such as dates, times, signed decimals and Chinese year/month/day forms stay
whole. Overflow causes smaller word-boundary parts; an indivisible oversized
number or word fails explicitly. The newly written 175-character fixture was
reconstructed exactly as 505- and 98-token parts in a frontend-only check.
That check stubbed audio generation and is not an inference result.

The subsequent real before/after GPU check used the unchanged full input.
Original audio lasted 26.2 seconds and its tail omitted the ending; fixed audio
lasted 33.4 seconds and tail ASR retained “朗读结束，请记住。” after punctuation
normalization. Both model calls were finite and unclipped, with all tracked GPU
buffers released. The fixed direct-worker fixture took 246.7 seconds including
cold loading on software Lavapipe, with peak RSS 2,995,612 KiB. This exceeded the
unchanged 120-second production owner budget; it proves complete core synthesis,
not a long-text production deadline or physical GPU performance claim.

Removing the tokenizer guard reproduces the lost-ending regression test.
Normal short inputs retain the same native phonemizer, tokenizer, voice and
neural model. New error text covers all seven UI languages.


## Rejected precision and remaining quality limits

The exact pinned int8 contrast was 127,356,504 bytes versus 339,369,442 bytes for
the FP32 graph. It failed the first English fixture: the second chunk contained
51,000 nonfinite samples out of 51,000. The production guard rejected the full
result and emitted no partial WAV. Int8 also moved 90 ConvInteger, 83 MatMulInteger
and six DynamicQuantizeLSTM nodes to CPU; its lower GPU allocation was not a
like-for-like neural-offload improvement. It is not offered as a product mode.

All four FP32 CPU-reference voices had the same sample counts as the GPU runs.
On this software renderer, whole-fixture CPU times were 6.02–11.35 seconds and
GPU times 20.45–46.45 seconds, with the first run including cold loading. GPU
smoke-test buffer peak was 503,763,312 bytes and final tracked allocation was
zero. These software results do not establish hardware speed dominance.

The graph contains unseeded RandomUniformLike and RandomNormalLike operators.
GPU/CPU waveforms were not byte-identical; this cannot be attributed solely to
backend error without controlling stochastic variation. A long-paragraph ASR
check produced “long” for source “longer” on both CPU and GPU. ASR parity is
useful but does not establish perfect spoken content or replace listening.
