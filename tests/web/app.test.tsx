import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DailyLessonSchema,
  type Annotation,
  type LessonArticle,
} from "../../src/contracts/content";
import { App } from "../../src/web/App";
import { createKnownStore } from "../../src/web/storage/known";

const lessonPath = "data/lessons/2026-07-23-fedcba9876543210.json";
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
  sourceHealth: { svt: "partial", aftonbladet: "partial", dn: "partial" },
  selectionSummary: "Waiting for balanced coverage.",
  articles: [],
};

const routeAnnotation: Annotation = {
  id: "vocabulary:route:regering",
  kind: "vocabulary",
  canonical: "regering",
  targets: ["Regeringen"],
  meaningZh: "政府",
  meaningEn: "government",
  exampleSv: "Regeringen presenterar ett förslag.",
  surface: "Regeringen",
  lemma: "regering",
  partOfSpeech: "substantiv",
  inflections: ["regeringen"],
  compoundParts: [],
  note: "",
};

function routeArticle(
  id: string,
  scope: LessonArticle["scope"],
  source: LessonArticle["source"],
): LessonArticle {
  const sourceUrl = `https://www.${source}.se/nyheter/${id}`;
  const words = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join(
      " ",
    );
  const firstAnnotation =
    id === "domestic"
      ? { ...routeAnnotation, id: `vocabulary:${id}:regering` }
      : undefined;
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
      {
        id: `${id}-p1`,
        segments: firstAnnotation
          ? [
              { text: "Regeringen", annotationId: firstAnnotation.id },
              { text: ` ${words("svensk", 149)}` },
            ]
          : [{ text: words("svensk", 150) }],
      },
      { id: `${id}-p2`, segments: [{ text: words("nyhet", 150) }] },
    ],
    wordCount: 300,
    summaries: {
      sv: `Sammanfattning ${id}`,
      zh: `中文摘要 ${id}`,
      en: `English ${id}`,
    },
    factPoints: [`Faktum ett ${id}`, `Faktum två ${id}`],
    originalSentenceNotes: [
      {
        quote: "Det här är en kort mening.",
        sourceUrl,
        annotationIds: firstAnnotation ? [firstAnnotation.id] : [`note:${id}`],
      },
      {
        quote: "Nyheten publicerades på morgonen.",
        sourceUrl,
        annotationIds: firstAnnotation ? [firstAnnotation.id] : [`note:${id}`],
      },
    ],
    annotations: firstAnnotation ? [firstAnnotation] : [],
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
    routeArticle("domestic", "sweden", "svt"),
    routeArticle("world", "international", "dn"),
  ],
});

const readyIndex = {
  schemaVersion: 1,
  dates: [
    {
      date: readyLesson.date,
      status: readyLesson.status,
      lessonPath,
      articles: readyLesson.articles.map((article) => ({
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
};

function mockDataRequests() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(JSON.stringify(indexPayload)))
    .mockResolvedValueOnce(new Response(JSON.stringify(lessonPayload)));
}

describe("App", () => {
  afterEach(() => {
    window.location.hash = "";
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("loads and renders the latest indexed lesson", async () => {
    mockDataRequests();
    render(<App />);

    expect(screen.getByText("正在加载课程…")).toBeVisible();
    expect(
      await screen.findByRole("heading", { name: /Dagens lektion/i }),
    ).toBeVisible();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(`/${lessonPath}`);
  });

  it("provides shell navigation to the history route", async () => {
    const user = userEvent.setup();
    mockDataRequests();
    render(<App />);
    await screen.findByRole("heading", { name: /Dagens lektion/i });

    await user.click(screen.getByRole("link", { name: "历史" }));

    expect(screen.getByRole("heading", { name: "历史课程" })).toBeVisible();
    expect(window.location.hash).toBe("#/history");
  });

  it("navigates to known-item management through the shared store", async () => {
    createKnownStore(localStorage).mark({
      kind: "vocabulary",
      canonical: "regering",
      original: "regeringen",
      meaningZh: "政府",
      meaningEn: "government",
      markedAt: "2026-07-23T05:00:00.000Z",
    });
    const user = userEvent.setup();
    mockDataRequests();
    render(<App />);
    await screen.findByRole("heading", { name: /Dagens lektion/i });

    await user.click(screen.getByRole("link", { name: "已掌握" }));

    expect(
      screen.getByRole("heading", { name: "我的已掌握内容" }),
    ).toBeVisible();
    expect(screen.getByText("regering")).toBeVisible();
    expect(window.location.hash).toBe("#/known");
  });

  it("keeps the loading state until the indexed lesson is ready", async () => {
    let resolveLesson!: (response: Response) => void;
    const lessonResponse = new Promise<Response>((resolve) => {
      resolveLesson = resolve;
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(indexPayload)))
      .mockReturnValueOnce(lessonResponse);

    render(<App />);
    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(`/${lessonPath}`),
    );

    expect(screen.getByText("正在加载课程…")).toBeVisible();
    expect(screen.queryByText("还没有课程。")).not.toBeInTheDocument();

    resolveLesson(new Response(JSON.stringify(lessonPayload)));
    expect(
      await screen.findByRole("heading", { name: /Dagens lektion/i }),
    ).toBeVisible();
  });

  it("loads a lesson route through the exact indexed path and reconciles it", async () => {
    window.location.hash = "#/lesson/2026-07-23/domestic";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === "/data/index.json") {
          return new Response(JSON.stringify(readyIndex));
        }
        if (url === `/${lessonPath}`) {
          return new Response(JSON.stringify(readyLesson));
        }
        return new Response("missing", { status: 404 });
      });

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Study domestic" }),
    ).toBeVisible();
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === `/${lessonPath}`),
    ).toHaveLength(2);
  });

  it("uses persistent known state and surfaces completion after returning Today", async () => {
    createKnownStore(localStorage).mark({
      kind: "vocabulary",
      canonical: "REGERING",
      original: "regeringen",
      meaningZh: "政府",
      meaningEn: "government",
      markedAt: "2026-07-23T05:00:00.000Z",
    });
    window.location.hash = "#/lesson/2026-07-23/domestic";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      return new Response(
        JSON.stringify(
          url === "/data/index.json"
            ? readyIndex
            : url === `/${lessonPath}`
              ? readyLesson
              : {},
        ),
        url === "/data/index.json" || url === `/${lessonPath}`
          ? undefined
          : { status: 404 },
      );
    });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("heading", { name: "Study domestic" });
    expect(
      screen.queryByRole("button", { name: "Regeringen" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Regeringen").length).toBeGreaterThan(0);

    await user.click(
      screen.getByRole("button", { name: "标记为已完成" }),
    );
    await user.click(screen.getByRole("link", { name: "返回今日课程" }));

    expect(
      await screen.findByText("2 篇新闻，已完成 1 篇"),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "复习" })).toBeVisible();
  });
});
