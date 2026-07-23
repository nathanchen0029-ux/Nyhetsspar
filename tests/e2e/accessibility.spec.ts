import { expect, test, type Page } from "@playwright/test";

const lessonPath = "data/lessons/2026-07-23-fedcba9876543210.json";

function rgbChannels(color: string): [number, number, number] {
  const hex = color.match(/^#([\da-f]{6})$/iu)?.[1];
  if (hex) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }
  const channels = color.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/iu);
  if (!channels) {
    throw new Error(`unsupported-color:${color}`);
  }
  return [
    Number(channels[1]),
    Number(channels[2]),
    Number(channels[3]),
  ];
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const linearize = (channel: number) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const [red, green, blue] = rgbChannels(color);
    return (
      0.2126 * linearize(red) +
      0.7152 * linearize(green) +
      0.0722 * linearize(blue)
    );
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function words(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join(
    " ",
  );
}

const annotations = [
  {
    id: "vocabulary:domestic:regering",
    kind: "vocabulary",
    canonical: "regering",
    targets: ["Regeringen"],
    meaningZh: "政府",
    meaningEn: "government",
    exampleSv: "Regeringen presenterar ett förslag.",
    surface: "Regeringen",
    lemma: "regering",
    partOfSpeech: "substantiv",
    inflections: ["regeringen", "regeringar"],
    compoundParts: [],
    note: "Bestämd form.",
  },
  {
    id: "phrase:domestic:satter-igang",
    kind: "phrase",
    canonical: "sätta igång",
    targets: ["sätter igång"],
    meaningZh: "开始、启动",
    meaningEn: "to start or set in motion",
    exampleSv: "Kommunen sätter igång arbetet.",
    sourceForm: "sätter igång",
    canonicalForm: "sätta igång",
    verbForms: ["sätter", "satte", "satt"],
    usage: "常见于描述措施或项目启动。",
  },
  {
    id: "grammar:domestic:trots-att",
    kind: "grammar",
    canonical: "trots att",
    targets: ["trots att"],
    meaningZh: "尽管",
    meaningEn: "although / despite the fact that",
    exampleSv: "Arbetet fortsätter trots att det regnar.",
    grammarId: "subjunction-trots-att",
    sourceFragment: "trots att",
    nameZh: "让步从句",
    nameEn: "concessive clause",
    explanationZh: "trots att 引导与主句形成让步关系的从句。",
    explanationEn:
      "trots att introduces a subordinate clause that contrasts with the main clause.",
  },
] as const;

function article(
  id: string,
  source: "svt" | "dn",
  scope: "sweden" | "international",
) {
  const sourceUrl =
    source === "svt"
      ? `https://www.svt.se/nyheter/${id}`
      : `https://www.dn.se/varlden/${id}`;
  const domestic = id === "domestic";
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
      reasons: ["Nyhetsord och långa meningar"],
      readingMinutes: 4,
    },
    studyTitle: domestic
      ? "Regeringen startar ett nytt arbete"
      : `Världsläget-${"mycketlångt".repeat(18)}`,
    studyParagraphs: domestic
      ? [
          {
            id: `${id}-p1`,
            segments: [
              {
                text: "Regeringen",
                annotationId: annotations[0].id,
              },
              {
                text: " sätter igång",
                annotationId: annotations[1].id,
              },
              {
                text: " trots att",
                annotationId: annotations[2].id,
              },
              { text: ` ${words("svensk", 145)}` },
            ],
          },
          {
            id: `${id}-p2`,
            segments: [{ text: words("nyhet", 150) }],
          },
        ]
      : [
          {
            id: `${id}-p1`,
            segments: [{ text: words("varld", 150) }],
          },
          {
            id: `${id}-p2`,
            segments: [{ text: words("rapport", 150) }],
          },
        ],
    wordCount: 300,
    summaries: {
      sv: `En svensk sammanfattning om ${id}.`,
      zh: `${id} 的中文摘要。`,
      en: `An English summary about ${id}.`,
    },
    factPoints: [`Faktum ett ${id}.`, `Faktum två ${id}.`],
    originalSentenceNotes: [
      {
        quote: domestic
          ? "Regeringen sätter igång arbetet trots att tiden är knapp."
          : "Ledarna möttes på torsdagen.",
        sourceUrl,
        annotationIds: domestic
          ? [annotations[0].id, annotations[1].id, annotations[2].id]
          : [`note:${id}:one`],
      },
      {
        quote: "Nyheten publicerades på morgonen.",
        sourceUrl,
        annotationIds: domestic ? [annotations[0].id] : [`note:${id}:two`],
      },
    ],
    annotations: domestic ? annotations : [],
    relatedCoverage: domestic
      ? [
          {
            source: "dn",
            title: "DN följer regeringens besked",
            url: "https://www.dn.se/sverige/regeringens-besked",
          },
        ]
      : [],
    generationModel: "test-model",
    contentHash: `hash-${id}`,
  };
}

const readyLesson = {
  schemaVersion: 1,
  date: "2026-07-23",
  timezone: "Europe/Stockholm",
  generatedAt: "2026-07-23T05:05:00.000Z",
  status: "ready",
  sourceHealth: { svt: "ok", aftonbladet: "partial", dn: "ok" },
  selectionSummary: "Balanced.",
  articles: [
    article("domestic", "svt", "sweden"),
    article("world", "dn", "international"),
  ],
};

const readyIndex = {
  schemaVersion: 1,
  dates: [
    {
      date: readyLesson.date,
      status: readyLesson.status,
      lessonPath,
      articles: readyLesson.articles.map((item) => ({
        id: item.id,
        title: item.studyTitle,
        source: item.source,
        scope: item.scope,
        topic: item.topic,
        difficulty: item.difficulty.level,
        isFollowUp: item.isFollowUp,
      })),
    },
  ],
};

async function mockReadyIssue(page: Page): Promise<void> {
  await page.route("**/data/index.json", (route) =>
    route.fulfill({ json: readyIndex }),
  );
  await page.route("**/data/lessons/*.json", (route) =>
    route.fulfill({ json: readyLesson }),
  );
}

async function openReader(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("link", { name: "开始阅读" }).first().click();
  await expect(page).toHaveURL(/#\/lesson\/2026-07-23\/domestic$/u);
  await expect(
    page.locator(".lesson-page h1").filter({
      hasText: "Regeringen startar ett nytt arbete",
    }),
  ).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await mockReadyIssue(page);
});

test("daily issue and reader never overflow horizontally", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(page.getByRole("link", { name: "今日课程" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);

  await openReader(page);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
});

test("approved editorial tokens and learner markings are active", async ({
  page,
}) => {
  await openReader(page);

  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      paper: style.getPropertyValue("--paper").trim(),
      green: style.getPropertyValue("--green").trim(),
      word: style.getPropertyValue("--word").trim(),
      phrase: style.getPropertyValue("--phrase").trim(),
      grammar: style.getPropertyValue("--grammar").trim(),
    };
  });
  expect(tokens).toEqual({
    paper: "#fbfcf9",
    green: "#1f6247",
    word: "#f2d66e",
    phrase: "#6399aa",
    grammar: "#a66d91",
  });

  await expect(page.getByRole("list", { name: "标注图例" })).toContainText(
    "词汇",
  );
  await expect(page.getByRole("list", { name: "标注图例" })).toContainText(
    "词组",
  );
  await expect(page.getByRole("list", { name: "标注图例" })).toContainText(
    "语法",
  );

  const patterns = await page.evaluate(() => {
    const styleFor = (selector: string) =>
      getComputedStyle(document.querySelector(selector) as HTMLElement);
    return {
      vocabulary: styleFor(".annotation--vocabulary").backgroundImage,
      phrase: styleFor(".annotation--phrase").borderBottomStyle,
      grammar: styleFor(".annotation--grammar").borderBottomStyle,
    };
  });
  expect(patterns.vocabulary).toContain("gradient");
  expect(patterns.phrase).toBe("solid");
  expect(["dashed", "double"]).toContain(patterns.grammar);
});

test("annotation rail is sticky on desktop and stacked without nested scroll on smaller screens", async ({
  page,
}) => {
  await openReader(page);

  const viewportWidth = page.viewportSize()?.width ?? 0;
  const layout = await page.evaluate(() => {
    const text = document.querySelector(".study-text") as HTMLElement;
    const rail = document.querySelector(".annotation-rail") as HTMLElement;
    const textBox = text.getBoundingClientRect();
    const railBox = rail.getBoundingClientRect();
    const style = getComputedStyle(rail);
    return {
      textRight: textBox.right,
      textBottom: textBox.bottom,
      railLeft: railBox.left,
      railTop: railBox.top,
      position: style.position,
      overflowY: style.overflowY,
    };
  });

  expect(layout.overflowY).toBe("visible");
  if (viewportWidth > 900) {
    expect(layout.position).toBe("sticky");
    expect(layout.railLeft).toBeGreaterThan(layout.textRight);
  } else {
    expect(layout.position).toBe("static");
    expect(layout.railTop).toBeGreaterThan(layout.textBottom);
  }
});

test("skip link, active navigation, and annotations are keyboard reachable", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "跳到主要内容" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();

  await openReader(page);
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  let reachedAnnotation = false;
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab");
    reachedAnnotation = await page.evaluate(() =>
      document.activeElement?.classList.contains("annotation") ?? false,
    );
    if (reachedAnnotation) {
      break;
    }
  }
  expect(reachedAnnotation).toBe(true);

  const focusOutline = await page.evaluate(
    () => getComputedStyle(document.activeElement as HTMLElement).outlineStyle,
  );
  expect(focusOutline).not.toBe("none");
});

test("primary controls meet touch size and reduced motion removes transitions", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const controls = [
    page.getByRole("link", { name: "今日课程" }),
    page.getByRole("link", { name: "开始阅读" }).first(),
  ];
  for (const control of controls) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  }

  const cardTransition = await page
    .locator(".article-card")
    .first()
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(cardTransition).toBe("0s");
});

test("focus ring and control boundaries meet non-text contrast", async ({
  page,
}) => {
  await openReader(page);
  const primarySource = page.getByRole("link", { name: "阅读完整原文" });
  await primarySource.focus();

  const colors = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const sourceLink = document.activeElement as HTMLElement;
    const button = document.querySelector(
      ".lesson-reader button:not(.annotation)",
    ) as HTMLElement;
    return {
      focusToken: root.getPropertyValue("--focus-ring").trim(),
      controlToken: root.getPropertyValue("--control-border").trim(),
      paper: root.getPropertyValue("--paper").trim(),
      field: root.getPropertyValue("--field").trim(),
      surface: root.getPropertyValue("--surface").trim(),
      actualOutline: getComputedStyle(sourceLink).outlineColor,
      actualButtonBorder: getComputedStyle(button).borderTopColor,
      actualDetailsBorder: getComputedStyle(
        document.querySelector(".summary-panel") as HTMLElement,
      ).borderTopColor,
    };
  });

  expect(colors.focusToken).toMatch(/^#[\da-f]{6}$/iu);
  expect(colors.controlToken).toMatch(/^#[\da-f]{6}$/iu);
  for (const surface of [colors.paper, colors.field, colors.surface]) {
    expect(contrastRatio(colors.focusToken, surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(colors.controlToken, surface)).toBeGreaterThanOrEqual(
      3,
    );
  }
  expect(contrastRatio(colors.actualOutline, colors.paper)).toBeGreaterThanOrEqual(
    3,
  );
  const actualControlBorders = [
    colors.actualButtonBorder,
    colors.actualDetailsBorder,
  ];

  await page.getByRole("link", { name: "历史" }).click();
  actualControlBorders.push(
    await page
      .getByRole("combobox", { name: "来源" })
      .evaluate((element) => getComputedStyle(element).borderTopColor),
  );
  await page.getByRole("link", { name: "已掌握" }).click();
  actualControlBorders.push(
    await page
      .getByRole("searchbox", { name: "搜索瑞典语或释义" })
      .evaluate((element) => getComputedStyle(element).borderTopColor),
    await page
      .getByLabel("选择 JSON 备份文件")
      .evaluate((element) => getComputedStyle(element).borderTopColor),
  );

  for (const border of actualControlBorders) {
    expect(contrastRatio(border, colors.field)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(border, colors.surface)).toBeGreaterThanOrEqual(3);
  }
});

test("all visible controls keep a meaningful 44px target", async ({ page }) => {
  const auditPage = async () => {
    const targets = await page
      .locator("a[href], button, summary, input, select")
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              rect.width > 0 &&
              rect.height > 0
            );
          })
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              label:
                element.getAttribute("aria-label") ??
                element.textContent?.trim().slice(0, 80) ??
                element.tagName,
              isInlineAnnotation: element.classList.contains("annotation"),
              height: rect.height,
              width: rect.width,
            };
          }),
      );

    for (const target of targets) {
      if (target.isInlineAnnotation) {
        // Inline text controls may use their natural line height; one 44px
        // dimension preserves the reading flow while maintaining a large target.
        expect(
          Math.max(target.height, target.width),
          `${target.label} inline target`,
        ).toBeGreaterThanOrEqual(44);
      } else {
        expect(target.height, `${target.label} target height`).toBeGreaterThanOrEqual(
          44,
        );
      }
    }
  };

  await openReader(page);
  await auditPage();
  await expect(page.getByRole("link", { name: "阅读完整原文" })).toHaveCSS(
    "min-height",
    "44px",
  );
  await expect(
    page.getByRole("link", { name: /DN · DN följer regeringens besked/u }),
  ).toHaveCSS("min-height", "44px");

  await page.getByRole("link", { name: "历史" }).click();
  await expect(page.getByRole("heading", { name: "历史课程" })).toBeVisible();
  await auditPage();

  await page.getByRole("link", { name: "已掌握" }).click();
  await expect(
    page.getByRole("heading", { name: "我的已掌握内容" }),
  ).toBeVisible();
  await auditPage();
});
