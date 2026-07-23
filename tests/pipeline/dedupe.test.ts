import { describe, expect, it } from "vitest";
import type { EditorialLedger } from "../../src/contracts/content";
import type { EventFingerprint, SourceArticle } from "../../src/contracts/transient";
import type { NewsAiGateway } from "../../src/pipeline/ai/gateway";
import { deduplicateArticles } from "../../src/pipeline/dedupe/cluster";

function article(
  id: string,
  source: SourceArticle["source"],
  title: string,
  body = `${title}. Kommunerna har presenterat ett gemensamt beslut om återvinning.`,
): SourceArticle {
  return {
    id,
    source,
    url: `https://${source}.se/${id}`,
    canonicalUrl: `https://${source}.se/${id}`,
    title,
    publishedAt: "2026-07-23T04:00:00.000Z",
    body,
    contentHash: `sha256:${id}`,
    isAccessibleForFree: true,
  };
}

function fingerprint(item: SourceArticle, canonical = "kommunerna-nya-regler-atervinning-2026-07-23"): EventFingerprint {
  return {
    candidateId: item.id,
    who: ["kommunerna"],
    action: "nya regler för återvinning",
    where: "Sverige",
    when: "2026-07-23",
    outcome: "enklare sortering",
    scope: "sweden",
    topic: "daily-life",
    canonical,
  };
}

const emptyLedger: EditorialLedger = { schemaVersion: 1, days: [] };

describe("event deduplication", () => {
  it("keeps one representative and attaches related coverage", async () => {
    const gateway: NewsAiGateway = {
      async fingerprint(items) { return items.map((item) => fingerprint(item)); },
      async reviewPairs(pairs) {
        return pairs.map((pair) => ({ pairId: pair.pairId, sameEvent: true, confidence: 0.94, reason: "same decision", materialUpdate: false }));
      },
    };
    const result = await deduplicateArticles([
      article("svt-1", "svt", "Kommunerna får nya regler"),
      article("dn-1", "dn", "Nytt beslut ska ändra återvinningen"),
    ], emptyLedger, gateway);
    expect(result).toHaveLength(1);
    expect(result[0]?.related).toHaveLength(1);
  });

  it("suppresses a seven-day repeat without a material update", async () => {
    const ledger: EditorialLedger = {
      schemaVersion: 1,
      days: [{ date: "2026-07-22", scopes: { local: 0, sweden: 1, international: 1 }, topics: { politics: 0, economy: 0, "daily-life": 1, culture: 1, sports: 0 }, sources: { svt: 1, aftonbladet: 1, dn: 0 }, eventFingerprints: ["kommunerna-nya-regler-atervinning-2026-07-23"] }],
    };
    const gateway: NewsAiGateway = { async fingerprint(items) { return items.map((item) => fingerprint(item)); }, async reviewPairs() { return []; } };
    await expect(deduplicateArticles([article("svt-1", "svt", "Kommunerna får nya regler")], ledger, gateway)).resolves.toEqual([]);
  });

  it("keeps different events about the same institution separate", async () => {
    const gateway: NewsAiGateway = {
      async fingerprint(items) {
        return items.map((item, index) => ({ ...fingerprint(item, index === 0 ? "regeringen-budget" : "regeringen-utredare"), who: ["regeringen"], action: index === 0 ? "presenterar en budget" : "utser en utredare", outcome: index === 0 ? "nya anslag" : "ny utredning", topic: "politics" }));
      },
      async reviewPairs(pairs) { return pairs.map((pair) => ({ pairId: pair.pairId, sameEvent: false, confidence: 0.98, reason: "different decisions", materialUpdate: false })); },
    };
    const result = await deduplicateArticles([article("budget", "svt", "Regeringen presenterar budget"), article("utredning", "dn", "Regeringen utser utredare")], emptyLedger, gateway);
    expect(result).toHaveLength(2);
  });

  it("labels merged coverage with a material update as follow-up", async () => {
    const gateway: NewsAiGateway = {
      async fingerprint(items) { return items.map((item) => ({ ...fingerprint(item, "valmyndigheten-slutligt-resultat"), who: ["valmyndigheten"], action: "publicerar valresultat", outcome: "slutligt resultat", topic: "politics" })); },
      async reviewPairs(pairs) { return pairs.map((pair) => ({ pairId: pair.pairId, sameEvent: true, confidence: 0.96, reason: "new confirmed result", materialUpdate: true })); },
    };
    const result = await deduplicateArticles([article("preliminar", "svt", "Preliminärt valresultat"), article("slutligt", "dn", "Slutligt valresultat klart")], emptyLedger, gateway);
    expect(result).toHaveLength(1);
    expect(result[0]?.isFollowUp).toBe(true);
  });

  it("uses transitive review matches to form one three-node cluster", async () => {
    const gateway: NewsAiGateway = {
      async fingerprint(items) { return items.map((item) => fingerprint(item)); },
      async reviewPairs(pairs) { return pairs.map((pair) => ({ pairId: pair.pairId, sameEvent: pair.pairId !== "a:c", confidence: 0.9, reason: "same event", materialUpdate: false })); },
    };
    const result = await deduplicateArticles([article("a", "svt", "Kommunerna återvinner mer"), article("b", "dn", "Kommunerna återvinner mer idag"), article("c", "aftonbladet", "Kommunerna återvinner mer nu")], emptyLedger, gateway);
    expect(result).toHaveLength(1);
    expect(result[0]?.related).toHaveLength(2);
  });

  it("exact-deduplicates before fingerprinting", async () => {
    const first = article("first", "svt", "Samma artikel");
    const duplicate = { ...article("second", "dn", "Samma artikel", "Längre rapportering om samma sak."), contentHash: first.contentHash };
    let fingerprinted = 0;
    const gateway: NewsAiGateway = { async fingerprint(items) { fingerprinted = items.length; return items.map((item) => fingerprint(item)); }, async reviewPairs() { return []; } };
    await deduplicateArticles([first, duplicate], emptyLedger, gateway);
    expect(fingerprinted).toBe(1);
  });

  it("keeps an exact historical repeat only when review confirms a material update", async () => {
    const current = article("current", "svt", "Kommunerna fattar ett nytt beslut");
    const previous = { ...fingerprint(current), candidateId: "historical" };
    const ledger = ledgerWithDetails([previous]);
    const gateway: NewsAiGateway = {
      async fingerprint(items) { return items.map((item) => fingerprint(item)); },
      async reviewPairs(pairs) { return pairs.map((pair) => ({ pairId: pair.pairId, sameEvent: true, confidence: 0.9, reason: "confirmed update", materialUpdate: true })); },
    };
    const result = await deduplicateArticles([current], ledger, gateway);
    expect(result).toHaveLength(1);
    expect(result[0]?.isFollowUp).toBe(true);
  });

  it("keeps a similar but unrelated historical event without marking it as a follow-up", async () => {
    const current = article("current", "svt", "Kommunerna fattar ett nytt beslut");
    const previous = { ...fingerprint(current, "kommunerna-nya-regler-atervinning-2026-07-22"), candidateId: "historical", action: "gamla regler för återvinning" };
    const gateway: NewsAiGateway = {
      async fingerprint(items) { return items.map((item) => fingerprint(item, "kommunerna-nya-regler-atervinning-2026-07-23")); },
      async reviewPairs(pairs) { return pairs.map((pair) => ({ pairId: pair.pairId, sameEvent: false, confidence: 0.98, reason: "different decisions", materialUpdate: false })); },
    };
    const result = await deduplicateArticles([current], ledgerWithDetails([previous]), gateway);
    expect(result).toHaveLength(1);
    expect(result[0]?.isFollowUp).toBe(false);
  });

  it("suppresses the same historical event without an update when its canonical changes", async () => {
    const current = article("current", "svt", "Kommunerna fattar ett nytt beslut");
    const previous = { ...fingerprint(current, "kommunerna-nya-regler-atervinning-2026-07-22"), candidateId: "historical" };
    const gateway: NewsAiGateway = {
      async fingerprint(items) { return items.map((item) => fingerprint(item, "kommunerna-nya-regler-atervinning-2026-07-23")); },
      async reviewPairs(pairs) { return pairs.map((pair) => ({ pairId: pair.pairId, sameEvent: true, confidence: 0.9, reason: "same event", materialUpdate: false })); },
    };
    await expect(deduplicateArticles([current], ledgerWithDetails([previous]), gateway)).resolves.toEqual([]);
  });

  it("selects the same representative when equal-score input order changes", async () => {
    const first = article("z-id", "svt", "Samma nyhet", "lika många ord här");
    const second = { ...article("a-id", "dn", "Samma nyhet", "lika många ord här"), canonicalUrl: "https://dn.se/a" };
    const gateway: NewsAiGateway = { async fingerprint(items) { return items.map((item) => fingerprint(item)); }, async reviewPairs(pairs) { return pairs.map((pair) => ({ pairId: pair.pairId, sameEvent: true, confidence: 0.9, reason: "same", materialUpdate: false })); } };
    const forward = await deduplicateArticles([first, second], emptyLedger, gateway);
    const reverse = await deduplicateArticles([second, first], emptyLedger, gateway);
    expect(forward[0]?.article.id).toBe("a-id");
    expect(reverse[0]?.article.id).toBe("a-id");
  });
});

function ledgerWithDetails(eventDetails: EventFingerprint[]): EditorialLedger {
  return { schemaVersion: 1, days: [{ date: "2026-07-22", scopes: { local: 0, sweden: 1, international: 1 }, topics: { politics: 0, economy: 0, "daily-life": 1, culture: 1, sports: 0 }, sources: { svt: 1, aftonbladet: 1, dn: 0 }, eventFingerprints: eventDetails.map((item) => item.canonical), eventDetails }] };
}
