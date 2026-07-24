import type { DailyLesson, LessonArticle, Source } from "../contracts/content";
import type { Fetcher, FingerprintedArticle, SourceAdapter, SourceArticle, UrlAccessGuard } from "../contracts/transient";
import { ZodError } from "zod";
import type { AiGateway } from "./ai/gateway";
import { stockholmDateTime } from "./clock";
import { deduplicateArticles } from "./dedupe/cluster";
import { generateValidatedLesson } from "./lessons/generate";
import { FileRepository, type DailyRepository } from "./persistence/repository";
import { appendLedgerDay, selectDailyArticles } from "./selection/select";
import { parseArticle } from "./sources/article-parser";
import { createSourceAdapters } from "./sources/adapters";
import { createHttpFetcher, fetchPublicSourceText } from "./sources/fetcher";
import { createRobotsGuard } from "./sources/robots";

const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_ARTICLES_PER_SOURCE = 12;
const MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_FUTURE_MS = 60 * 60 * 1_000;

export interface RunDependencies {
  repository?: DailyRepository;
  fetcher?: Fetcher;
  robots?: UrlAccessGuard;
  adapters?: SourceAdapter[];
  parseArticle?: typeof parseArticle;
  deduplicateArticles?: typeof deduplicateArticles;
  selectDailyArticles?: typeof selectDailyArticles;
  generateValidatedLesson?: typeof generateValidatedLesson;
}

export interface RunOptions {
  root: string;
  now: Date;
  gateway: AiGateway;
  force?: boolean;
  dateOverride?: string;
  dependencies?: RunDependencies;
  onDiagnostic?: (diagnostic: PipelineDiagnostic) => void;
}

export type PipelineDiagnostic =
  | {
      type: "lesson-generation-failure";
      candidateId: string;
      source: Source;
      scope: FingerprintedArticle["fingerprint"]["scope"];
      failure: {
        category: "validation" | "openai" | "runtime";
        code: string;
        name?: string;
        status?: number;
        issues?: Array<{ code: string; path: Array<string | number> }>;
      };
    }
  | {
      type: "daily-pipeline-summary";
      date: string;
      discoveredArticles: number;
      queuedCandidates: number;
      domesticCandidates: number;
      internationalCandidates: number;
      attemptedCandidates: number;
      generatedLessons: number;
      status: DailyLesson["status"];
      sourceHealth: DailyLesson["sourceHealth"];
    };

function sourceHealth(): Record<Source, "ok" | "partial" | "failed"> {
  return { svt: "ok", aftonbladet: "ok", dn: "ok" };
}

function safeFailure(error: unknown): Extract<PipelineDiagnostic, { type: "lesson-generation-failure" }>["failure"] {
  if (error instanceof ZodError) {
    return {
      category: "validation",
      code: "zod-invalid-structured-output",
      issues: error.issues.slice(0, 12).map((issue) => ({
        code: issue.code,
        path: issue.path.filter((part): part is string | number =>
          typeof part === "string" || typeof part === "number"),
      })),
    };
  }

  if (!(error instanceof Error)) return { category: "runtime", code: "unknown-non-error" };
  const internalCode = error.message.match(/^(?:lesson|openai)-[a-z0-9-]+/u)?.[0];
  const rawStatus = "status" in error ? Number((error as Error & { status?: unknown }).status) : 0;
  const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : undefined;
  const rawApiCode = "code" in error ? (error as Error & { code?: unknown }).code : undefined;
  const apiCode = typeof rawApiCode === "string" && /^[a-z0-9_-]{1,80}$/u.test(rawApiCode)
    ? rawApiCode
    : undefined;
  const name = /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(error.name) ? error.name : undefined;
  const category = internalCode?.startsWith("lesson-")
    ? "validation"
    : internalCode?.startsWith("openai-") || status !== undefined
      ? "openai"
      : "runtime";
  return {
    category,
    code: internalCode ?? apiCode ?? "unclassified-error",
    ...(name === undefined ? {} : { name }),
    ...(status === undefined ? {} : { status }),
  };
}

function inPublicationWindow(article: SourceArticle, now: Date): boolean {
  const published = new Date(article.publishedAt).getTime();
  if (!Number.isFinite(published)) return false;
  const age = now.getTime() - published;
  return age >= -MAX_FUTURE_MS && age <= MAX_AGE_MS;
}

function candidateQueue(
  candidates: FingerprintedArticle[],
  ledger: Parameters<typeof selectDailyArticles>[1],
  select: typeof selectDailyArticles,
): FingerprintedArticle[] {
  const remaining = [...candidates];
  const ordered: FingerprintedArticle[] = [];
  while (remaining.length > 0) {
    const batch = select(remaining, ledger, 3);
    if (batch.length === 0) break;
    ordered.push(...batch);
    const selectedIds = new Set(batch.map((item) => item.article.id));
    const selectedUrls = new Set(batch.map((item) => item.article.canonicalUrl));
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (selectedIds.has(remaining[index]!.article.id) || selectedUrls.has(remaining[index]!.article.canonicalUrl)) {
        remaining.splice(index, 1);
      }
    }
  }
  return ordered;
}

export async function runDailyPipeline(options: RunOptions): Promise<DailyLesson | null> {
  const clock = stockholmDateTime(options.now);
  if (options.dateOverride !== undefined && (!DATE.test(options.dateOverride) || options.dateOverride !== clock.date)) {
    throw new Error("date-override-must-match-stockholm-today");
  }
  const date = options.dateOverride ?? clock.date;
  const dependencies = options.dependencies ?? {};
  const repository = dependencies.repository ?? new FileRepository(options.root);
  if (!options.force && clock.hour < 7) return null;
  if (!options.force && await repository.lessonExists(date)) return null;

  const fetcher = dependencies.fetcher ?? createHttpFetcher();
  const robots = dependencies.robots ?? createRobotsGuard(fetcher);
  const adapters = dependencies.adapters ?? createSourceAdapters();
  const parse = dependencies.parseArticle ?? parseArticle;
  const deduplicate = dependencies.deduplicateArticles ?? deduplicateArticles;
  const select = dependencies.selectDailyArticles ?? selectDailyArticles;
  const generate = dependencies.generateValidatedLesson ?? generateValidatedLesson;
  const health = sourceHealth();
  const articles: SourceArticle[] = [];

  for (const adapter of adapters) {
    let links;
    try {
      links = await adapter.discover(options.now, fetcher, robots);
    } catch {
      health[adapter.source] = "failed";
      continue;
    }
    let usable = 0;
    for (const link of links.slice(0, MAX_ARTICLES_PER_SOURCE)) {
      try {
        const response = await fetchPublicSourceText(adapter.source, link.url, fetcher, robots);
        if (response.status !== 200) continue;
        const article = parse(adapter.source, response.url, response.text);
        if (!article.isAccessibleForFree || !inPublicationWindow(article, options.now)) continue;
        articles.push(article);
        usable += 1;
      } catch {
        // A candidate failure is isolated; source text is intentionally never logged.
      }
    }
    if (links.length === 0 || usable === 0) health[adapter.source] = "partial";
  }

  const persistedLedger = await repository.loadLedger();
  // A crash before the index commit can leave internal files ahead of the visible lesson.
  // The current date is therefore rebuilt deterministically on every rerun.
  const ledger = { ...persistedLedger, days: persistedLedger.days.filter((day) => day.date !== date) };
  const deduplicated = await deduplicate(articles, ledger, options.gateway);
  const queue = candidateQueue(deduplicated, ledger, select);
  const domesticQueue = queue.filter((item) => item.fingerprint.scope !== "international");
  const internationalQueue = queue.filter((item) => item.fingerprint.scope === "international");
  const generated: Array<{ selected: FingerprintedArticle; lesson: LessonArticle }> = [];
  const attempted = new Set<string>();
  const generateOne = async (selected: FingerprintedArticle): Promise<boolean> => {
    attempted.add(selected.article.id);
    try {
      const cached = await repository.findCachedLesson(selected.article.canonicalUrl, selected.article.contentHash);
      const lesson = cached ?? await generate(selected, options.gateway);
      generated.push({ selected, lesson });
      return true;
    } catch (error) {
      options.onDiagnostic?.({
        type: "lesson-generation-failure",
        candidateId: selected.article.id,
        source: selected.article.source,
        scope: selected.fingerprint.scope,
        failure: safeFailure(error),
      });
      // Do not log model output or source text; deterministic fallback candidates remain eligible.
      return false;
    }
  };
  const firstSuccessful = async (items: FingerprintedArticle[]): Promise<boolean> => {
    for (const item of items) {
      if (await generateOne(item)) return true;
    }
    return false;
  };

  if (domesticQueue.length > 0 && internationalQueue.length > 0) {
    const domesticReady = await firstSuccessful(domesticQueue);
    const internationalReady = domesticReady && await firstSuccessful(internationalQueue);
    if (domesticReady && internationalReady) {
      for (const item of queue) {
        if (generated.length === 3) break;
        if (!attempted.has(item.article.id) && await generateOne(item)) break;
      }
    }
  }

  const domestic = generated.some(({ selected }) => selected.fingerprint.scope !== "international");
  const international = generated.some(({ selected }) => selected.fingerprint.scope === "international");
  const ready = generated.length >= 2 && domestic && international;
  const lesson: DailyLesson = {
    schemaVersion: 1,
    date,
    timezone: "Europe/Stockholm",
    generatedAt: options.now.toISOString(),
    status: ready ? "ready" : "delayed",
    sourceHealth: health,
    selectionSummary: ready
      ? "Domestic and international coverage selected with seven-day topic balancing."
      : "Fewer than two fully validated public lessons were available.",
    articles: ready ? generated.map(({ lesson: article }) => article) : [],
  };
  options.onDiagnostic?.({
    type: "daily-pipeline-summary",
    date,
    discoveredArticles: articles.length,
    queuedCandidates: queue.length,
    domesticCandidates: domesticQueue.length,
    internationalCandidates: internationalQueue.length,
    attemptedCandidates: attempted.size,
    generatedLessons: generated.length,
    status: lesson.status,
    sourceHealth: health,
  });
  if (ready) {
    await repository.publishDaily({
      lesson,
      ledger: appendLedgerDay(ledger, date, generated.map(({ selected }) => selected)),
      cacheEntries: generated.map(({ lesson: article }) => ({
        canonicalUrl: article.sourceUrl,
        contentHash: article.contentHash,
        lessonDate: date,
        lessonId: article.id,
      })),
    });
  } else {
    await repository.publishDaily({ lesson });
  }
  return lesson;
}
