# CW image/area parent termination evidence

Baseline: `9e3fc3eefd9c2499afc9458c3720e94d58a2b14d`. Validated source commit: `ed52037478b4040f236fb4cc210266d34c0730cb`; tree: `8a56bec1fc6460d76bf36324d1e2503e4f17d617`. Branch: `fix/image-area-parent-termination-20261008`. Execution: CW only, UTC 2026-10-08, existing installed dependencies. This is a localized registry fix and offline validation, not a browser deployment or provider/GPU acceptance.

## Parent lifecycle change

Previously a parent operation failure such as an offscreen port-closed error revoked the transaction and cleared its timer but left already borrowed text/provider work waiting on a live shared signal. When three non-batch provider calls were released after that failure, the fourth could still start.

The registry now counts unsettled executions by transaction record identity in a private WeakMap. Parent termination first marks terminal and revokes active/owner lookup authority, then aborts the shared controller on failure or if children remain. Parent settlement was selected before abort dispatch, so its original error/result is preserved. Borrowed calls reject immediately and ignore late provider results. A normal successful parent with all children already settled keeps its completed-result behavior and un-aborted signal. Abort/cancel/timeout finalizers remain idempotent and identity-checked.

Only `src/features/image-translation/background/operationRegistry.ts` and existing `tests/imageTransactionIdentity.test.ts` changed in the source commit. There are no client, sender-trust, manifest, permission, browser minimum, model/UI, provider, dependency or credential changes.

## Recorded checks

| Check | Actual result |
| --- | --- |
| Parent failure, success with pending child, real non-batch handler-chain red cases | 3 failed on unchanged production registry, exit 1 |
| Same cases plus all existing transaction/glossary tests | 37/37 across 2 files, exit 0 |
| First complete strict coverage run | 9557/9558; one unchanged 1ms client clock assertion failed, exit 1 |
| Unchanged client test file in isolation | 36/36, exit 0 |
| Full unchanged strict confirmation | 9558/9558, 394 files, zero skipped, exit 0 |
| Statements / lines | 65135/65135, 100% |
| Functions | 4493/4493, 100% |
| Branches | 32863/32863, 100% |
| Registry itself | 127 statements/lines, 19 functions, 96 branches: all 100% |
| Complete architecture matrix | 1359/1359, all 32 matrix files, exit 0 |
| TypeScript/Vue; test audit; diff check | Passed; audit 484 files and 6578 static cases |
| Missing-documentId fallback red boundary | 4 failed plus 1 modern-documentId negative control passed, exit 1; remains unresolved |

No coverage threshold, test assertion, suite inclusion or skip/ignore was changed. The 20 pending results in the initial parent red output are existing cases not selected by its explicit name filter; the final strict run executes all 9558 cases with zero skipped. `parent-source-inputs.json` contains 2244 tested input SHA256 hashes, all matched against the committed source. `parent-binding.json`, `validation-summary.json`, full result JSON and both coverage JSON files support these counts.

The first strict failure expected a second cancellation send but observed zero sends in the unchanged client test that requests a 1ms real-clock timeout. The unchanged source can expire its absolute deadline before its first send; that is a timing inference, not an instrumented clock measurement. Baseline/current hashes are recorded in `client-clock-boundary.json`. The failure, isolated pass and subsequent complete pass are all retained. No timing constant or assertion was relaxed.

The architecture command accidentally supplied its intended JSON output filename as an extra positional filter; all 32 explicit matrix files nevertheless ran and passed. The raw stdout JSON is preserved and extracted as `architecture-parent.results.json`; extraction details and exact expected/actual matrix names are recorded. No reduced subset is reported as the full matrix.

## Firefox compatibility boundary and next scope

[PORT-COMPATIBILITY-PLAN.md](./PORT-COMPATIBILITY-PLAN.md) gives the reviewed source/API findings and exact separate client/session/registry/source-validation/capture changes needed to preserve Firefox 140 with existing permissions. No Port protocol is implemented in this source commit. The global weak sender key is unchanged.

The missing-documentId red fixture uses actual production registry/progress/source adapters with offline old/replacement document contexts and frame-slot routing. Four cases fail: foreign-document cancellation, same-public-ID concurrency, old progress and old source validation. The negative control with browser document IDs preserves precise document targeting and original image-source caller ID. These are offline fixtures, not native Firefox 140 navigation, distinct real runtime.Port instances, Chrome/BFCache tests or an observed exploit. Missing-documentId isolation remains open.

The minimum follow-up binds every start/cancel/progress/result/source challenge to a content-origin browser-owned Port session, keeps one shared Port per content context, retains source authorization IDs and selected-image checks, revokes before abort on disconnect, checks liveness after config and capture waits, preserves original retry deadlines and background-owned language downloads, and never falls back to the latest frame slot. Delayed disconnect cannot support a claim of zero instructions after navigation.

## Not run or changed

No live browser profile, browser process, remote control port, API/model call, RTX5090 WebGPU test, Pi/Cua/Neo/MII action, security permission, privacy setting or persistent MCP access change was made. No extra Codex/Work task or subagent was started. No PR was opened. Real Firefox/Chrome/BFCache acceptance remains pending for the separate connection migration.

Previously accepted independent WXT combination builds were not rerun and are not claimed as builds of this new source commit. This change affects registry lifecycle logic, with no entrypoint/build/platform change. Documentation build evidence is added separately after the evidence bundle is assembled.

Local filesystem paths in public records use CW_WORKTREE/CW_DEPENDENCY_TREE/CW_TASK_ROOT/CW_LOCAL_USER aliases. This sanitization retains hashes, counts, actual commands and outcome content. The scripts/config snapshots need those aliases restored to rerun. `evidence-sha256.json` binds the published evidence files; original unsanitized logs remain on CW outside the repository.
