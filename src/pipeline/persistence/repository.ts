import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  DailyLessonSchema,
  EditorialLedgerSchema,
  LessonIndexSchema,
  LessonPathSchema,
  type DailyLesson,
  type EditorialLedger,
  type LessonArticle,
  type LessonIndex,
} from "../../contracts/content";

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const CacheEntrySchema = z.object({
  canonicalUrl: z.string().url(),
  contentHash: z.string().min(1),
  lessonDate: DateSchema,
  lessonId: z.string().min(1),
  lessonPath: LessonPathSchema,
}).strict().superRefine((entry, context) => {
  if (!entry.lessonPath.startsWith(`data/lessons/${entry.lessonDate}-`)) {
    context.addIssue({ code: "custom", path: ["lessonPath"], message: "Cache lesson path date must match lessonDate." });
  }
});
const CacheIndexSchema = z.object({ schemaVersion: z.literal(1), entries: z.array(CacheEntrySchema) }).strict();

function indexEntry(lesson: DailyLesson, lessonPath: string): LessonIndex["dates"][number] {
  return {
    date: lesson.date,
    status: lesson.status,
    lessonPath,
    articles: lesson.articles.map((article) => ({
      id: article.id, title: article.studyTitle, source: article.source, scope: article.scope,
      topic: article.topic, difficulty: article.difficulty.level, isFollowUp: article.isFollowUp,
    })),
  };
}

function equalIndexEntry(left: LessonIndex["dates"][number], right: LessonIndex["dates"][number]): boolean {
  return left.date === right.date && left.status === right.status && left.lessonPath === right.lessonPath &&
    left.articles.length === right.articles.length && left.articles.every((article, index) => {
      const expected = right.articles[index];
      return expected !== undefined && article.id === expected.id && article.title === expected.title &&
        article.source === expected.source && article.scope === expected.scope && article.topic === expected.topic &&
        article.difficulty === expected.difficulty && article.isFollowUp === expected.isFollowUp;
    });
}

const PendingPublicationSchema = z.object({
  schemaVersion: z.literal(1),
  lesson: DailyLessonSchema,
  lessonPath: LessonPathSchema,
  index: LessonIndexSchema,
  ledger: EditorialLedgerSchema.optional(),
  cache: CacheIndexSchema.optional(),
}).strict().superRefine((pending, context) => {
  const entry = pending.index.dates.find((item) => item.date === pending.lesson.date);
  const expectedIndexEntry = indexEntry(pending.lesson, pending.lessonPath);
  if (!entry || !equalIndexEntry(entry, expectedIndexEntry)) {
    context.addIssue({ code: "custom", path: ["index"], message: "Pending index must exactly match the pending lesson version." });
  }
  pending.cache?.entries.forEach((cacheEntry, index) => {
    if (cacheEntry.lessonPath !== pending.lessonPath) return;
    const article = pending.lesson.articles.find((item) => item.id === cacheEntry.lessonId);
    if (
      cacheEntry.lessonDate !== pending.lesson.date ||
      article === undefined ||
      article.sourceUrl !== cacheEntry.canonicalUrl ||
      article.contentHash !== cacheEntry.contentHash
    ) {
      context.addIssue({ code: "custom", path: ["cache", "entries", index], message: "Pending cache entry must match the pending lesson article." });
    }
  });
});

export type CacheEntry = z.infer<typeof CacheEntrySchema>;
export type CacheIndex = z.infer<typeof CacheIndexSchema>;
export type CachePublicationEntry = Omit<CacheEntry, "lessonPath">;

interface FileOperations {
  mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface FileRepositoryOptions {
  fileOps?: Partial<FileOperations>;
  beforeRename?: (target: string) => void | Promise<void>;
}

export interface DailyPublication {
  lesson: DailyLesson;
  ledger?: EditorialLedger;
  cacheEntries?: CachePublicationEntry[];
}

export interface DailyRepository {
  loadLedger(): Promise<EditorialLedger>;
  lessonExists(date: string): Promise<boolean>;
  findCachedLesson(canonicalUrl: string, contentHash: string): Promise<LessonArticle | null>;
  publishDaily(publication: DailyPublication): Promise<void>;
}

export class FileRepository implements DailyRepository {
  private readonly files: FileOperations;

  constructor(private readonly root: string, private readonly options: FileRepositoryOptions = {}) {
    this.files = {
      mkdir: options.fileOps?.mkdir ?? mkdir,
      readFile: options.fileOps?.readFile ?? readFile,
      writeFile: options.fileOps?.writeFile ?? writeFile,
      rename: options.fileOps?.rename ?? rename,
      unlink: options.fileOps?.unlink ?? unlink,
    };
  }

  async loadLedger(): Promise<EditorialLedger> {
    await this.recoverPending();
    return this.loadLedgerRaw();
  }

  async saveLedger(ledger: EditorialLedger): Promise<void> {
    await this.recoverPending();
    await this.writeJsonAtomic(this.ledgerPath(), EditorialLedgerSchema.parse(ledger));
  }

  async loadIndex(): Promise<LessonIndex> {
    await this.recoverPending();
    return this.loadIndexRaw();
  }

  async lessonExists(date: string): Promise<boolean> {
    const validDate = DateSchema.parse(date);
    return (await this.loadIndex()).dates.some((entry) => entry.date === validDate && entry.status === "ready");
  }

  async loadLesson(date: string): Promise<DailyLesson | null> {
    const validDate = DateSchema.parse(date);
    const entry = (await this.loadIndex()).dates.find((item) => item.date === validDate);
    if (!entry) return null;
    return this.readJson(this.lessonFilePath(entry.lessonPath), null, DailyLessonSchema);
  }

  async saveLesson(lesson: DailyLesson): Promise<void> {
    await this.publishDaily({ lesson });
  }

  async saveCacheEntry(entry: CacheEntry): Promise<void> {
    await this.recoverPending();
    const valid = CacheEntrySchema.parse(entry);
    const current = await this.loadCacheRaw();
    await this.writeJsonAtomic(this.cachePath(), CacheIndexSchema.parse({
      schemaVersion: 1,
      entries: [valid, ...current.entries.filter((item) => item.canonicalUrl !== valid.canonicalUrl)],
    }));
  }

  async findCachedLesson(canonicalUrl: string, contentHash: string): Promise<LessonArticle | null> {
    await this.recoverPending();
    const entry = (await this.loadCacheRaw()).entries.find(
      (item) => item.canonicalUrl === canonicalUrl && item.contentHash === contentHash,
    );
    if (!entry) return null;
    const lesson = await this.readJson(this.lessonFilePath(entry.lessonPath), null, DailyLessonSchema);
    return lesson?.articles.find((article) => article.id === entry.lessonId) ?? null;
  }

  async publishDaily(publication: DailyPublication): Promise<void> {
    await this.recoverPending();
    const lesson = DailyLessonSchema.parse(publication.lesson);
    const lessonPath = this.versionedLessonPath(lesson);
    const currentIndex = await this.loadIndexRaw();
    const index = LessonIndexSchema.parse({
      schemaVersion: 1,
      dates: [indexEntry(lesson, lessonPath), ...currentIndex.dates.filter((entry) => entry.date !== lesson.date)]
        .sort((left, right) => right.date.localeCompare(left.date)),
    });
    const ledger = publication.ledger === undefined ? undefined : EditorialLedgerSchema.parse(publication.ledger);
    let cache: CacheIndex | undefined;
    if (publication.cacheEntries !== undefined) {
      const current = await this.loadCacheRaw();
      const entries = publication.cacheEntries.map((entry) => {
        const article = lesson.articles.find((item) => item.id === entry.lessonId);
        if (
          entry.lessonDate !== lesson.date ||
          article === undefined ||
          article.sourceUrl !== entry.canonicalUrl ||
          article.contentHash !== entry.contentHash
        ) {
          throw new Error("cache-entry-does-not-match-published-lesson");
        }
        return CacheEntrySchema.parse({ ...entry, lessonPath });
      });
      cache = CacheIndexSchema.parse({
        schemaVersion: 1,
        entries: [...entries, ...current.entries.filter((item) => !entries.some((entry) => entry.canonicalUrl === item.canonicalUrl))],
      });
    }
    const pending = PendingPublicationSchema.parse({ schemaVersion: 1, lesson, lessonPath, index, ...(ledger === undefined ? {} : { ledger }), ...(cache === undefined ? {} : { cache }) });
    await this.writeJsonAtomic(this.pendingPath(), pending);
    await this.applyPending(pending);
  }

  private async recoverPending(): Promise<void> {
    const pending = await this.readJson(this.pendingPath(), null, PendingPublicationSchema.nullable());
    if (pending !== null) await this.applyPending(pending);
  }

  private async applyPending(pending: z.infer<typeof PendingPublicationSchema>): Promise<void> {
    await this.writeVersionedLesson(pending.lessonPath, pending.lesson);
    if (pending.ledger !== undefined) await this.writeJsonAtomic(this.ledgerPath(), pending.ledger);
    if (pending.cache !== undefined) await this.writeJsonAtomic(this.cachePath(), pending.cache);
    await this.writeJsonAtomic(this.indexPath(), pending.index);
    await this.removeIfPresent(this.pendingPath());
  }

  private async writeVersionedLesson(lessonPath: string, lesson: DailyLesson): Promise<void> {
    const path = this.lessonFilePath(lessonPath);
    try {
      const existing = await this.files.readFile(path, "utf8");
      const parsed = DailyLessonSchema.parse(JSON.parse(existing));
      if (JSON.stringify(parsed) !== JSON.stringify(lesson)) throw new Error("lesson-version-conflict");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.writeJsonAtomic(path, lesson);
    }
  }

  private async loadLedgerRaw(): Promise<EditorialLedger> {
    return this.readJson(this.ledgerPath(), { schemaVersion: 1, days: [] }, EditorialLedgerSchema);
  }

  private async loadIndexRaw(): Promise<LessonIndex> {
    return this.readJson(this.indexPath(), { schemaVersion: 1, dates: [] }, LessonIndexSchema);
  }

  private async loadCacheRaw(): Promise<CacheIndex> {
    return this.readJson(this.cachePath(), { schemaVersion: 1, entries: [] }, CacheIndexSchema);
  }

  private async readJson<T>(path: string, fallback: T, schema: z.ZodType<T>): Promise<T> {
    let raw: string;
    try {
      raw = await this.files.readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return schema.parse(fallback);
      throw error;
    }
    return schema.parse(JSON.parse(raw));
  }

  private async writeJsonAtomic(path: string, value: unknown): Promise<void> {
    await this.files.mkdir(dirname(path), { recursive: true });
    const temporary = join(dirname(path), `.${path.split("/").at(-1) ?? "data"}.${randomUUID()}.tmp`);
    try {
      await this.files.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      await this.options.beforeRename?.(path);
      await this.files.rename(temporary, path);
    } finally {
      await this.removeIfPresent(temporary);
    }
  }

  private async removeIfPresent(path: string): Promise<void> {
    await this.files.unlink(path).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }

  private versionedLessonPath(lesson: DailyLesson): string {
    const hash = createHash("sha256").update(JSON.stringify(lesson)).digest("hex").slice(0, 16);
    return LessonPathSchema.parse(`data/lessons/${lesson.date}-${hash}.json`);
  }

  private lessonFilePath(lessonPath: string): string { return join(this.root, "public", LessonPathSchema.parse(lessonPath)); }
  private pendingPath(): string { return join(this.root, "data/pending-publication.json"); }
  private ledgerPath(): string { return join(this.root, "data/editorial-ledger.json"); }
  private cachePath(): string { return join(this.root, "data/cache/index.json"); }
  private indexPath(): string { return join(this.root, "public/data/index.json"); }
}
