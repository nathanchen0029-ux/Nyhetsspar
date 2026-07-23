### Task 5 Report: Seven-Day Editorial Selection

### RED

- Added selection and ledger behavior tests before the selection module existed.
- Ran `pnpm vitest run tests/pipeline/selection.test.ts` with the bundled runtime.
- Confirmed RED: Vitest could not resolve `src/pipeline/selection/select`.

### GREEN

- Added deterministic selection capped at three articles, with non-positive limits returning no articles.
- Candidates are deduplicated by article ID and canonical URL before selection. Sort ties use canonical URL and ID so reverse input produces the same result.
- With a limit of two or more, the selector reserves one domestic (`local` or `sweden`) and one international item when both categories are available. It otherwise returns the available candidates without inventing coverage.
- Remaining choices are greedy and account for both seven-day rolling counts and already chosen daily scope, topic, and source counts.
- `appendLedgerDay` writes canonical strings plus complete `eventDetails`, replaces an existing date, sorts chronologically, retains the most recent seven days, and validates the returned ledger through the editorial schemas.

### Verification

- Focused selection + dedupe + contracts: `pnpm vitest run tests/pipeline/selection.test.ts tests/pipeline/dedupe.test.ts tests/contracts/content.test.ts` — 27 passed.
- TypeScript: `pnpm exec tsc --noEmit` — passed.
- Full suite: `pnpm test` — 65 passed.
- Whitespace/diff check: `git diff --check` — passed.

### Concerns

- A limit of one cannot represent both required coverage categories; the selector honors the requested one-item limit. Candidate shortages may likewise return fewer than two items for the downstream delayed-state decision.
