### Task 4 Report: OpenAI Gateway and Cross-Source Deduplication

Commit: pending

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
