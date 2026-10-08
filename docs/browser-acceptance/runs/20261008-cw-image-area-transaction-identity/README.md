# CW image/area transaction identity evidence

Baseline: `e12faf5e0875297ae970a0de947c9763b5ac21e8`.
Validated source commit: `2bc49b8377ed537d1a57ab8535df4c3cc17a09cf`; source tree: `518cdd7d29d8deece40f0e443cb86aa3b285ed25`.
Execution: CW only, with existing pure checkout/dependencies and the subsequently authorized separate combination worktree; UTC 2026-10-08. No extra agent/task, search/model API, browser profile, credential or Pi/Cua/Neo changes.

Public `callerRequestId` is indexed within the browser sender's extension/tab/frame/document `ownerKey`. Each admitted operation receives a new backend `transactionId`. Image and area share the same registry, original sender/config/glossary snapshot, controller and absolute deadline. Verified offscreen messages use internal IDs; page source verification and progress use the original public ID. Termination revokes lookup authority before settlement. Tab removal releases both operation types. Pre-cancel markers use a bounded owner-keyed Map and are deleted on consumption.

The canonical provider snapshot freezes provider/glossary fields; model vision overrides are frozen with it. All area preparation stages receive the same effective source. OCR-to-text carries the parent's deadline and signal. No new model/incognito settings or UI behavior were added. The original translation sender-key algorithm was extracted and reused.

## Recorded checks

| Check | Result |
| --- | --- |
| Initial owner/pre-cancel red repro | 3 failed, 1 negative control passed; exit 1 |
| Real handler-chain red repro, both ordinary/private fixture orders | 5 failed, 1 negative control passed; exit 1 |
| Final actual assembly/transaction regressions | 20/20 passed; exit 0 |
| Complete expanded strict suite | 9555/9555, 394 files; exit 0 |
| Statements / lines | 65127/65127, 100% |
| Functions | 4493/4493, 100% |
| Branches | 32859/32859, 100% |
| Complete architecture matrix | 1359/1359, all 32 files; exit 0 |
| TypeScript/Vue; test audit; diff check | Passed; audit 484 files, 6576 static cases |
| Userscript build and artifact verifier | Passed; 1,953,777 bytes |
| Pure transaction Chrome / Firefox builds | Exit 1; missing independent approved WXT metadata fix |
| Transaction + approved WXT fix Chrome / Firefox builds | Both exit 0; manifests and metadata contract checks also exit 0 |
| Documentation build | Passed; exit 0 |
| Additional vertical-slice file | 4/5; one existing OCR UI assertion remains, exit 1 |

`publish-inputs.json` records 1495 SHA256 input hashes; each was verified against the committed source with zero mismatches. The full strict thresholds remain 100% in all four dimensions. Existing mandatory suites were not narrowed; no ignore, only or skip was introduced. Architecture uses every file listed in the matrix, expanded directly through installed Vitest because `pnpm` is absent from PATH. `messageRuntime` remains below its unchanged 173-line debt ceiling by moving image/area assembly into existing `areaRuntime`.

The red results are deterministic local mocked-port reproductions, not evidence of an exploited browser. Tests cover owner isolation across tabs/documents; timeout and public-ID reuse in both ordinary/private fixture orders; stale text/progress/cancel and finalizers; pre-cancel consume/re-add/eviction; frozen config during OCR; expired and remaining budgets; tab removal; public source authorization; normal image/area/vision and cancellation paths. The baseline negative control proves successful original-owner cancellation and same-owner duplicate rejection; final isolation regressions separately reject foreign owners.

## Remaining boundaries

The pure transaction source does not include approved independent WXT fix `dccb0bd1c749c7030df590c2512e2b55fb0a5b74`. Its Chrome/Firefox builds fail during WXT 0.20.18 local TTS worker metadata import: Node ONNX 1.24.3 requires `VERS_1.24.3` while 1.21.0's library is selected. This matches the known worker metadata problem; installed dependencies were not reinstalled or changed.

At the user's subsequent instruction, a separate CW combination worktree stacked exactly that approved patch onto `2bc49b8377ed537d1a57ab8535df4c3cc17a09cf`. Local combination commit: `b25e372731a6feb2aa1bf4bbd7992b37a0e19cb8`; tree: `89b6279f3aae30dac7b112b371dab35319f5373f`. Only `entrypoints/localTtsWorker.ts` and `tests/extensionManifestContract.test.ts` differ from the pure source. Chrome (19.640 seconds), Firefox (18.827 seconds), generated manifest verification and the WXT metadata contract all pass. Artifact hashes are in `combination-artifacts.json`. This local combination commit was used for acceptance, not added to or published as the pure transaction branch. Combination success is **not** standalone pure-branch build success. No unknown remaining native conflict was observed in these combination builds. A complete build at baseline e12 alone was not rerun.

The extra vertical-slice file expects a literal OCR UI message absent from unchanged `ImageOcrSettings.vue`. A read of that same file at e12 confirms the literal is also absent there (`existing-ocr-ui-assertion.json`); this is static baseline evidence, not a rerun of its full baseline group. The required strict/architecture suites are green. The unrelated UI assertion was retained and reported, not skipped or repaired in this transaction task.

Real browser documentId delivery, navigation/port teardown, ordinary/private browsing behavior, provider calls and RTX5090 WebGPU have not been accepted here. Platforms without browser-provided documentId retain the prior sender-key fallback; no document identity is trusted from request payloads. Incognito model routing remains subsequent work.

## Evidence files

Each named check has its actual command JSON, stdout/stderr and test JSON where applicable. `coverage-summary.json` and `coverage-final.json` contain full final coverage counters. Local filesystem paths are replaced with workspace, dependency, task and user aliases; source hashes and numeric outcomes are preserved. `binding.json` binds the tests to the code commit. No credentials or authentication files were read or included.
