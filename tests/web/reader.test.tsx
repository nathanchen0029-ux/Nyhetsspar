import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Annotation, LessonArticle } from "../../src/contracts/content";
import { AnnotationText } from "../../src/web/components/AnnotationText";
import { LanguageCard } from "../../src/web/components/LanguageCard";
import { LessonPage } from "../../src/web/pages/LessonPage";
import { createKnownStore } from "../../src/web/storage/known";
import { createProgressStore } from "../../src/web/storage/progress";

function knownRecord(
  canonical: string,
  kind: "vocabulary" | "phrase" | "grammar" = "vocabulary",
) {
  return {
    kind,
    canonical,
    original: canonical,
    meaningZh: "中文",
    meaningEn: "English",
    markedAt: "2026-07-23T05:00:00.000Z",
  } as const;
}

const governmentAnnotation: Extract<
  Annotation,
  { kind: "vocabulary" }
> = {
  id: "vocabulary:regering:first",
  kind: "vocabulary",
  canonical: "regering",
  targets: ["regeringen"],
  meaningZh: "政府",
  meaningEn: "government",
  exampleSv: "Regeringen presenterar ett förslag.",
  surface: "regeringen",
  lemma: "regering",
  partOfSpeech: "substantiv",
  inflections: ["regeringen", "regeringar"],
  compoundParts: [],
  note: "Bestämd form.",
};

function repeatedAnnotationArticle(id = "article-1"): LessonArticle {
  const firstVocabulary: Annotation = {
    ...governmentAnnotation,
    id: `vocabulary:${id}:first`,
  };
  const secondVocabulary: Annotation = {
    ...governmentAnnotation,
    id: `vocabulary:${id}:second`,
    canonical: "REGERING",
    targets: ["REGERINGEN"],
    surface: "REGERINGEN",
  };
  const phraseWithSameSpelling: Annotation = {
    id: `phrase:${id}:regering`,
    kind: "phrase",
    canonical: "regering",
    targets: ["regering"],
    meaningZh: "同形词组测试",
    meaningEn: "same-spelling phrase test",
    exampleSv: "Detta är ett separat språkobjekt.",
    sourceForm: "regering",
    canonicalForm: "regering",
    verbForms: [],
    usage: "A separate phrase identity.",
  };
  const sourceUrl = `https://www.svt.se/nyheter/${id}`;
  const words = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`).join(
      " ",
    );
  return {
    id,
    eventFingerprint: `event-${id}`,
    source: "svt",
    sourceUrl,
    sourceTitle: "Regeringen presenterar ett förslag",
    publishedAt: "2026-07-23T04:00:00.000Z",
    scope: "sweden",
    topic: "politics",
    isFollowUp: false,
    difficulty: { level: "B2", reasons: ["Nyhetsord"], readingMinutes: 4 },
    studyTitle: "Ett nytt förslag",
    studyParagraphs: [
      {
        id: "p1",
        segments: [
          { text: "Regeringen", annotationId: firstVocabulary.id },
          { text: ` ${words("ord", 149)}` },
        ],
      },
      {
        id: "p2",
        segments: [
          { text: "REGERINGEN", annotationId: secondVocabulary.id },
          { text: " " },
          { text: "regering", annotationId: phraseWithSameSpelling.id },
          { text: ` ${words("nyhet", 148)}` },
        ],
      },
    ],
    wordCount: 300,
    summaries: {
      sv: "En svensk sammanfattning.",
      zh: "中文摘要。",
      en: "English summary.",
    },
    factPoints: ["Fakta ett.", "Fakta två."],
    originalSentenceNotes: [
      {
        quote: "Regeringen presenterar ett nytt förslag.",
        sourceUrl,
        annotationIds: [firstVocabulary.id],
      },
      {
        quote: "Förslaget offentliggjordes på morgonen.",
        sourceUrl,
        annotationIds: [secondVocabulary.id],
      },
    ],
    annotations: [
      firstVocabulary,
      secondVocabulary,
      phraseWithSameSpelling,
    ],
    relatedCoverage: [],
    generationModel: "test-model",
    contentHash: `hash-${id}`,
  };
}

describe("known-item storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("uses a normalized, kind-scoped identity without merging unrelated items", () => {
    const store = createKnownStore(localStorage);

    store.mark(knownRecord("  REGERING  "));

    expect(store.isKnown("vocabulary", "regering")).toBe(true);
    expect(store.isKnown("phrase", "regering")).toBe(false);
    expect(store.isKnown("vocabulary", "regering!")).toBe(false);
  });

  it("fails safely on malformed or unsupported persisted data", () => {
    localStorage.setItem("nyhetsspar.known.v1", "{not-json");
    const malformed = createKnownStore(localStorage);

    expect(malformed.list()).toEqual([]);
    expect(() => malformed.isKnown("vocabulary", "regering")).not.toThrow();

    localStorage.setItem(
      "nyhetsspar.known.v1",
      JSON.stringify({ version: 2, records: [knownRecord("regering")] }),
    );
    const unsupported = createKnownStore(localStorage);

    expect(unsupported.list()).toEqual([]);
    expect(() => unsupported.mark(knownRecord("kommun"))).not.toThrow();
    expect(unsupported.isKnown("vocabulary", "kommun")).toBe(true);
  });

  it("keeps a volatile safe state when browser storage is unavailable", () => {
    const unavailable = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    };
    const store = createKnownStore(unavailable);

    expect(() => store.mark(knownRecord("kommun"))).not.toThrow();
    expect(store.isKnown("vocabulary", "kommun")).toBe(true);
  });

  it("starts safely when access to the localStorage property itself is blocked", () => {
    const getter = vi
      .spyOn(window, "localStorage", "get")
      .mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError");
      });

    try {
      expect(() => createKnownStore()).not.toThrow();
      expect(() => createProgressStore()).not.toThrow();
    } finally {
      getter.mockRestore();
    }
  });

  it("respects data cleared outside the store instance", () => {
    const store = createKnownStore(localStorage);
    store.mark(knownRecord("kommun"));

    localStorage.clear();

    expect(store.list()).toEqual([]);
  });

  it("exports a versioned snapshot and merge-imports without deleting current records", () => {
    const store = createKnownStore(localStorage);
    store.mark(knownRecord("regering"));

    const exported = JSON.parse(store.exportJson()) as {
      version: number;
      records: unknown[];
    };
    expect(exported.version).toBe(1);
    expect(exported.records).toHaveLength(1);

    store.importJson(
      JSON.stringify({
        version: 1,
        records: [knownRecord("kommun")],
      }),
    );
    expect(store.list().map((record) => record.canonical).sort()).toEqual([
      "kommun",
      "regering",
    ]);
    expect(() => store.importJson('{"version":2,"records":[]}')).toThrow();
    expect(store.list()).toHaveLength(2);
  });
});

describe("article progress storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists opened, completed, and nonnegative reading positions", () => {
    const store = createProgressStore(localStorage);

    store.markOpened("article-1");
    store.setCompleted("article-1", true);
    store.savePosition("article-1", -12);

    const reopened = createProgressStore(localStorage);
    expect(reopened.opened()).toEqual(new Set(["article-1"]));
    expect(reopened.completed()).toEqual(new Set(["article-1"]));
    expect(reopened.position("article-1")).toBe(0);
    expect(reopened.lastOpenedId()).toBe("article-1");

    reopened.setCompleted("article-1", false);
    expect(reopened.completed()).toEqual(new Set());
  });

  it("migrates the supported legacy shape and ignores malformed versions safely", () => {
    localStorage.setItem(
      "nyhetsspar.progress.v1",
      JSON.stringify({ version: 1, completedIds: ["legacy-article"] }),
    );

    expect(createProgressStore(localStorage).completed()).toEqual(
      new Set(["legacy-article"]),
    );

    localStorage.setItem("nyhetsspar.progress.v1", "{broken");
    expect(createProgressStore(localStorage).completed()).toEqual(new Set());

    localStorage.setItem(
      "nyhetsspar.progress.v1",
      JSON.stringify({ version: 3, completedIds: ["unsupported"] }),
    );
    const unsupported = createProgressStore(localStorage);
    expect(() => unsupported.markOpened("new-article")).not.toThrow();
    expect(unsupported.opened()).toEqual(new Set(["new-article"]));
  });

  it("respects progress cleared outside the store instance", () => {
    const store = createProgressStore(localStorage);
    store.setCompleted("article-1", true);

    localStorage.clear();

    expect(store.completed()).toEqual(new Set());
  });
});

describe("reader known-item interaction", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks an annotation known and offers a five-second undo", async () => {
    vi.useFakeTimers();
    const store = createKnownStore(localStorage);
    const pendingChanges: boolean[] = [];
    render(
      <LanguageCard
        annotation={governmentAnnotation}
        articleId="article-1"
        knownStore={store}
        onPendingChange={(pending) => pendingChanges.push(pending)}
        onKnownChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /我认识/i }));

    expect(store.isKnown("vocabulary", "regering")).toBe(true);
    expect(store.list()[0]?.articleId).toBe("article-1");
    expect(screen.getByRole("button", { name: "撤销" })).toBeVisible();
    expect(pendingChanges).toEqual([true]);

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(store.isKnown("vocabulary", "regering")).toBe(false);
    expect(pendingChanges).toEqual([true, false]);
  });

  it("keeps known annotation text readable while removing its highlight control", () => {
    const paragraphs = [
      {
        id: "p1",
        segments: [
          { text: "Regeringen", annotationId: governmentAnnotation.id },
          { text: " presenterar ett förslag." },
        ],
      },
    ];
    const { rerender } = render(
      <AnnotationText
        paragraphs={paragraphs}
        hiddenIds={new Set()}
        onSelect={() => undefined}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Regeringen" }),
    ).toBeVisible();

    rerender(
      <AnnotationText
        paragraphs={paragraphs}
        hiddenIds={new Set([governmentAnnotation.id])}
        onSelect={() => undefined}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Regeringen" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Regeringen")).toBeVisible();
  });

  it("closes the undo window after five seconds without restoring the item", () => {
    vi.useFakeTimers();
    const store = createKnownStore(localStorage);
    const pendingChanges: boolean[] = [];
    render(
      <LanguageCard
        annotation={governmentAnnotation}
        knownStore={store}
        onPendingChange={(pending) => pendingChanges.push(pending)}
        onKnownChange={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /我认识/i }));

    act(() => vi.advanceTimersByTime(4_999));
    expect(screen.getByRole("button", { name: "撤销" })).toBeVisible();
    act(() => vi.advanceTimersByTime(1));

    expect(screen.getByRole("button", { name: /我认识/i })).toBeVisible();
    expect(store.isKnown("vocabulary", "regering")).toBe(true);
    expect(pendingChanges).toEqual([true, false]);
  });
});

describe("LessonPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("suppresses every recurring canonical annotation but preserves plain text", async () => {
    const knownStore = createKnownStore(localStorage);
    const progressStore = createProgressStore(localStorage);
    const user = userEvent.setup();
    const article = repeatedAnnotationArticle();
    const view = render(
      <MemoryRouter>
        <LessonPage
          article={article}
          date="2026-07-23"
          nextArticleId={null}
          knownStore={knownStore}
          progressStore={progressStore}
          onProgressChange={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("button", { name: "Regeringen" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "REGERINGEN" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "regering" })).toBeVisible();

    await user.click(
      screen.getAllByRole("button", { name: /我认识这个项目/i })[0]!,
    );

    expect(
      screen.queryByRole("button", { name: "Regeringen" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "REGERINGEN" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "regering" })).toBeVisible();
    expect(screen.getAllByText("Regeringen").length).toBeGreaterThan(0);
    expect(screen.getAllByText("REGERINGEN").length).toBeGreaterThan(0);

    view.unmount();
    render(
      <MemoryRouter>
        <LessonPage
          article={repeatedAnnotationArticle("future-article")}
          date="2026-07-24"
          nextArticleId={null}
          knownStore={knownStore}
          progressStore={progressStore}
          onProgressChange={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole("button", { name: "Regeringen" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "REGERINGEN" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "regering" })).toBeVisible();
  });

  it("persists completion for the current article and reports the change", async () => {
    const progressStore = createProgressStore(localStorage);
    const onProgressChange = vi.fn();
    render(
      <MemoryRouter>
        <LessonPage
          article={repeatedAnnotationArticle()}
          date="2026-07-23"
          nextArticleId={null}
          knownStore={createKnownStore(localStorage)}
          progressStore={progressStore}
          onProgressChange={onProgressChange}
        />
      </MemoryRouter>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "标记为已完成" }),
    );

    expect(progressStore.completed()).toEqual(new Set(["article-1"]));
    expect(screen.getByRole("button", { name: "已完成" })).toBeVisible();
    expect(onProgressChange).toHaveBeenCalledOnce();
  });
});
