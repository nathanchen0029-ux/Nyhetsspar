# Task 7 report: daily publishing, persistence, and clock gate

## Status

Implemented Task 7 and prepared it for commit.

## Delivered

- Added Stockholm-local date/hour calculation with DST support and a 07:00 gate. `--date` accepts only today's Stockholm date.
- Added `FileRepository` as the only writer for lesson, index, ledger, and cache JSON. Date paths are regex checked; cache entry and index schemas are Zod `.strict()` and reject unknown fields including `body`.
- Each JSON write uses a same-directory temporary file and atomic rename, with temporary-file cleanup.
- Added `publishDaily`, which validates the full lesson, next index, and optional ledger/cache before writing anything; it writes lesson, ledger, cache, and finally the public index as the visible commit point.
- Added failpoint-capable file operations for atomic-publication testing. A final-index failure leaves the prior public index unchanged and lesson JSON complete.
- Added the daily runner and CLI. Discovery uses the current `adapter.discover(now, fetcher, robots)` interface; every candidate article uses `fetchPublicSourceText`, preserving source-domain and per-redirect robots enforcement.
- Pipeline handles per-candidate failures independently, marks discovery failure as `failed`, marks empty/unusable discovery as `partial`, permits deterministic backup-candidate selection after a generation failure, and publishes `delayed` lessons with no articles unless 2–3 lessons include both domestic and international coverage.
- A rerun filters a stale current-day ledger record before dedupe/selection, then replaces it on ready publication; this converges after an interrupted internal write before the public-index commit.

## RED/GREEN evidence

- RED: `pnpm vitest run tests/pipeline/run.test.ts` failed because `clock`, `persistence/repository`, and `run` did not exist.
- GREEN: the focused Task 7 suite passed with 8 tests.
- Additional RED: the current-day ledger recovery test initially produced `delayed`; filtering the stale current-day ledger entry before selection made it pass.

## Verification

- Focused pipeline interfaces: `pnpm vitest run tests/pipeline/run.test.ts tests/pipeline/sources-core.test.ts tests/pipeline/adapters.test.ts tests/pipeline/selection.test.ts tests/pipeline/lesson-generation.test.ts` — 64 passed.
- TypeScript: `pnpm exec tsc --noEmit` — passed.
- Full suite: `pnpm test` — 90 passed across 8 files.
- Whitespace check: `git diff --check` — passed.

## Concerns

None known. Cross-file atomicity intentionally uses the public index as the visibility boundary; a process crash before that boundary may leave new internal ledger/cache files, which the next run repairs by rebuilding the current day's ledger entry.
