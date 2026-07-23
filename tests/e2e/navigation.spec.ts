import { expect, test, type Page } from "@playwright/test";

const lessonPath = "data/lessons/2026-07-23-0123456789abcdef.json";

function studyWords(prefix: string): string {
  return Array.from(
    { length: 150 },
    (_, index) => `${prefix}${index + 1}`,
  ).join(" ");
}

function lessonArticle(
  id: string,
  source: "svt" | "dn",
  scope: "sweden" | "international",
) {
  const sourceUrl =
    source === "svt"
      ? `https://www.svt.se/nyheter/${id}`
      : `https://www.dn.se/varlden/${id}`;
  return {
    id,
    eventFingerprint: `event-${id}`,
    source,
    sourceUrl,
    sourceTitle: `Original ${id}`,
    publishedAt: "2026-07-23T04:00:00.000Z",
    scope,
    topic: "politics",
    isFollowUp: false,
    difficulty: {
      level: "B2",
      reasons: ["Långa nyhetsmeningar"],
      readingMinutes: 4,
    },
    studyTitle: `Svensk nyhetslektion ${id}`,
    studyParagraphs: [
      {
        id: `${id}-p1`,
        segments: [{ text: studyWords("nyhet") }],
      },
      {
        id: `${id}-p2`,
        segments: [{ text: studyWords("språk") }],
      },
    ],
    wordCount: 300,
    summaries: {
      sv: "En kort svensk sammanfattning.",
      zh: "简短中文摘要。",
      en: "A short English summary.",
    },
    factPoints: ["Första faktapunkten.", "Andra faktapunkten."],
    originalSentenceNotes: [
      {
        quote: "Det här är en kort mening.",
        sourceUrl,
        annotationIds: [`note:${id}:one`],
      },
      {
        quote: "Nyheten publicerades på morgonen.",
        sourceUrl,
        annotationIds: [`note:${id}:two`],
      },
    ],
    annotations: [],
    relatedCoverage: [],
    generationModel: "test-model",
    contentHash: `hash-${id}`,
  };
}

const articles = [
  lessonArticle("domestic", "svt", "sweden"),
  lessonArticle("world", "dn", "international"),
];

const readyLesson = {
  schemaVersion: 1,
  date: "2026-07-23",
  timezone: "Europe/Stockholm",
  generatedAt: "2026-07-23T05:07:00.000Z",
  status: "ready",
  sourceHealth: { svt: "ok", aftonbladet: "partial", dn: "ok" },
  selectionSummary: "Balanced test issue.",
  articles,
};

const readyIndex = {
  schemaVersion: 1,
  dates: [
    {
      date: readyLesson.date,
      status: readyLesson.status,
      lessonPath,
      articles: articles.map((article) => ({
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

async function mockReadyLesson(page: Page): Promise<void> {
  await page.route("**/data/index.json", (route) =>
    route.fulfill({ json: readyIndex }),
  );
  await page.route("**/data/lessons/*.json", (route) =>
    route.fulfill({ json: readyLesson }),
  );
}

test("history and known pages remain reachable from primary navigation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "历史" }).click();
  await expect(page.getByRole("heading", { name: "历史课程" })).toBeVisible();
  await page.getByRole("link", { name: "已掌握" }).click();
  await expect(
    page.getByRole("heading", { name: "我的已掌握内容" }),
  ).toBeVisible();
});

test("the empty production index renders a clear fallback", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("还没有课程。", { exact: true })).toBeVisible();
});

test("external source links use a safe new browsing context", async ({
  page,
}) => {
  await mockReadyLesson(page);
  await page.goto("/");
  await page.getByRole("link", { name: "开始阅读" }).first().click();

  const sourceLink = page.getByRole("link", { name: "阅读完整原文" });
  await expect(sourceLink).toHaveAttribute("target", "_blank");
  await expect(sourceLink).toHaveAttribute("rel", /noopener/u);
  await expect(sourceLink).toHaveAttribute("href", /^https:\/\/www\.svt\.se\//u);
});
