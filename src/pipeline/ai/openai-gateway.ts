import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { ScopeSchema, TopicSchema } from "../../contracts/content";
import type { EventFingerprint } from "../../contracts/transient";
import type { DuplicatePair, DuplicateReview, NewsAiGateway } from "./gateway";
import { DUPLICATE_SYSTEM, FINGERPRINT_SYSTEM } from "./prompts";

const FingerprintBatchSchema = z.object({ items: z.array(z.object({
  candidateId: z.string(), who: z.array(z.string()), action: z.string(), where: z.string(), when: z.string(), outcome: z.string(),
  scope: ScopeSchema, topic: TopicSchema, canonical: z.string(),
})) });
const DuplicateBatchSchema = z.object({ items: z.array(z.object({
  pairId: z.string(), sameEvent: z.boolean(), confidence: z.number().min(0).max(1), reason: z.string(), materialUpdate: z.boolean(),
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
  return status === 429 || status >= 500 || error.name === "APIConnectionError" || error.name === "APITimeoutError";
}

export function createOpenAiGateway(options: OpenAiGatewayOptions): NewsAiGateway {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!options.client && !apiKey) throw new Error("openai-api-key-required");
  const client = options.client ?? new OpenAI({ apiKey });
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
        });
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
  };
}
