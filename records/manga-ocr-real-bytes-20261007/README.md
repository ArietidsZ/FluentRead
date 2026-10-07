# Manga OCR real-byte fixture verification

The fixed production manifest was extracted without changing any runtime function below `assertMangaOcrActive`; old exports remain compatible. Native Response/File/WebCrypto fixtures use 31/68/1 actual bytes (progress 31/99/100). No real model, OCR, GPU or provider call occurred.

- Baseline: `83deca40091415666fc8fe5a45579b6b80487dcb`. Fix: `ee041a0a0bb081ffdf19af28482d24711668cd8d`. Independent six-group integration: `c7e14e63877985e240ba16c8262cb2227243d177`, parent `e02f471b6e8b9e459118ee0fe92d0490c1a1c982` preserved.
- Target: 27/27 assertions, both runtime and manifest 100% statements/branches/functions/lines. Related: 71/71 in six files. Restored target: 27/27. Fix and integration typecheck/audit pass.
- Seven real source mutations detected and restored. Six cause assertion failure; reader.cancel rejection cleanup mutation instead produces one unhandled rejection and exit 1 with its selected assertion passing. Timer controls report no unhandled rejection. Bindings and exact patches are recorded.
- Optional final glossary failure cleanup proof binds final SHA256 `402002f057f3b75358808988fc69fec2527d64061203811eca148ff25709c895` (Git blob `809e78e8b724a67feb65401f4e46be0bd424e30a`): one intentional expectation failure, no unhandled, restored. No production broker mutation.
- Six-group full strict: **9409/9409 assertions, 383 files pass**, collection 0, unhandled 0. **Command exit 1** because unchanged 100% global gates remain unmet: statements/lines 99.99%, functions 99.97%, branches 99.96%. Nine gap modules have source blobs identical to baseline. Prior failed suite generated no coverage; identical baseline coverage is not claimed.
- Prior five-group actual full strict evidence is reused, not rerun: 9387/9395 assertions with 8 manga fixture failures and one unhandled. Safe two-test baseline subset reproduced two RangeErrors.
- Ownership rerun: 11/13 pass; exact two failure diff blocks match baseline (one unowned script, eighteen coverage-owner gaps). Prior full architecture has four failures across three files; reused separately, not repaired or rerun.

This is fixture and automated-test evidence, not deployment, real OCR, GPU or browser acceptance. Coverage thresholds, production model revisions, URLs, sizes and hashes remain unchanged. No PR or merge was created.
