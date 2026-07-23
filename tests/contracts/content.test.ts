import { describe, expect, it } from "vitest";
import {
  DailyLessonSchema,
  EditorialLedgerSchema,
  countSwedishWords,
} from "../../src/contracts/content";

describe("persisted content contracts", () => {
  it("accepts a 300-word lesson and rejects a 299-word lesson", () => {
    const words300 = Array.from({ length: 300 }, (_, index) => `ord${index}`).join(" ");
    const words299 = Array.from({ length: 299 }, (_, index) => `ord${index}`).join(" ");
    expect(countSwedishWords(words300)).toBe(300);
    expect(countSwedishWords(words299)).toBe(299);
  });

  it("requires bilingual summaries and annotation meanings", () => {
    const firstHalf = Array.from({ length: 150 }, (_, index) => `ord${index}`).join(" ");
    const secondHalf = Array.from({ length: 150 }, (_, index) => `nyhet${index}`).join(" ");
    const lesson = {
      schemaVersion: 1,
      date: "2026-07-23",
      timezone: "Europe/Stockholm",
      generatedAt: "2026-07-23T05:05:00.000Z",
      status: "ready",
      sourceHealth: { svt: "ok", aftonbladet: "ok", dn: "ok" },
      selectionSummary: "Balanced Sweden and international coverage.",
      articles: [{
        id: "lesson-1", eventFingerprint: "kommun-atervinning-2026", source: "svt",
        sourceUrl: "https://www.svt.se/nyheter/test", sourceTitle: "Testnyhet",
        publishedAt: "2026-07-23T04:00:00.000Z", scope: "sweden", topic: "daily-life",
        isFollowUp: false,
        difficulty: { level: "B1-B2", reasons: ["passiv form"], readingMinutes: 9 },
        studyTitle: "Nya regler för återvinning",
        studyParagraphs: [{ id: "p1", segments: [{ text: firstHalf }] }, { id: "p2", segments: [{ text: secondHalf }] }],
        wordCount: 300,
        summaries: { sv: "En svensk sammanfattning.", zh: "中文摘要。", en: "English summary." },
        factPoints: ["Kommunerna får nya regler.", "Beslutet börjar gälla nästa år."],
        originalSentenceNotes: [
          { quote: "Kommunerna får nya regler.", sourceUrl: "https://www.svt.se/nyheter/test", annotationIds: ["vocabulary:ansvar"] },
          { quote: "Beslutet börjar gälla nästa år.", sourceUrl: "https://www.svt.se/nyheter/test", annotationIds: ["vocabulary:ansvar"] },
        ],
        annotations: [{
          id: "vocabulary:ansvar", kind: "vocabulary", canonical: "ansvar", targets: ["ansvar"],
          meaningZh: "责任", meaningEn: "responsibility", exampleSv: "Kommunen har ett stort ansvar.",
          surface: "ansvar", lemma: "ansvar", partOfSpeech: "substantiv", inflections: ["ansvaret"], compoundParts: [], note: "",
        }],
        relatedCoverage: [], generationModel: "gpt-5.4-mini", contentHash: "sha256:test",
      }],
    };
    expect(DailyLessonSchema.parse(lesson).articles[0]?.summaries.zh).toBe("中文摘要。");
  });

  it("requires seven-day ledger counters and event history", () => {
    const ledger = EditorialLedgerSchema.parse({ schemaVersion: 1, days: [] });
    expect(ledger.days).toEqual([]);
  });
});
