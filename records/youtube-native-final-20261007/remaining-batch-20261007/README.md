# Remaining acceptance batch — unchanged subtitle patch

Pure subtitle commit: [`66abb72b9e5830634616099172f0b3cc9970c369`](https://github.com/ArietidsZ/FluentRead/commit/66abb72b9e5830634616099172f0b3cc9970c369). Fresh comparison baseline: `83deca40091415666fc8fe5a45579b6b80487dcb`.

Combined acceptance commit: [`bf22ae081ab5b997c088640c605fcc962f7f4bd4`](https://github.com/ArietidsZ/FluentRead/commit/bf22ae081ab5b997c088640c605fcc962f7f4bd4). This is `66abb72` plus only the existing `dccb0bd1c749c7030df590c2512e2b55fb0a5b74` metadata fix, cherry-picked in an independent branch. It changes `entrypoints/localTtsWorker.ts` and `tests/extensionManifestContract.test.ts`. The subtitle source and original code branch remain unchanged; the combined commit is not proposed as part of the subtitle PR.

| Stage | Pure subtitle branch | Fresh baseline / combined result |
| --- | --- | --- |
| Unit group, 302 files | BASELINE FAIL: 6428/6432 pass, 4 failures; exit 1 | Baseline 6148/6152, identical 4 failed cases |
| Functional group, 114 files | BASELINE FAIL: 3146/3160 pass, 14 failures, 1 collection error, 2 unhandled errors; exit 1 | Baseline counts and failed IDs/error signatures identical |
| Regression group, 33 files | BASELINE FAIL: 664/665 pass, 1 failure; exit 1 | Baseline counts and failed case identical |
| WXT prepare / Chrome / Firefox build | BASELINE FAIL: each exit 1 during Worker metadata import | Baseline same ONNX native-library mismatch; combined each PASS, exit 0 |
| Combined compile / metadata contract | Not repeated on pure branch | PASS: compile exit 0, 20 contract tests pass |
| Combined Firefox zip / manifest verifier | No pure extension artifacts generated | PASS, exit 0; Chrome MV3 / Firefox MV2 and archive contracts verified |
| Userscript build / verifier | PASS, each exit 0 | Pure `66abb72` artifact |
| Docs build | PASS, exit 0 | Baseline PASS |
| Docs verifier | BASELINE FAIL, exit 1 | Same missing Storybook link on baseline |
| Extension fixture UI / export / duplicate / cancel / navigation | BLOCKED | Existing Neo agent profile: developer mode off, no FluentRead installed, unsafe extension debug flag absent |
| GitHub installation permission read | BLOCKED | Official installation page redirects to `/login`; PR permission and pending update unknown |

All three official matrix groups were run, covering 449 files. The 280 additional unit tests are the already committed YouTube regression expansion. This batch also revealed two failures outside the prior strict selection: PDF preview lifecycle and OCR settings error copy. Fresh same-command baseline runs reproduce them. No failed test IDs, failed file IDs, collection errors or unhandled-error signatures were added by the subtitle patch. Full repository testing remains **not green**.

The first isolated-worktree group attempts failed collection with zero executed cases because generated `.wxt/tsconfig.json` was missing. Those actual logs remain as `group-*-pure.*`; authoritative group records are `group-*-pure-prepared.*`. Existing generated metadata was copied into the isolated worktree, with no production changes; see [prepared-config-reuse.json](prepared-config-reuse.json). Pure and baseline WXT entrypoint evaluation loads the TTS runtime and fails with native `onnxruntime-node` 1.24.3 requiring `VERS_1.24.3` from a 1.21.0 library. The existing inline-callback metadata fix avoids that evaluation and was tested without alteration.

The docs verifier reproduces `Missing link /storybook/?path=/docs/foundations-colors--docs in en/guide/design-system.html` on both commits. This unrelated issue was left unchanged.

## Evidence

- [summary.json](summary.json): every stage, source commit, status, exact record filenames and exit code; [group-baseline-comparison.json](group-baseline-comparison.json): complete failed case IDs and error signatures.
- `*.command.json`, `*.stdout.txt`, `*.stderr.txt`, and `*.results.json`: real command argv, cwd, timing, exits, logs and Vitest JSON. Top-level Vitest JSON suite counts include nested describe blocks; file counts here use the actual `testResults` list and console summary.
- [build-identities.json](build-identities.json): SHA256 and sizes for every built Chrome/Firefox file, both manifests, pure userscript and docs files, and Firefox/source archives. Local build artifacts were hashed; binaries and source archives are not uploaded to this evidence branch.
- [extension-path-blocker.json](extension-path-blocker.json), [extension facility read](extension-facility-read-result.json), [GitHub permission summary](github-permission-summary.json), and the native-MCP read scripts preserve the precise scope and blocker. No provider fixture was started, so external provider request counts are **NOT_MEASURED**, not asserted as zero. All read-created tabs were closed in `finally`; existing windows and settings were not changed. Browser work used native Neo MCP only.
- [artifact-manifest.json](artifact-manifest.json) records original/published hashes after filesystem-prefix redaction. No auth/session files, cookies, token values, unrelated user page content or local-only MCP schema metadata are published. Logs are copied with documented redactions, not reconstructed.

Previous strict/architecture and standalone 331-test coverage / 69-assertion browser module batches were not repeated. No true YouTube media acquisition, extension injection, browser site matrix, WebGPU/ASR, model downloads or real model/search/translation API tests ran. The original subtitle patch remains awaiting user PR approval; no PR, merge, force push or deployment was attempted.
