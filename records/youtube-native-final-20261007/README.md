# YouTube native cue data — final local acceptance

Code: [`66abb72b9e5830634616099172f0b3cc9970c369`](https://github.com/ArietidsZ/FluentRead/commit/66abb72b9e5830634616099172f0b3cc9970c369), parent `9dc1391e36ce488429167b5dfecbe02a9c1c57de`. Fresh comparison baseline: `83deca40091415666fc8fe5a45579b6b80487dcb`.

The new commit preserves `don / 't / do / that.` and punctuated contractions such as `we / 're, in / fact, ready / today.`. Three production regex lines changed; tests cover apostrophe, punctuation, whitespace and quoted-text boundaries. Exactly two code files changed (+85/-3). Conservative sentence boundaries and raw JSON3 segment joining remain intact.

| Check | Actual result |
| --- | --- |
| Target and related tests | **331 PASS**, 4 files; YouTube 294, X 9, logic 21, downloads 7 |
| YouTube module coverage | **100%** statements, branches, functions and lines |
| Existing Neo native-MCP pure-module smoke | **69 PASS**; no captured console warnings/errors or page errors |
| Typecheck / test inventory audit / diff check | **PASS**, each exit 0 |
| Full strict, revision | **FAIL**, 9648/9665 tests pass; 17 failures, 1 collection error, 2 unhandled errors; exit 1 |
| Full strict, fresh baseline | **FAIL**, 9368/9385 tests pass; identical 17 failures, collection error and unhandled signatures; exit 1 |
| Architecture, revision and baseline | **FAIL**, both 1328/1332 tests pass in 29/32 files; identical 4 failed cases in 3 files; exit 1 |

No new failed test IDs, failed file IDs, collection-error IDs or unhandled-error signatures were found in the comparison. The additional 280 strict tests are the YouTube regression expansion. Repository aggregate checks are **not green**. Global strict coverage was not emitted after the suite failure; the separately measured target coverage above is available.

## Evidence and commands

- [summary.json](summary.json) binds results to the code commit and source SHA256; [aggregate-comparison.json](aggregate-comparison.json) lists every actual failed case and error signature.
- `*.command.json` records actual argv, cwd, timestamps, duration and exit code; corresponding `*.stdout.txt` and `*.stderr.txt` preserve real output. `*-host` files are the authoritative revision/baseline comparison; the earlier sandbox runs are retained and explicitly superseded because child-process and localhost-listener operations hit EPERM.
- `*.results.json` are the actual sanitized Vitest JSON reports. [architecture-files.json](architecture-files.json) is the official 32-file architecture selection. `pnpm` was unavailable; execution used the existing Node/Vitest launcher under the repository's resource wrapper, retaining the exact matrix file set.
- [target coverage](target-coverage/coverage-summary.json), [browser result](browser-smoke-result.json), [browser assertion program](browser-smoke.js), and [module hashes](module-identities.json) provide direct evidence. Browser execution transpiled the actual production source with existing TypeScript 5.7.3 to ES2022/ESNext; its source hash matches this code commit. The browser result's original “current working source” label refers to that hash, before the new commit was recorded.
- [run-recorded.py](run-recorded.py), [module-server.py](module-server.py), and [neo-client.py](neo-client.py) are the actual helper scripts. Neo session IDs stayed in memory and were not recorded. The temporary server bound only to loopback and was stopped; task-owned tabs were closed. Existing Neo stayed running and unrelated tabs were untouched.
- [artifact-manifest.json](artifact-manifest.json) records original and published SHA256 values. Machine filesystem prefixes were replaced by documented `$…` placeholders. Output was copied with only those redactions, not recreated. Raw command cwd `.` means the selected revision or baseline worktree according to the record label. Local server PID/port metadata is excluded.

The two new counterexamples were first run against unchanged `9dc1391e` and failed as expected; those real exit-1 logs are retained. Browser checks used the existing native Neo MCP and a synthetic pure-module page. They did not exercise extension injection, YouTube collection, the player, GPU or ASR.

## Remaining limits

Escaped tag-looking XML (`&lt;hello&gt;`) still yields no cue through native DOMParser and a `<hello>` cue through regex fallback, identically on baseline and revision. This existing discrepancy was asserted and left unchanged. Hangul spacing, null segments, `tOffsetMs` and per-event sentence splitting remain separate work.

Full grouped unit/functional/regression stages, WXT preparation, browser/userscript/docs builds, extension injection, site/network browser matrix, RTX5090 WebGPU and ASR are **NOT_RUN**. Unrelated baseline failures were not modified. This branch contains only this record directory; it is evidence, not a code branch or a deployment claim.

## Additional remaining-stage acceptance

[Remaining batch: grouped tests, pure/combined builds and read-only browser blockers](remaining-batch-20261007/README.md) supplements the original record above. It does not change its logged outcomes.

## Extension load continuation and existing CLI session

[CW Neo extension round](extension-batch-20261007/README.md) records the approved `bf22ae08` build's real normal-UI load and management-card visibility, unchanged hashes, native-MCP limitations, and the specifically authorized three-read GitHub CLI diagnostic. Functional subtitle/provider isolation was not established. Developer mode is OFF, test tabs and owned Cua daemons were closed, and existing Neo stays running. **One disabled test extension remains installed:** completing its native uninstall confirmation requires a Cua scope supplement beyond the previously approved system directory chooser. The extension cleanup gate is blocked, not passed.

## Extension cleanup completion

[Cleanup completion](extension-cleanup-completion-20261007/README.md) supersedes that point-in-time cleanup blocker. The parent clarified that original GUI-only Cua authorization already covered the approved extension management and cleanup; no extra approval was needed. One actual native confirmation click removed the test extension. Neo reports developerMode=false and an empty extension list, matching baseline. Test tabs, the owned Cua daemon and its socket are gone; existing dedicated Wayland Neo remains running. **Cleanup PASS; functional subtitle/provider acceptance remains blocked and was not rerun.** The actual native before/after images also correct the earlier claim that closing test tabs had cancelled the native confirmation: it remained present until this GUI confirmation.

## Original-only source UI acceptance

[Original source UI batch](original-source-ui-20261007/README.md) adds real trusted menu-click and synthetic consumer/render/SRT-export evidence using the unchanged approved build. This bounded scope passed; two actual 131-byte SRT downloads matched and cleanup completed again. The prior functional blocker is superseded for **original-only source scope**. MAIN-world real network capture and background/offscreen provider request counts remain NOT_MEASURED; bilingual/provider/ASR acceptance remains NOT_RUN. No PR was created.
