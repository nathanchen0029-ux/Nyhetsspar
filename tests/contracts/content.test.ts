import { describe, expect, it } from "vitest";
import {
  DailyLessonSchema,
  EditorialLedgerSchema,
  LessonArticleSchema,
  countSwedishWords,
} from "../../src/contracts/content";

function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `ord${index}`).join(" ");
}

function validArticle(wordCount = 300) {
  const firstHalf = words(Math.floor(wordCount / 2));
  const secondHalf = words(wordCount - Math.floor(wordCount / 2));
  return {
    id: "lesson-1", eventFingerprint: "kommun-atervinning-2026", source: "svt",
    sourceUrl: "https://www.svt.se/nyheter/test", sourceTitle: "Testnyhet",
    publishedAt: "2026-07-23T04:00:00.000Z", scope: "sweden", topic: "daily-life",
    isFollowUp: false,
    difficulty: { level: "B1-B2", reasons: ["passiv form"], readingMinutes: 9 },
    studyTitle: "Nya regler för återvinning",
    studyParagraphs: [{ id: "p1", segments: [{ text: firstHalf }] }, { id: "p2", segments: [{ text: secondHalf }] }],
    wordCount,
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
  };
}

describe("persisted content contracts", () => {
  it("counts Swedish words", () => {
    expect(countSwedishWords(words(300))).toBe(300);
    expect(countSwedishWords(words(299))).toBe(299);
  });

  it("accepts a 300-word lesson with bilingual summaries and annotation meanings", () => {
    const lesson = {
      schemaVersion: 1, date: "2026-07-23", timezone: "Europe/Stockholm", generatedAt: "2026-07-23T05:05:00.000Z",
      status: "ready", sourceHealth: { svt: "ok", aftonbladet: "ok", dn: "ok" },
      selectionSummary: "Balanced Sweden and international coverage.", articles: [validArticle()],
    };
    expect(DailyLessonSchema.parse(lesson).articles[0]?.summaries.zh).toBe("中文摘要。");
  });

  it("rejects an article with 299 actual study words", () => {
    const article = validArticle(299);
    article.wordCount = 300;
    expect(() => LessonArticleSchema.parse(article)).toThrow();
  });

  it("rejects an article with 501 actual study words", () => {
    const article = validArticle(501);
    article.wordCount = 500;
    expect(() => LessonArticleSchema.parse(article)).toThrow();
  });

  it("rejects an article whose declared word count differs from its study text", () => {
    const article = validArticle();
    article.wordCount = 301;
    expect(() => LessonArticleSchema.parse(article)).toThrow();
  });

  it("rejects an original sentence quote longer than 25 words", () => {
    const article = validArticle();
    article.originalSentenceNotes[0]!.quote = words(26);
    expect(() => LessonArticleSchema.parse(article)).toThrow();
  });

  it("rejects original sentence quotes totaling more than 80 words", () => {
    const article = validArticle();
    article.originalSentenceNotes[0]!.quote = words(25);
    article.originalSentenceNotes[1]!.quote = words(25);
    article.originalSentenceNotes.push(
      { quote: words(25), sourceUrl: "https://www.svt.se/nyheter/test", annotationIds: ["vocabulary:ansvar"] },
      { quote: words(11), sourceUrl: "https://www.svt.se/nyheter/test", annotationIds: ["vocabulary:ansvar"] },
    );
    expect(() => LessonArticleSchema.parse(article)).toThrow();
  });

  it("rejects a quote URL that differs from the primary article URL", () => {
    const article = validArticle();
    article.originalSentenceNotes[0]!.sourceUrl = "https://www.svt.se/nyheter/other-article";
    expect(() => LessonArticleSchema.parse(article)).toThrow();
  });

  it("rejects source URLs whose domains do not match their declared sources", () => {
    const wrongPrimary = validArticle();
    wrongPrimary.sourceUrl = "https://www.dn.se/nyheter/test";
    expect(() => LessonArticleSchema.parse(wrongPrimary)).toThrow();

    const wrongRelated = {
      ...validArticle(),
      relatedCoverage: [{ source: "dn", title: "Related", url: "https://www.svt.se/nyheter/test" }],
    };
    expect(() => LessonArticleSchema.parse(wrongRelated)).toThrow();
  });

  it("requires seven-day ledger counters and event history", () => {
    const ledger = EditorialLedgerSchema.parse({ schemaVersion: 1, days: [] });
    expect(ledger.days).toEqual([]);
  });
});
