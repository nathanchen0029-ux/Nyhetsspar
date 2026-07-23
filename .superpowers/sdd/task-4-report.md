### Task 4 Report: OpenAI Gateway and Cross-Source Deduplication

Initial commit: `c21fd73 feat: deduplicate cross-source news events`.

### RED

- Added the Task 4 deduplication and OpenAI gateway specifications before production modules existed.
- Ran `pnpm vitest run tests/pipeline/dedupe.test.ts tests/pipeline/openai-gateway.test.ts` with the bundled runtime.
- Confirmed RED: both suites failed because `dedupe/cluster` and `ai/openai-gateway` did not yet exist.

### GREEN

- Added the typed AI boundary, factual prompts, and Responses API structured-output gateway using `responses.parse`, `zodTextFormat`, and `output_parsed`.
- The gateway defaults to configurable `gpt-5.4-mini`, takes its API key only from options or `OPENAI_API_KEY`, truncates sent article text, logs usage metadata only, retries only transient 429/5xx/connection/timeout failures for at most three attempts, and validates one-to-one response IDs.
- Added exact URL/content-hash deduplication followed by fingerprint/title candidate screening, confidence-gated pair review, union-find transitive clustering, deterministic representation, related coverage, and seven-day repeat suppression.

### Verification

- Focused + contracts: `pnpm vitest run tests/pipeline/dedupe.test.ts tests/pipeline/openai-gateway.test.ts tests/contracts/content.test.ts` — 21 passed.
- Typecheck: `pnpm exec tsc --noEmit` — passed.
- Full suite: `pnpm test` — 53 passed.
- Whitespace/diff check: `git diff --check` — passed.

### Self-review

- Covered the four Task 4 brief scenarios; exact dedupe; three-node A-B/B-C transitive clustering; zero-pair review; missing, duplicate, and unknown candidate/pair IDs; and transient versus permanent retry boundaries.
- Prompt content contains only supplied facts and no credentials or source bodies are written to logs.
- Pair merging requires both candidate screening and `sameEvent` with confidence at least 0.85.

### Concerns

- Usage metadata is deliberately written to stdout so pipeline observability does not capture source text, prompts, structured responses, or credentials.

### Review follow-up

- Disabled SDK retries both at OpenAI client construction and per Responses request; the gateway's loop is now the sole retry controller and has exactly three total HTTP attempts.
- Recognizes the current `APIConnectionTimeoutError` name (while retaining compatibility with the earlier timeout name).
- Added optional, backward-compatible `eventDetails` to historical ledger days. Detailed history is reviewed through the AI gateway; legacy string-only exact repeats remain fail-closed. A confirmed historical material update retains and labels the current item; a confirmed same event without an update suppresses it; an unrelated match remains a normal item.
- Current-current and current-historical pairs are tracked separately, so history never enters the union-find. When multiple historical reviews conflict, any confirmed material update is sufficient to retain the cluster and label it as a follow-up; otherwise any confirmed same-event/no-update result suppresses it.
- Equal representative scores now break deterministically by canonical URL then ID. Restored the complete lesson prompt constraints.

### Final follow-up verification

- Focused gateway/dedupe/contracts: 26 passed.
- TypeScript: passed.
- Full suite: 58 passed.
- `git diff --check`: passed.
