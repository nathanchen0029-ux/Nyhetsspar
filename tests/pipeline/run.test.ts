import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DailyLesson, LessonArticle } from "../../src/contracts/content";
import type { CandidateLink, Fetcher, FingerprintedArticle, SourceArticle, UrlAccessGuard } from "../../src/contracts/transient";
import { stockholmDateTime } from "../../src/pipeline/clock";
import { FileRepository } from "../../src/pipeline/persistence/repository";
import { runDailyPipeline } from "../../src/pipeline/run";

const NOW = new Date("2026-07-23T05:00:00.000Z");
const BODY = Array.from({ length: 190 }, (_, index) => `källa${index}`).join(" ");
const STUDY_TEXT = Array.from({ length: 300 }, (_, index) => `studie${index}`).join(" ");

function sourceArticle(id: string, source: SourceArticle["source"], scope: "sweden" | "international"): SourceArticle {
  const host = source === "svt" ? "www.svt.se" : source === "dn" ? "www.dn.se" : "www.aftonbladet.se";
  return {
    id,
    source,
    url: `https://${host}/nyheter/${id}`,
    canonicalUrl: `https://${host}/nyheter/${id}`,
    title: `Nyhet ${id}`,
    publishedAt: "2026-07-23T04:00:00.000Z",
    body: BODY,
    contentHash: `sha256:${id}`,
    isAccessibleForFree: true,
    sectionHint: scope,
  };
}

function candidate(article: SourceArticle): CandidateLink {
  return {
    source: article.source,
    url: article.url,
    discoveredTitle: article.title,
    discoveredAt: NOW.toISOString(),
  };
}

function lessonFor(article: SourceArticle, selected: FingerprintedArticle): LessonArticle {
  return {
    id: `lesson-${article.id}`,
    eventFingerprint: selected.fingerprint.canonical,
    source: article.source,
    sourceUrl: article.canonicalUrl,
    sourceTitle: article.title,
    publishedAt: article.publishedAt,
    scope: selected.fingerprint.scope,
    topic: selected.fingerprint.topic,
    isFollowUp: false,
    difficulty: { level: "B1-B2", reasons: ["nyhetsord"], readingMinutes: 6 },
    studyTitle: `Studietitel ${article.id}`,
    studyParagraphs: [
      { id: "p1", segments: [{ text: STUDY_TEXT.split(" ").slice(0, 150).join(" ") }] },
      { id: "p2", segments: [{ text: STUDY_TEXT.split(" ").slice(150).join(" ") }] },
    ],
    wordCount: 300,
    summaries: { sv: "Svensk sammanfattning.", zh: "中文摘要。", en: "English summary." },
    factPoints: ["En verifierad uppgift.", "En till verifierad uppgift."],
    originalSentenceNotes: [
      { quote: "En kort originalmening.", sourceUrl: article.canonicalUrl, annotationIds: ["vocabulary:ord"] },
      { quote: "En andra kort originalmening.", sourceUrl: article.canonicalUrl, annotationIds: ["vocabulary:ord"] },
    ],
    annotations: [],
    relatedCoverage: [],
    generationModel: "fake-model",
    contentHash: article.contentHash,
  };
}

function gateway(failIds = new Set<string>(), generationCalls?: string[]) {
  return {
    async fingerprint(articles: SourceArticle[]) {
      return articles.map((article) => ({
        candidateId: article.id,
        who: ["myndigheten"],
        action: "redovisar nyheten",
        where: article.sectionHint === "international" ? "världen" : "Sverige",
        when: "2026-07-23",
        outcome: "ny information",
        scope: article.sectionHint === "international" ? "international" as const : "sweden" as const,
        topic: "daily-life" as const,
        canonical: `event-${article.id}`,
      }));
    },
    async reviewPairs(pairs: Array<{ pairId: string }>) {
      return pairs.map((pair) => ({ pairId: pair.pairId, sameEvent: false, confidence: 0, reason: "different", materialUpdate: false }));
    },
    async generateLesson(input: { article: SourceArticle; fingerprint: FingerprintedArticle["fingerprint"] }) {
      generationCalls?.push(input.article.id);
      if (failIds.has(input.article.id)) throw new Error("generation-failed");
      return lessonFor(input.article, { article: input.article, fingerprint: input.fingerprint, related: [], isFollowUp: false });
    },
    async verifyLessonFacts() {},
  };
}

function readyLesson(date: string, suffix = "old"): DailyLesson {
  const domestic = sourceArticle(`domestic-${suffix}`, "svt", "sweden");
  const international = sourceArticle(`international-${suffix}`, "dn", "international");
  const selection = (article: SourceArticle, scope: "sweden" | "international"): FingerprintedArticle => ({
    article,
    fingerprint: { candidateId: article.id, who: ["myndigheten"], action: "rapporterar", where: scope, when: date, outcome: "utfall", scope, topic: "daily-life", canonical: `event-${article.id}` },
    related: [],
    isFollowUp: false,
  });
  return {
    schemaVersion: 1, date, timezone: "Europe/Stockholm", generatedAt: NOW.toISOString(), status: "ready",
    sourceHealth: { svt: "ok", aftonbladet: "ok", dn: "ok" }, selectionSummary: "Ready lesson.",
    articles: [lessonFor(domestic, selection(domestic, "sweden")), lessonFor(international, selection(international, "international"))],
  };
}

function ports(articles: SourceArticle[]) {
  const redirects: string[] = [];
  const fetcher: Fetcher = {
    async fetchText(url, options) {
      redirects.push(url);
      if (options?.redirectGuard) await options.redirectGuard(url);
      return { url, status: 200, headers: new Headers(), text: "unused" };
    },
  };
  const robots: UrlAccessGuard = { async isAllowed() { return true; } };
  return {
    redirects,
    dependencies: {
      fetcher,
      robots,
      adapters: [...new Set(articles.map((article) => article.source))].map((source) => ({
        source,
        async discover() { return articles.filter((article) => article.source === source).map(candidate); },
      })),
      parseArticle(source: SourceArticle["source"], url: string) {
        const article = articles.find((item) => item.source === source && item.url === url);
        if (!article) throw new Error("missing-article");
        return article;
      },
      async generateValidatedLesson(selected: FingerprintedArticle, aiGateway: { generateLesson: (input: { article: SourceArticle; fingerprint: FingerprintedArticle["fingerprint"]; related: SourceArticle[]; isFollowUp: boolean }) => Promise<LessonArticle> }) {
        return aiGateway.generateLesson({
          article: selected.article,
          fingerprint: selected.fingerprint,
          related: selected.related,
          isFollowUp: selected.isFollowUp,
        });
      },
    },
  };
}

async function root(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nyhetsspar-run-"));
}

describe("daily pipeline infrastructure", () => {
  it("maps summer and winter UTC triggers to Stockholm 07:00", () => {
    expect(stockholmDateTime(new Date("2026-07-23T05:00:00Z")).hour).toBe(7);
    expect(stockholmDateTime(new Date("2026-01-23T06:00:00Z")).hour).toBe(7);
  });

  it("does no work before Stockholm 07:00", async () => {
    const directory = await root();
    const article = sourceArticle("sv-1", "svt", "sweden");
    const { dependencies, redirects } = ports([article]);
    const result = await runDailyPipeline({ root: directory, now: new Date("2026-07-23T04:59:00Z"), gateway: gateway(), dependencies });
    expect(result).toBeNull();
    expect(redirects).toEqual([]);
  });

  it("skips an already-ready Stockholm date", async () => {
    const directory = await root();
    const repository = new FileRepository(directory);
    const existing = readyLesson("2026-07-23");
    await repository.publishDaily({ lesson: existing });
    const { dependencies, redirects } = ports([sourceArticle("sv-1", "svt", "sweden")]);
    await expect(runDailyPipeline({ root: directory, now: NOW, gateway: gateway(), dependencies })).resolves.toBeNull();
    expect(redirects).toEqual([]);
  });

  it("publishes a ready lesson atomically after safe public-source fetches without persisting bodies", async () => {
    const directory = await root();
    const articles = [sourceArticle("sv-1", "svt", "sweden"), sourceArticle("world-1", "dn", "international")];
    const { dependencies, redirects } = ports(articles);
    const result = await runDailyPipeline({ root: directory, now: NOW, gateway: gateway(), dependencies });
    expect(result?.status).toBe("ready");
    expect(result?.articles).toHaveLength(2);
    expect(redirects).toEqual(expect.arrayContaining(articles.map((article) => article.url)));
    const lessonPath = (JSON.parse(await readFile(join(directory, "public/data/index.json"), "utf8")) as { dates: Array<{ lessonPath: string }> }).dates[0]!.lessonPath;
    const persisted = await Promise.all([
      readFile(join(directory, "public/data/index.json"), "utf8"),
      readFile(join(directory, "public", lessonPath), "utf8"),
      readFile(join(directory, "data/editorial-ledger.json"), "utf8"),
      readFile(join(directory, "data/cache/index.json"), "utf8"),
    ]);
    expect(persisted.join("\n")).not.toContain(BODY);
    await expect(readFile(join(directory, lessonPath), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("publishes delayed with no articles and leaves ledger/cache untouched when coverage is insufficient", async () => {
    const directory = await root();
    const { dependencies } = ports([sourceArticle("sv-1", "svt", "sweden")]);
    const result = await runDailyPipeline({ root: directory, now: NOW, gateway: gateway(), dependencies });
    expect(result?.status).toBe("delayed");
    expect(result?.articles).toEqual([]);
    await expect(readFile(join(directory, "data/editorial-ledger.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(directory, "data/cache/index.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reselects a backup candidate when one generation fails", async () => {
    const directory = await root();
    const articles = [
      sourceArticle("a-fails", "svt", "sweden"),
      sourceArticle("b-sweden", "aftonbladet", "sweden"),
      sourceArticle("c-world", "dn", "international"),
    ];
    const { dependencies } = ports(articles);
    const result = await runDailyPipeline({ root: directory, now: NOW, gateway: gateway(new Set(["a-fails"])), dependencies });
    expect(result?.status).toBe("ready");
    expect(result?.articles.map((article) => article.id)).toEqual(expect.arrayContaining(["lesson-b-sweden", "lesson-c-world"]));
  });

  it("tries an international backup before an additional domestic candidate", async () => {
    const directory = await root();
    const articles = [
      sourceArticle("a-domestic", "svt", "sweden"),
      sourceArticle("b-international-fails", "dn", "international"),
      sourceArticle("c-domestic", "aftonbladet", "sweden"),
      sourceArticle("d-international", "dn", "international"),
    ];
    const { dependencies } = ports(articles);
    const calls: string[] = [];
    const result = await runDailyPipeline({
      root: directory,
      now: NOW,
      gateway: gateway(new Set(["b-international-fails"]), calls),
      dependencies: { ...dependencies, selectDailyArticles: (items) => [...items].sort((left, right) => left.article.id.localeCompare(right.article.id)).slice(0, 3) },
    });
    expect(result?.status).toBe("ready");
    expect(calls).toEqual(["a-domestic", "b-international-fails", "d-international", "c-domestic"]);
  });

  it("does not generate a queue of domestic articles when no international candidate exists", async () => {
    const directory = await root();
    const calls: string[] = [];
    const { dependencies } = ports([
      sourceArticle("a-domestic", "svt", "sweden"),
      sourceArticle("b-domestic", "aftonbladet", "sweden"),
      sourceArticle("c-domestic", "svt", "sweden"),
    ]);
    const result = await runDailyPipeline({ root: directory, now: NOW, gateway: gateway(new Set(), calls), dependencies });
    expect(result?.status).toBe("delayed");
    expect(calls).toEqual([]);
  });

  it("ignores a stale ledger record for the current date before selecting a rerun", async () => {
    const directory = await root();
    const repository = new FileRepository(directory);
    await repository.saveLedger({
      schemaVersion: 1,
      days: [{
        date: "2026-07-23",
        scopes: { local: 0, sweden: 1, international: 1 },
        topics: { politics: 0, economy: 0, "daily-life": 2, culture: 0, sports: 0 },
        sources: { svt: 1, aftonbladet: 0, dn: 1 },
        eventFingerprints: ["event-sv-1", "event-world-1"],
      }],
    });
    const articles = [sourceArticle("sv-1", "svt", "sweden"), sourceArticle("world-1", "dn", "international")];
    const { dependencies } = ports(articles);
    const result = await runDailyPipeline({ root: directory, now: NOW, gateway: gateway(), dependencies });
    expect(result?.status).toBe("ready");
    expect((await repository.loadLedger()).days).toHaveLength(1);
  });

  it("rejects extra cache fields and invalid lesson states before writing final files", async () => {
    const directory = await root();
    const repository = new FileRepository(directory);
    await repository.saveCacheEntry({ canonicalUrl: "https://www.svt.se/a", contentHash: "sha256:a", lessonDate: "2026-07-23", lessonId: "a", lessonPath: "data/lessons/2026-07-23-0123456789abcdef.json" });
    const cachePath = join(directory, "data/cache/index.json");
    const raw = JSON.parse(await readFile(cachePath, "utf8")) as { entries: unknown[] };
    raw.entries.push({ canonicalUrl: "https://www.svt.se/b", contentHash: "sha256:b", lessonDate: "2026-07-23", lessonId: "b", body: "must reject" });
    await writeFile(cachePath, JSON.stringify(raw), "utf8");
    await expect(repository.findCachedLesson("https://www.svt.se/b", "sha256:b")).rejects.toThrow();
    const invalid: DailyLesson = {
      schemaVersion: 1, date: "2026-07-23", timezone: "Europe/Stockholm", generatedAt: NOW.toISOString(), status: "ready",
      sourceHealth: { svt: "ok", aftonbladet: "ok", dn: "ok" }, selectionSummary: "Invalid.", articles: [],
    };
    const invalidDirectory = await root();
    await expect(new FileRepository(invalidDirectory).publishDaily({ lesson: invalid })).rejects.toThrow();
    await expect(readFile(join(invalidDirectory, "public/data/index.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const cacheInvalidDirectory = await root();
    const valid = readyLesson("2026-07-23", "cache-invalid");
    await expect(new FileRepository(cacheInvalidDirectory).publishDaily({
      lesson: valid,
      cacheEntries: [{ canonicalUrl: valid.articles[0]!.sourceUrl, contentHash: valid.articles[0]!.contentHash, lessonDate: "2026-07-22", lessonId: valid.articles[0]!.id }],
    })).rejects.toThrow("cache-entry-does-not-match-published-lesson");
    await expect(readFile(join(cacheInvalidDirectory, "public/data/index.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the old same-date version visible until a pending publication rolls forward", async () => {
    const directory = await root();
    const old = readyLesson("2026-07-23", "old");
    const repository = new FileRepository(directory);
    await repository.publishDaily({ lesson: old, ledger: { schemaVersion: 1, days: [] }, cacheEntries: [] });
    const originalIndex = await readFile(join(directory, "public/data/index.json"), "utf8");
    const oldPath = (JSON.parse(originalIndex) as { dates: Array<{ lessonPath: string }> }).dates[0]!.lessonPath;
    const originalLesson = await readFile(join(directory, "public", oldPath), "utf8");

    const replacement = readyLesson("2026-07-23", "new");
    const failing = new FileRepository(directory, { beforeRename: (path) => { if (path.endsWith("public/data/index.json")) throw new Error("index-failpoint"); } });
    await expect(failing.publishDaily({
      lesson: replacement,
      ledger: { schemaVersion: 1, days: [] },
      cacheEntries: replacement.articles.map((article) => ({ canonicalUrl: article.sourceUrl, contentHash: article.contentHash, lessonDate: replacement.date, lessonId: article.id })),
    })).rejects.toThrow("index-failpoint");
    await expect(readFile(join(directory, "public/data/index.json"), "utf8")).resolves.toBe(originalIndex);
    await expect(readFile(join(directory, "public", oldPath), "utf8")).resolves.toBe(originalLesson);
    await expect(readFile(join(directory, "data/pending-publication.json"), "utf8")).resolves.toContain("lessonPath");

    const recovered = new FileRepository(directory);
    await expect(recovered.lessonExists("2026-07-23")).resolves.toBe(true);
    const newIndex = JSON.parse(await readFile(join(directory, "public/data/index.json"), "utf8")) as { dates: Array<{ lessonPath: string }> };
    expect(newIndex.dates[0]!.lessonPath).not.toBe(oldPath);
    expect((await recovered.loadLesson("2026-07-23"))?.articles[0]?.id).toBe("lesson-domestic-new");
    const cache = JSON.parse(await readFile(join(directory, "data/cache/index.json"), "utf8")) as { entries: Array<{ lessonPath: string }> };
    expect(cache.entries.every((entry) => entry.lessonPath === newIndex.dates[0]!.lessonPath)).toBe(true);
    await expect(readFile(join(directory, "data/pending-publication.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rolls forward a first-date publication left pending before the public index", async () => {
    const directory = await root();
    const lesson = readyLesson("2026-07-23", "first");
    const failing = new FileRepository(directory, { beforeRename: (path) => { if (path.endsWith("public/data/index.json")) throw new Error("index-failpoint"); } });
    await expect(failing.publishDaily({ lesson })).rejects.toThrow("index-failpoint");
    await expect(readFile(join(directory, "public/data/index.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    const recovered = new FileRepository(directory);
    const index = await recovered.loadIndex();
    expect(index.dates[0]?.date).toBe("2026-07-23");
    await expect(readFile(join(directory, "public", index.dates[0]!.lessonPath), "utf8")).resolves.toContain("domestic-first");
  });

  it("rejects a pending journal whose current-date index points to another lesson version", async () => {
    const directory = await root();
    const old = readyLesson("2026-07-23", "journal-old");
    await new FileRepository(directory).publishDaily({ lesson: old });
    const originalIndex = await readFile(join(directory, "public/data/index.json"), "utf8");
    const oldPath = (JSON.parse(originalIndex) as { dates: Array<{ lessonPath: string }> }).dates[0]!.lessonPath;
    const failing = new FileRepository(directory, { beforeRename: (path) => { if (path.endsWith("public/data/index.json")) throw new Error("index-failpoint"); } });
    await expect(failing.publishDaily({ lesson: readyLesson("2026-07-23", "journal-new") })).rejects.toThrow("index-failpoint");
    const journalPath = join(directory, "data/pending-publication.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as { index: { dates: Array<{ date: string; lessonPath: string }> } };
    journal.index.dates.find((entry) => entry.date === "2026-07-23")!.lessonPath = oldPath;
    await writeFile(journalPath, JSON.stringify(journal), "utf8");
    await expect(new FileRepository(directory).lessonExists("2026-07-23")).rejects.toThrow();
    await expect(readFile(join(directory, "public/data/index.json"), "utf8")).resolves.toBe(originalIndex);
  });
});
