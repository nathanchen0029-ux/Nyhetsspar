import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DailyLessonSchema,
  LessonIndexSchema,
  type DailyLesson,
  type LessonArticle,
  type LessonIndex,
} from "../../src/contracts/content";
import { LessonRepository } from "../../src/web/data/repository";

const lessonPath = "data/lessons/2026-07-23-0123456789abcdef.json";
const indexPayload = {
  schemaVersion: 1,
  dates: [
    {
      date: "2026-07-23",
      status: "delayed",
      lessonPath,
      articles: [],
    },
  ],
};
const lessonPayload = {
  schemaVersion: 1,
  date: "2026-07-23",
  timezone: "Europe/Stockholm",
  generatedAt: "2026-07-23T05:05:00.000Z",
  status: "delayed",
  sourceHealth: { svt: "ok", aftonbladet: "partial", dn: "failed" },
  selectionSummary: "No balanced issue was available.",
  articles: [],
};

function lessonArticle(
  id: string,
  source: LessonArticle["source"],
  scope: LessonArticle["scope"],
): LessonArticle {
  const sourceUrl = `https://www.${source}.se/${id}`;
  const paragraph = (prefix: string) =>
    Array.from({ length: 150 }, (_, index) => `${prefix}${index + 1}`).join(" ");
  return {
    id,
    eventFingerprint: `event-${id}`,
    source,
    sourceUrl,
    sourceTitle: `Source ${id}`,
    publishedAt: "2026-07-23T04:00:00.000Z",
    scope,
    topic: scope === "international" ? "politics" : "economy",
    isFollowUp: false,
    difficulty: { level: "B2", reasons: ["新闻语言"], readingMinutes: 4 },
    studyTitle: `Study ${id}`,
    studyParagraphs: [
      { id: `${id}-p1`, segments: [{ text: paragraph("svensk") }] },
      { id: `${id}-p2`, segments: [{ text: paragraph("nyhet") }] },
    ],
    wordCount: 300,
    summaries: { sv: `Svenska ${id}`, zh: `中文 ${id}`, en: `English ${id}` },
    factPoints: [`Fakta ett ${id}`, `Fakta två ${id}`],
    originalSentenceNotes: [
      { quote: "Det här är en mening.", sourceUrl, annotationIds: [`${id}-a1`] },
      { quote: "Det här är en annan mening.", sourceUrl, annotationIds: [`${id}-a2`] },
    ],
    annotations: [],
    relatedCoverage: [],
    generationModel: "test-model",
    contentHash: `hash-${id}`,
  };
}

const readyLesson = DailyLessonSchema.parse({
  ...lessonPayload,
  status: "ready",
  selectionSummary: "Balanced.",
  articles: [
    lessonArticle("domestic", "svt", "sweden"),
    lessonArticle("world", "dn", "international"),
  ],
});

function indexEntryFor(
  lesson: DailyLesson,
): LessonIndex["dates"][number] {
  return LessonIndexSchema.parse({
    schemaVersion: 1,
    dates: [
      {
        date: lesson.date,
        status: lesson.status,
        lessonPath,
        articles: lesson.articles.map((article) => ({
          id: article.id,
          title: article.studyTitle,
          source: article.source,
          scope: article.scope,
          topic: article.topic,
          difficulty: article.difficulty.level,
          isFollowUp: article.isFollowUp,
        })),
      },
    ],
  }).dates[0]!;
}

function mockLesson(payload: DailyLesson): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(payload)),
  );
}

describe("LessonRepository", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the exact content-hashed lesson path from the parsed index entry", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(indexPayload)))
      .mockResolvedValueOnce(new Response(JSON.stringify(lessonPayload)));
    const repository = new LessonRepository();

    const index = await repository.loadIndex();
    const lesson = await repository.loadLesson(index.dates[0]!);

    expect(lesson.date).toBe("2026-07-23");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/data/index.json",
      `/${lessonPath}`,
    ]);
  });

  it("rejects non-successful data responses before parsing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("missing", { status: 404 }),
    );

    await expect(new LessonRepository().loadIndex()).rejects.toThrow(
      "data-http-404:data/index.json",
    );
  });

  it("rejects a lesson whose date differs from its index entry", async () => {
    const entry = LessonIndexSchema.parse(indexPayload).dates[0]!;
    const wrongDate = DailyLessonSchema.parse({
      ...lessonPayload,
      date: "2026-07-24",
    });
    mockLesson(wrongDate);

    await expect(new LessonRepository().loadLesson(entry)).rejects.toThrow(
      "lesson-index-mismatch",
    );
  });

  it("rejects a lesson whose status differs from its index entry", async () => {
    const readyEntry = indexEntryFor(readyLesson);
    mockLesson(DailyLessonSchema.parse(lessonPayload));

    await expect(
      new LessonRepository().loadLesson(readyEntry),
    ).rejects.toThrow("lesson-index-mismatch");
  });

  it("rejects article card metadata that differs from the lesson projection", async () => {
    const entry = indexEntryFor(readyLesson);
    const mismatched = LessonIndexSchema.parse({
      schemaVersion: 1,
      dates: [
        {
          ...entry,
          articles: entry.articles.map((article, index) =>
            index === 0 ? { ...article, title: "Wrong title" } : article,
          ),
        },
      ],
    }).dates[0]!;
    mockLesson(readyLesson);

    await expect(
      new LessonRepository().loadLesson(mismatched),
    ).rejects.toThrow("lesson-index-mismatch");
  });

  it("rejects an article count that differs from the indexed projection", async () => {
    const third = lessonArticle("culture", "aftonbladet", "sweden");
    const threeArticleLesson = DailyLessonSchema.parse({
      ...readyLesson,
      articles: [...readyLesson.articles, third],
    });
    const twoArticleEntry = indexEntryFor(readyLesson);
    mockLesson(threeArticleLesson);

    await expect(
      new LessonRepository().loadLesson(twoArticleEntry),
    ).rejects.toThrow("lesson-index-mismatch");
  });

  it("rejects article projections in a different order", async () => {
    const entry = indexEntryFor(readyLesson);
    const reversed = LessonIndexSchema.parse({
      schemaVersion: 1,
      dates: [{ ...entry, articles: [...entry.articles].reverse() }],
    }).dates[0]!;
    mockLesson(readyLesson);

    await expect(
      new LessonRepository().loadLesson(reversed),
    ).rejects.toThrow("lesson-index-mismatch");
  });
});
