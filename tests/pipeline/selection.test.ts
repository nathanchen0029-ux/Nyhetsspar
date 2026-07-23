import { describe, expect, it } from "vitest";
import { EditorialLedgerSchema, type EditorialLedger } from "../../src/contracts/content";
import type { FingerprintedArticle } from "../../src/contracts/transient";
import { appendLedgerDay, selectDailyArticles } from "../../src/pipeline/selection/select";

function candidate(
  id: string,
  scope: FingerprintedArticle["fingerprint"]["scope"],
  topic: FingerprintedArticle["fingerprint"]["topic"],
  source: FingerprintedArticle["article"]["source"],
): FingerprintedArticle {
  return {
    article: {
      id,
      source,
      url: `https://example.test/${id}`,
      canonicalUrl: `https://example.test/${id}`,
      title: id,
      publishedAt: "2026-07-23T04:00:00.000Z",
      body: Array.from({ length: 250 }, () => "saklig").join(" "),
      contentHash: `sha256:${id}`,
      isAccessibleForFree: true,
    },
    fingerprint: {
      candidateId: id,
      who: [],
      action: id,
      where: scope === "international" ? "världen" : "Sverige",
      when: "2026-07-23",
      outcome: id,
      scope,
      topic,
      canonical: id,
    },
    related: [],
    isFollowUp: false,
  };
}

const emptyLedger: EditorialLedger = { schemaVersion: 1, days: [] };

describe("daily editorial selection", () => {
  it("always contains Swedish and international coverage", () => {
    const selected = selectDailyArticles(
      [
        candidate("se", "sweden", "daily-life", "svt"),
        candidate("world", "international", "politics", "dn"),
        candidate("culture", "sweden", "culture", "aftonbladet"),
        candidate("sport", "international", "sports", "aftonbladet"),
      ],
      emptyLedger,
      3,
    );
    expect(selected.some((item) => item.fingerprint.scope !== "international")).toBe(true);
    expect(selected.some((item) => item.fingerprint.scope === "international")).toBe(true);
  });

  it("prefers a topic absent from the rolling ledger", () => {
    const ledger: EditorialLedger = {
      schemaVersion: 1,
      days: [{
        date: "2026-07-22",
        scopes: { local: 0, sweden: 2, international: 1 },
        topics: { politics: 1, economy: 1, "daily-life": 1, culture: 0, sports: 0 },
        sources: { svt: 1, aftonbladet: 1, dn: 1 },
        eventFingerprints: ["old"],
      }],
    };
    const selected = selectDailyArticles(
      [
        candidate("se", "sweden", "daily-life", "svt"),
        candidate("world", "international", "politics", "dn"),
        candidate("culture", "sweden", "culture", "aftonbladet"),
      ], ledger, 3,
    );
    expect(selected.map((item) => item.fingerprint.topic)).toContain("culture");
  });

  it("returns no results for a non-positive limit and never selects more than three", () => {
    const candidates = [
      candidate("one", "sweden", "daily-life", "svt"),
      candidate("two", "international", "politics", "dn"),
      candidate("three", "sweden", "culture", "aftonbladet"),
      candidate("four", "international", "sports", "svt"),
    ];
    expect(selectDailyArticles(candidates, emptyLedger, 0)).toEqual([]);
    expect(selectDailyArticles(candidates, emptyLedger, -1)).toEqual([]);
    expect(selectDailyArticles(candidates, emptyLedger, 99)).toHaveLength(3);
  });

  it("keeps the available coverage when one required scope is missing", () => {
    const selected = selectDailyArticles(
      [candidate("local", "local", "culture", "svt"), candidate("sweden", "sweden", "sports", "dn")],
      emptyLedger,
      3,
    );
    expect(selected).toHaveLength(2);
    expect(selected.every((item) => item.fingerprint.scope !== "international")).toBe(true);
  });

  it("deduplicates by article id and canonical URL", () => {
    const original = candidate("original", "sweden", "culture", "svt");
    const sameId = { ...candidate("original", "international", "politics", "dn"), article: { ...candidate("original", "international", "politics", "dn").article, canonicalUrl: "https://example.test/other" } };
    const sameUrl = { ...candidate("url-copy", "international", "sports", "dn"), article: { ...candidate("url-copy", "international", "sports", "dn").article, canonicalUrl: original.article.canonicalUrl } };
    const selected = selectDailyArticles([original, sameId, sameUrl], emptyLedger, 3);
    expect(selected).toEqual([original]);
  });

  it("uses daily dynamic counts and stable canonical URL and id tie-breaks", () => {
    const candidates = [
      candidate("z-id", "sweden", "culture", "svt"),
      candidate("international", "international", "culture", "svt"),
      candidate("a-id", "sweden", "culture", "svt"),
    ];
    candidates[0]!.article.canonicalUrl = "https://example.test/z";
    candidates[2]!.article.canonicalUrl = "https://example.test/a";
    const forward = selectDailyArticles(candidates, emptyLedger, 3).map((item) => item.article.id);
    const reverse = selectDailyArticles([...candidates].reverse(), emptyLedger, 3).map((item) => item.article.id);
    expect(forward).toEqual(reverse);
    expect(forward).toEqual(["a-id", "international", "z-id"]);
  });

  it("replaces the same ledger date, writes fingerprint details, sorts, and keeps seven days", () => {
    let ledger = appendLedgerDay(emptyLedger, "2026-07-23", [candidate("first", "sweden", "culture", "svt")]);
    ledger = appendLedgerDay(ledger, "2026-07-23", [candidate("replacement", "international", "sports", "dn")]);
    for (let day = 16; day <= 22; day += 1) {
      ledger = appendLedgerDay(ledger, `2026-07-${day}`, [candidate(`day-${day}`, "sweden", "daily-life", "svt")]);
    }
    expect(ledger.days).toHaveLength(7);
    expect(ledger.days.map((day) => day.date)).toEqual([
      "2026-07-17", "2026-07-18", "2026-07-19", "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23",
    ]);
    const replaced = ledger.days.at(-1)!;
    expect(replaced.eventFingerprints).toEqual(["replacement"]);
    expect(replaced.eventDetails).toEqual([candidate("replacement", "international", "sports", "dn").fingerprint]);
    expect(() => EditorialLedgerSchema.parse(ledger)).not.toThrow();
  });
});
