import { describe, expect, it } from "vitest";
import { createOpenAiGateway } from "../../src/pipeline/ai/openai-gateway";
import type { EventFingerprint, SourceArticle } from "../../src/contracts/transient";
import type { DuplicatePair } from "../../src/pipeline/ai/gateway";

const article: SourceArticle = { id: "one", source: "svt", url: "https://svt.se/one", canonicalUrl: "https://svt.se/one", title: "En titel", publishedAt: "2026-07-23T00:00:00.000Z", body: "nödvändig artikeltext", contentHash: "hash", isAccessibleForFree: true };

function clientWith(outputs: unknown[]) {
  let calls = 0;
  return { calls: () => calls, responses: { parse: async () => { const output = outputs[calls++]; if (output instanceof Error) throw output; return { output_parsed: output, usage: { input_tokens: 1, output_tokens: 2 } }; } } };
}

describe("OpenAI news gateway", () => {
  it("rejects fingerprint output with missing, duplicate, or unknown candidate IDs", async () => {
    for (const items of [[], [{ ...validFingerprint(), candidateId: "one" }, { ...validFingerprint(), candidateId: "one" }], [{ ...validFingerprint(), candidateId: "other" }]]) {
      const client = clientWith([{ items }]);
      await expect(createOpenAiGateway({ apiKey: "test", client: client as never }).fingerprint([article])).rejects.toThrow(/candidateId/u);
    }
  });

  it("rejects duplicate review output with missing, duplicate, or unknown pair IDs", async () => {
    const pair: DuplicatePair = { pairId: "one:two", left: validFingerprint(), right: { ...validFingerprint(), candidateId: "two" } };
    for (const items of [[], [{ pairId: "one:two", sameEvent: true, confidence: 0.9, reason: "same", materialUpdate: false }, { pairId: "one:two", sameEvent: true, confidence: 0.9, reason: "same", materialUpdate: false }], [{ pairId: "other", sameEvent: true, confidence: 0.9, reason: "same", materialUpdate: false }]]) {
      const client = clientWith([{ items }]);
      await expect(createOpenAiGateway({ apiKey: "test", client: client as never }).reviewPairs([pair])).rejects.toThrow(/pairId/u);
    }
  });

  it("retries transient errors at most three attempts", async () => {
    const retryable = Object.assign(new Error("rate limited"), { status: 429 });
    const client = clientWith([retryable, retryable, { items: [validFingerprint()] }]);
    await expect(createOpenAiGateway({ apiKey: "test", client: client as never, retryDelayMs: 0 }).fingerprint([article])).resolves.toHaveLength(1);
    expect(client.calls()).toBe(3);
  });

  it("does not retry permanent errors", async () => {
    const client = clientWith([Object.assign(new Error("bad request"), { status: 400 })]);
    await expect(createOpenAiGateway({ apiKey: "test", client: client as never, retryDelayMs: 0 }).fingerprint([article])).rejects.toThrow("bad request");
    expect(client.calls()).toBe(1);
  });

  it("does not request duplicate review for zero pairs", async () => {
    const client = clientWith([]);
    await expect(createOpenAiGateway({ apiKey: "test", client: client as never }).reviewPairs([])).resolves.toEqual([]);
    expect(client.calls()).toBe(0);
  });
});

function validFingerprint(): EventFingerprint { return { candidateId: "one", who: ["kommun"], action: "beslutar", where: "Sverige", when: "2026-07-23", outcome: "resultat", scope: "sweden", topic: "daily-life", canonical: "kommun-beslut" }; }
