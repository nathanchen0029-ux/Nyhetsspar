import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { AnnotationSchema, LessonArticleSchema, ScopeSchema, TopicSchema, countSwedishWords } from "../../contracts/content";
import type { EventFingerprint } from "../../contracts/transient";
import { decorateParagraphs } from "../lessons/decorate";
import type { AiGateway, DuplicatePair, DuplicateReview, LessonFactClaim } from "./gateway";
import { DUPLICATE_SYSTEM, FACT_CHECK_SYSTEM, FINGERPRINT_SYSTEM, LESSON_SYSTEM } from "./prompts";

const FingerprintBatchSchema = z.object({ items: z.array(z.object({
  candidateId: z.string(), who: z.array(z.string()), action: z.string(), where: z.string(), when: z.string(), outcome: z.string(),
  scope: ScopeSchema, topic: TopicSchema, canonical: z.string(),
})) });
const DuplicateBatchSchema = z.object({ items: z.array(z.object({
  pairId: z.string(), sameEvent: z.boolean(), confidence: z.number().min(0).max(1), reason: z.string(), materialUpdate: z.boolean(),
})) });
const LessonDraftSchema = z.object({
  studyTitle: z.string().min(1),
  paragraphs: z.array(z.string().min(1)).min(2),
  difficulty: z.object({
    level: z.string().regex(/^(?:A1|A2|B1|B2|C1|C2)(?:[–-](?:A1|A2|B1|B2|C1|C2))?$/u),
    reasons: z.array(z.string().min(1)).min(1),
    readingMinutes: z.number().int().positive(),
  }),
  summaries: z.object({ sv: z.string().min(1), zh: z.string().min(1), en: z.string().min(1) }),
  factPoints: z.array(z.string().min(1)).min(2),
  originalSentenceNotes: z.array(z.object({ quote: z.string().min(1), annotationIds: z.array(z.string()).min(1) })).min(2).max(4),
  annotations: z.array(AnnotationSchema).min(6).max(18),
});
const FactCheckBatchSchema = z.object({ items: z.array(z.object({
  claimId: z.string().min(1),
  supported: z.boolean(),
  evidence: z.string().min(1),
  reason: z.string().min(1),
})) });

type ParseClient = Pick<OpenAI, "responses">;

export interface OpenAiGatewayOptions {
  apiKey?: string;
  model?: string;
  client?: ParseClient;
  retryDelayMs?: number;
}

function assertOneForEach(kind: string, expectedIds: readonly string[], receivedIds: readonly string[]): void {
  const expected = new Set(expectedIds);
  if (expected.size !== expectedIds.length) throw new Error(`${kind}: duplicate requested ID`);
  const received = new Set<string>();
  for (const id of receivedIds) {
    if (!expected.has(id)) throw new Error(`${kind}: unknown ${kind === "fingerprint" ? "candidateId" : "pairId"}`);
    if (received.has(id)) throw new Error(`${kind}: duplicate ${kind === "fingerprint" ? "candidateId" : "pairId"}`);
    received.add(id);
  }
  if (received.size !== expected.size) throw new Error(`${kind}: missing ${kind === "fingerprint" ? "candidateId" : "pairId"}`);
}

function isTransient(error: Error): boolean {
  const status = typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) : 0;
  return status === 429 || status >= 500 || error.name === "APIConnectionError" || error.name === "APIConnectionTimeoutError" || error.name === "APITimeoutError";
}

function assertFactClaimIds(expectedClaims: readonly LessonFactClaim[], receivedIds: readonly string[]): void {
  const expectedIds = expectedClaims.map((claim) => claim.id);
  const expected = new Set(expectedIds);
  if (expected.size !== expectedIds.length) throw new Error("lesson-fact-claimId-duplicate-request");
  const received = new Set<string>();
  for (const id of receivedIds) {
    if (!expected.has(id)) throw new Error("lesson-fact-claimId-unknown");
    if (received.has(id)) throw new Error("lesson-fact-claimId-duplicate");
    received.add(id);
  }
  if (received.size !== expected.size) throw new Error("lesson-fact-claimId-missing");
}

export function createOpenAiGateway(options: OpenAiGatewayOptions): AiGateway {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!options.client && !apiKey) throw new Error("openai-api-key-required");
  const client = options.client ?? new OpenAI({ apiKey, maxRetries: 0 });
  const model = options.model ?? "gpt-5.4-mini";
  const retryDelayMs = options.retryDelayMs ?? 2_000;

  async function parse<T>(schema: z.ZodType<T>, name: string, system: string, payload: unknown): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await client.responses.parse({
          model,
          max_output_tokens: 4_500,
          input: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(payload) }],
          text: { format: zodTextFormat(schema, name) },
        }, { maxRetries: 0 });
        if (!response.output_parsed) throw new Error(`openai-empty-structured-output:${name}`);
        const usage = response.usage;
        process.stdout.write(`${JSON.stringify({ type: "openai-usage", model, operation: name, inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0 })}\n`);
        return response.output_parsed;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!isTransient(lastError) || attempt === 2) throw lastError;
        if (retryDelayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs * 4 ** attempt));
      }
    }
    throw lastError ?? new Error(`openai-failed:${name}`);
  }

  return {
    async fingerprint(articles): Promise<EventFingerprint[]> {
      if (articles.length === 0) return [];
      const result = await parse(FingerprintBatchSchema, "event_fingerprints", FINGERPRINT_SYSTEM, articles.map(({ id, title, publishedAt, body }) => ({
        candidateId: id, title, publishedAt,
        body: body.length <= 2_400 ? body : `${body.slice(0, 1_600)}\n[…]\n${body.slice(-800)}`,
      })));
      assertOneForEach("fingerprint", articles.map((article) => article.id), result.items.map((item) => item.candidateId));
      return result.items;
    },
    async reviewPairs(pairs: DuplicatePair[]): Promise<DuplicateReview[]> {
      if (pairs.length === 0) return [];
      const result = await parse(DuplicateBatchSchema, "duplicate_reviews", DUPLICATE_SYSTEM, pairs);
      assertOneForEach("review", pairs.map((pair) => pair.pairId), result.items.map((item) => item.pairId));
      return result.items;
    },
    async generateLesson(input, repairReason) {
      const draft = LessonDraftSchema.parse(await parse(
        LessonDraftSchema,
        "lesson_draft",
        LESSON_SYSTEM,
        {
          sourceArticle: {
            title: input.article.title,
            publishedAt: input.article.publishedAt,
            body: input.article.body.length <= 12_000 ? input.article.body : `${input.article.body.slice(0, 9_000)}\n[…]\n${input.article.body.slice(-3_000)}`,
          },
          eventFingerprint: input.fingerprint,
          repairReason,
        },
      ));
      const studyParagraphs = decorateParagraphs(draft.paragraphs, draft.annotations);
      return LessonArticleSchema.parse({
        id: input.article.id,
        eventFingerprint: input.fingerprint.canonical,
        source: input.article.source,
        sourceUrl: input.article.canonicalUrl,
        sourceTitle: input.article.title,
        publishedAt: input.article.publishedAt,
        scope: input.fingerprint.scope,
        topic: input.fingerprint.topic,
        isFollowUp: input.isFollowUp,
        difficulty: draft.difficulty,
        studyTitle: draft.studyTitle,
        studyParagraphs,
        wordCount: countSwedishWords(draft.paragraphs.join("\n\n")),
        summaries: draft.summaries,
        factPoints: draft.factPoints,
        originalSentenceNotes: draft.originalSentenceNotes.map((note) => ({ ...note, sourceUrl: input.article.canonicalUrl })),
        annotations: draft.annotations,
        relatedCoverage: input.related.map(({ source, title, canonicalUrl }) => ({ source, title, url: canonicalUrl })),
        generationModel: model,
        contentHash: input.article.contentHash,
      });
    },
    async verifyLessonFacts(sourceBody, claims) {
      if (claims.length === 0) return;
      const result = FactCheckBatchSchema.parse(await parse(
        FactCheckBatchSchema,
        "lesson_fact_check",
        FACT_CHECK_SYSTEM,
        { sourceBody, claims },
      ));
      assertFactClaimIds(claims, result.items.map((item) => item.claimId));
      for (const item of result.items) {
        if (!item.supported) throw new Error(`lesson-unsupported-fact:${item.claimId}`);
        const evidenceWords = countSwedishWords(item.evidence);
        if (evidenceWords === 0 || evidenceWords > 25) throw new Error(`lesson-fact-evidence-too-long:${item.claimId}`);
        if (!sourceBody.includes(item.evidence)) throw new Error(`lesson-fact-evidence-not-in-source:${item.claimId}`);
      }
    },
  };
}
