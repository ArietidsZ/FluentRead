# CW image/area document Port acceptance

The final Port follow-up passes deterministic offline acceptance and SHA-bound build validation. Real-browser navigation, iframe replacement, BFCache, GPU and provider acceptance remain open. All work used the selected CW environment and existing dependencies; no additional Codex/Work task, subagent or model/search/provider call was started.

## Exact source and build inputs

| Role | Commit / tree |
| --- | --- |
| Reviewed parent-termination baseline | `3e7c5e45d3bcb029ad0aa1a6f65e390f8f079568` |
| Initial Port implementation, historical | `ae168d323bc555d545c6f89c3cd691ca24450558` |
| Final source including review corrections and capability boundary | `27a1f191680c421451fb762a833a95c3d47a0188` / `fb7fad93f0814912ca63e33e27a143a74269cecf` |
| Approved WXT patch, unchanged | `dccb0bd1c749c7030df590c2512e2b55fb0a5b74` |
| Actual build combination: final source plus only that patch | `89fd05806c4c41778e8a47817988130ef09ca583` / `8b7ee997b8a30f90640d888a85703fbc416fe409` |

The source branch is `fix/image-area-document-channel-20261008`. The build combination differs from final source only in `entrypoints/localTtsWorker.ts` and `tests/extensionManifestContract.test.ts`. Build success applies to that explicit combination. The source branch alone does not contain the WXT patch. No package, lockfile, WXT configuration, userscript Vite configuration or global request-owner policy changed.

[VALIDATION.json](./VALIDATION.json) binds the final results to the source and combination commits. [Source input hashes](./records/capability-proof-inputs.json) cover 2,249 source/build/test inputs; [artifact hashes](./records/combination-capability-artifacts.json) cover 797 actual Chrome, Firefox and userscript output files. [RECORDS-SHA256.json](./RECORDS-SHA256.json) indexes the published evidence.

## Result and review corrections

Image/area start, cancel, progress, result and source challenge/reply share the original browser-owned Port. A private, non-deserializable capability identifies each accepted actual Port, including senders without documentId. New Port means new owner. Same tab/frame/URL, public request IDs, delayed disconnects or copied payload fields cannot substitute for that ownership. Handshake confirms protocol only; there is no frame-only fallback.

The independent client review found that resetting the current shared Port on any disconnected-error text could close a newer retry peer or unrelated work after an Offscreen response error. Three red tests reproduced both failures and the missing capture-helper cancellation. Retry now leaves connection cleanup to the actual Port's identity-bound disconnect/post-failure handling. Concurrent retries reuse the new live peer; an Offscreen response error can retry its operation without closing the shared background connection. Retry still uses a fresh public request ID, one retry and the original absolute deadline.

The capture helper accepts operation options and the UI passes its existing controller.signal. A real helper-to-Port-to-background cancellation regression verifies that a queued capture is cancelled and never performs its second screenshot. The existing active tab/window checks remain. UI regressions verify ESC and unmount abort that same signal and suppress later translation.

A lifecycle red test also reproduced the shared Port remaining live after pagehide. The existing content root now aborts/unmounts UI work before suspending or disposing that Port. Suspended/disposed requests reject AbortError without reconnection; restore permits a fresh peer. The lifecycle fixture exercises the actual root and helper, but its trusted page transition is simulated and does not constitute browser BFCache validation. Background-owned language downloads retain their existing one-shot path.

Source authorization retains the original image-source-* ID and selected image/document/src/srcset/sizes/currentSrc checks. Fetch has no automatic retry and authorization is not migrated to another Port. A fresh manual UI attempt remints authorization and rechecks the selected image. Data URL translation retry uses an independent translation ID and does not request source authorization again. The end-to-end offline proof uses the actual client, Port handler, source verifier and DOM checks, with bytes/OCR mocked and no frame fallback.

The first lifecycle integration bypassed the existing userscript public/empty-adapter boundary and produced a 1,958,159-byte artifact, failing the unchanged 1,955,000-byte verifier budget. The final integration follows that existing boundary; the extension Port implementation is excluded from userscript and its verifier passes at 1,954,921 bytes. The failed record is retained. No budget or dependency change was made.

## Final offline evidence

| Check | Final result |
| --- | --- |
| Strict full suite | 9,603/9,603, 395 files, zero failed/skipped, exit 0 |
| Statements / lines | 65,380/65,380, 100% |
| Functions | 4,530/4,530, 100% |
| Branches | 33,063/33,063, 100% |
| Architecture | 1,362/1,362, 32 files |
| Type check / audit | Passed; 485 files, 6,613 static cases |
| Focused client, capture and lifecycle boundaries | 103/103; capability/fixture regression 50/50 |
| Chrome / Firefox / userscript builds | Passed at the exact combination above |
| Generated manifest / userscript verifier / WXT contract | Passed; Firefox minimum 140.0 retained; WXT contract 20/20 |

All coverage thresholds remain four-dimensional 100%, without ignores or exclusions added for these fixes. Historical successful suites (9,596 and 9,597 tests), the initial four-failure document fallback fixture, the three client red cases, the lifecycle red case, intermediate coverage failures and verifier failure are retained under distinct names. Earlier stage status snapshots and their Git history are preserved. Final records are `strict-capability-final.*`, `architecture-capability-final.*`, `type-capability-final.*`, `audit-capability-final.*` and `combo-capability-*`.

Published records replace local paths with `CW_WORKTREE`, `CW_COMBINATION_WORKTREE`, `CW_DEPENDENCY_TREE`, `CW_TASK_ROOT` and `CW_LOCAL_USER`. Text logs have trailing whitespace removed; original logs remain on CW. No credential or authentication-file content is included. Commands, timestamps, durations and exit codes are retained. The intermediate architecture review JSON was extracted from its raw JSON stdout; the final architecture run has its direct output-file report.

## Remaining acceptance boundary

No extension was installed or loaded, daily browser profile touched, browser closed, remote control port opened, default browser changed, new permission/MCP access added or credential changed. Pi, Cua Driver, BrowserOS Neo and MII were not modified by this follow-up. No PR was created or merged; existing branches and data remain available for rollback.

Old pre-update content scripts can require a page refresh to establish this Port protocol; an unbound image/area transaction is rejected with retry/refresh guidance. Firefox minimum and existing permissions are unchanged. Real Firefox/Chrome navigation, iframe teardown, BFCache and connection teardown must still be validated using an explicitly authorized temporary-profile extension load under the established focus-safe policy. Offline mocks cannot close that browser acceptance. Real RTX5090 WebGPU and provider acceptance have not been run.
