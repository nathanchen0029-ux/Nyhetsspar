# Task 6 report — Lesson Generation, Decoration, and Validation

## Scope delivered

- Added deterministic Unicode-boundary decoration with phrase > grammar > vocabulary precedence and lossless segments.
- Added publish-time lesson validation for word count, quotations, source binding, annotations, numeric claims, and normalized 26-word source overlap.
- Added one-repair lesson generation: only `ZodError` and `lesson-*` validation failures obtain one repair call; other errors are rethrown immediately.
- Extended the OpenAI gateway with an ID-free lesson draft schema. The gateway supplies all persisted article metadata locally, uses `article.id` for the lesson ID, decorates model paragraphs locally, and exposes only related source/title/canonical URL (never related body).
- Kept the existing SDK `maxRetries: 0`, three-attempt transient retry ceiling, and usage-only logging. Expanded the lesson instruction to emphasize natural Swedish and observed-only difficulty labeling.

## TDD evidence

`pnpm vitest run tests/pipeline/lesson-generation.test.ts` first failed because the three lesson modules did not exist. After implementation, the same focused test passed (9 tests).

## Verification

- `pnpm vitest run tests/pipeline/lesson-generation.test.ts tests/pipeline/openai-gateway.test.ts tests/contracts/content.test.ts` — 25 passed.
- `pnpm exec tsc --noEmit` — passed.
- `pnpm test` — 74 passed across 7 files.
- `git diff --check` — passed.

## Concerns

None. Validation intentionally rejects model output that is structurally valid but not safely attributable to the selected primary source; that output receives the single permitted repair attempt.
