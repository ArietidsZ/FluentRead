# Five minimal repository quality fixes

Integration: [`e02f471b`](https://github.com/ArietidsZ/FluentRead/commit/e02f471b6e8b9e459118ee0fe92d0490c1a1c982); fixed baseline `83deca40091415666fc8fe5a45579b6b80487dcb`. Current upstream was checked and its target files were unchanged.

| Independent fix | Files | Related tests | Commit |
| --- | --- | --- | --- |
| stats-i18n | src/features/settings/model/navigation.ts, tests/translationStatsI18n.test.ts | 83 PASS | [`e113c866`](https://github.com/ArietidsZ/FluentRead/commit/e113c86683d653fc501e42780bd4fe4ef5e6a6d7) |
| harness-contracts | tests/contentFeatureMounting.test.ts, tests/harnessConversation.test.ts | 103 PASS | [`b88f50ff`](https://github.com/ArietidsZ/FluentRead/commit/b88f50ff0226dc56772866314471b7b04370b70e) |
| glossary-fixture | tests/imageGlossaryContext.test.ts | 103 PASS | [`8225bff5`](https://github.com/ArietidsZ/FluentRead/commit/8225bff5f253e041a93bc49ab63e711b6756a8c6) |
| ime-loader | tests/settingsCompositionAutosave.test.ts | 4 PASS | [`dc5c5159`](https://github.com/ArietidsZ/FluentRead/commit/dc5c51594410c1d8542f30e8131a745bd0b585c9) |
| page-read-fixture | tests/imageTranslationPageRead.test.ts | 44 PASS | [`285fb828`](https://github.com/ArietidsZ/FluentRead/commit/285fb828e3ef7e3a1df74b1c3b5f029afc1dea01) |

Only production change: insert the existing ` · ` translation separator between the two registered statistics keyword groups. The other six files correct stale test contracts and fixture wiring. Selection-off blocks Harness mounting; pending/Range/session/dispose constraints remain. Glossary gates use protected provider text while handler requests assert raw OCR text, with immediate rejection handling and finally drainage. The IME loader injects only the known FieldHelp import and rejects unknown imports. The page-read suite shares one hoisted polyfill/global-browser fixture and retains all nine cases. No broker, IME, OCR, architecture threshold or subtitle production behavior changed.

| Integration validation | Actual outcome |
| --- | --- |
| Compatibility suites | 337 PASS, 17 files, exit 0 |
| Seven negative controls | Each failed as expected, exit 1; zero unhandled errors; mutations restored |
| Typecheck / audit / diff check | PASS, exit 0 |
| Full strict | 9387/9395 PASS; 8 existing OCR failures in one file, no collection errors, one existing unhandled error; exit 1 |
| Comparison with actual known baseline | 9 assertion failures and the page-read collection error resolved; no new failure IDs or signatures |

The baseline full strict log is reused from the previous actual CW run at 83deca4, with the same config and flags. It was not run again in this batch; see [baseline-record-reuse.json](baseline-record-reuse.json). The six affected baseline suites were run again before edits and reproduced nine failures, one collection error and one unhandled rejection. The full repository gate remains **FAIL**, with the unchanged `mangaOcrAssets.test.ts` eight cases and `RangeError: Invalid typed array length: 206291843` left for separate work. Global coverage was not emitted after failure; no coverage definition or threshold changed.

[summary.json](summary.json), [commits.json](commits.json), [full-strict-comparison.json](full-strict-comparison.json), and [negative-controls.json](negative-controls.json) bind outcomes to source commits. Each actual command has argv, cwd, timing, exit, stdout/stderr and JSON test reports. Mutation patches are public test/source counterexamples only and are not part of the code branches. All branches are independently rooted at the fixed baseline; the integration branch cherry-picks only these five commits. It includes neither the subtitle patch nor the WXT metadata fix.

Generated .wxt metadata was copied from the existing prepared CW checkout, with its tsconfig hash recorded; there were no zero-test setup runs. Known filesystem prefixes were redacted, and original/published hashes are recorded in [artifact-manifest.json](artifact-manifest.json). No credentials or auth files are included. Audit case counts are static source counts, not runtime totals.

Architecture, builds, extension-browser paths, GPU/ASR and real model/search/provider API tests were NOT_RUN in this quality batch. The separately approved Neo subtitle-extension continuation uses bf22ae08 and is recorded separately. No PR, merge, force push or deployment occurred.
