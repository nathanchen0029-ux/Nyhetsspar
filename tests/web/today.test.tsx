import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import {
  DailyLessonSchema,
  type DailyLesson,
  type LessonArticle,
} from "../../src/contracts/content";
import { TodayPage } from "../../src/web/pages/TodayPage";

function studyWords(prefix: string): string {
  return Array.from({ length: 150 }, (_, index) => `${prefix}${index + 1}`).join(" ");
}

function article(
  id: string,
  scope: LessonArticle["scope"],
  source: LessonArticle["source"],
): LessonArticle {
  const sourceUrl = `https://www.${source === "aftonbladet" ? "aftonbladet" : source}.se/${id}`;
  return {
    id,
    eventFingerprint: `event-${id}`,
    source,
    sourceUrl,
    sourceTitle: `Original ${id}`,
    publishedAt: "2026-07-23T04:00:00.000Z",
    scope,
    topic: scope === "international" ? "politics" : "daily-life",
    isFollowUp: false,
    difficulty: { level: "B2", reasons: ["新闻词汇"], readingMinutes: 4 },
    studyTitle: `Study ${id}`,
    studyParagraphs: [
      { id: `${id}-p1`, segments: [{ text: studyWords("svensk") }] },
      { id: `${id}-p2`, segments: [{ text: studyWords("nyhet") }] },
    ],
    wordCount: 300,
    summaries: { sv: `Sammanfattning ${id}`, zh: `中文摘要 ${id}`, en: `English ${id}` },
    factPoints: [`Faktum ett ${id}`, `Faktum två ${id}`],
    originalSentenceNotes: [
      { quote: "Det här är en kort mening.", sourceUrl, annotationIds: [`${id}-a1`] },
      { quote: "Nyheten publicerades på morgonen.", sourceUrl, annotationIds: [`${id}-a2`] },
    ],
    annotations: [],
    relatedCoverage: [],
    generationModel: "test-model",
    contentHash: `hash-${id}`,
  };
}

const delayedLesson = DailyLessonSchema.parse({
  schemaVersion: 1,
  date: "2026-07-23",
  timezone: "Europe/Stockholm",
  generatedAt: "2026-07-23T05:05:00.000Z",
  status: "delayed",
  sourceHealth: { svt: "ok", aftonbladet: "partial", dn: "failed" },
  selectionSummary: "Waiting for balanced coverage.",
  articles: [],
});

const readyLesson = DailyLessonSchema.parse({
  ...delayedLesson,
  status: "ready",
  selectionSummary: "Balanced.",
  articles: [
    article("domestic", "sweden", "svt"),
    article("world", "international", "dn"),
  ],
});

function renderToday(lesson: DailyLesson, completedIds = new Set<string>()) {
  return render(
    <MemoryRouter>
      <TodayPage lesson={lesson} completedIds={completedIds} />
    </MemoryRouter>,
  );
}

describe("TodayPage", () => {
  it("renders a schema-valid delayed lesson as an accessible empty state", () => {
    renderToday(delayedLesson);

    expect(screen.getByRole("heading", { name: /dagens lektion/i })).toBeVisible();
    expect(screen.getByText(/课程正在准备/i)).toBeVisible();
    expect(screen.getByText(/生成延迟/i)).toBeVisible();
  });

  it("renders each ready lesson article and its completion action", () => {
    renderToday(readyLesson, new Set(["domestic"]));

    expect(screen.getByRole("heading", { name: "Study domestic" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Study world" })).toBeVisible();
    expect(screen.getByRole("link", { name: "复习" })).toHaveAttribute(
      "href",
      "/lesson/2026-07-23/domestic",
    );
    expect(screen.getByRole("link", { name: "开始阅读" })).toHaveAttribute(
      "href",
      "/lesson/2026-07-23/world",
    );
    expect(screen.getByText("2 篇新闻，已完成 1 篇")).toBeVisible();
  });
});
