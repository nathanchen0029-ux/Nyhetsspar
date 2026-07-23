import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  DailyLessonSchema,
  EditorialLedgerSchema,
  LessonIndexSchema,
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
}).strict();
const CacheIndexSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(CacheEntrySchema),
}).strict();

export type CacheEntry = z.infer<typeof CacheEntrySchema>;
export type CacheIndex = z.infer<typeof CacheIndexSchema>;

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
  cacheEntries?: CacheEntry[];
}

export interface DailyRepository {
  loadLedger(): Promise<EditorialLedger>;
  lessonExists(date: string): Promise<boolean>;
  findCachedLesson(canonicalUrl: string, contentHash: string): Promise<LessonArticle | null>;
  publishDaily(publication: DailyPublication): Promise<void>;
}

function indexEntry(lesson: DailyLesson): LessonIndex["dates"][number] {
  return {
    date: lesson.date,
    status: lesson.status,
    articles: lesson.articles.map((article) => ({
      id: article.id,
      title: article.studyTitle,
      source: article.source,
      scope: article.scope,
      topic: article.topic,
      difficulty: article.difficulty.level,
      isFollowUp: article.isFollowUp,
    })),
  };
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
    return this.readJson(this.ledgerPath(), { schemaVersion: 1, days: [] }, EditorialLedgerSchema);
  }

  async saveLedger(ledger: EditorialLedger): Promise<void> {
    await this.writeJsonAtomic(this.ledgerPath(), EditorialLedgerSchema.parse(ledger));
  }

  async loadIndex(): Promise<LessonIndex> {
    return this.readJson(this.indexPath(), { schemaVersion: 1, dates: [] }, LessonIndexSchema);
  }

  async lessonExists(date: string): Promise<boolean> {
    const validDate = DateSchema.parse(date);
    return (await this.loadIndex()).dates.some((entry) => entry.date === validDate && entry.status === "ready");
  }

  async loadLesson(date: string): Promise<DailyLesson | null> {
    const validDate = DateSchema.parse(date);
    return this.readJson(this.lessonPath(validDate), null, DailyLessonSchema);
  }

  async saveLesson(lesson: DailyLesson): Promise<void> {
    await this.publishDaily({ lesson });
  }

  async saveCacheEntry(entry: CacheEntry): Promise<void> {
    const valid = CacheEntrySchema.parse(entry);
    const current = await this.loadCache();
    const entries = [valid, ...current.entries.filter((item) => item.canonicalUrl !== valid.canonicalUrl)];
    await this.writeJsonAtomic(this.cachePath(), CacheIndexSchema.parse({ schemaVersion: 1, entries }));
  }

  async findCachedLesson(canonicalUrl: string, contentHash: string): Promise<LessonArticle | null> {
    const entry = (await this.loadCache()).entries.find(
      (item) => item.canonicalUrl === canonicalUrl && item.contentHash === contentHash,
    );
    if (!entry) return null;
    const lesson = await this.loadLesson(entry.lessonDate);
    return lesson?.articles.find((article) => article.id === entry.lessonId) ?? null;
  }

  async publishDaily(publication: DailyPublication): Promise<void> {
    const lesson = DailyLessonSchema.parse(publication.lesson);
    const currentIndex = await this.loadIndex();
    const nextIndex = LessonIndexSchema.parse({
      schemaVersion: 1,
      dates: [indexEntry(lesson), ...currentIndex.dates.filter((entry) => entry.date !== lesson.date)]
        .sort((left, right) => right.date.localeCompare(left.date)),
    });
    const nextLedger = publication.ledger === undefined ? undefined : EditorialLedgerSchema.parse(publication.ledger);
    let nextCache: CacheIndex | undefined;
    if (publication.cacheEntries !== undefined) {
      const currentCache = await this.loadCache();
      const entries = CacheEntrySchema.array().parse(publication.cacheEntries);
      nextCache = CacheIndexSchema.parse({
        schemaVersion: 1,
        entries: [
          ...entries,
          ...currentCache.entries.filter((current) => !entries.some((entry) => entry.canonicalUrl === current.canonicalUrl)),
        ],
      });
    }

    await this.writeJsonAtomic(this.lessonPath(lesson.date), lesson);
    if (nextLedger) await this.writeJsonAtomic(this.ledgerPath(), nextLedger);
    if (nextCache) await this.writeJsonAtomic(this.cachePath(), nextCache);
    await this.writeJsonAtomic(this.indexPath(), nextIndex);
  }

  private async loadCache(): Promise<CacheIndex> {
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
      await this.files.unlink(temporary).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
    }
  }

  private ledgerPath(): string { return join(this.root, "data/editorial-ledger.json"); }
  private cachePath(): string { return join(this.root, "data/cache/index.json"); }
  private indexPath(): string { return join(this.root, "public/data/index.json"); }
  private lessonPath(date: string): string { return join(this.root, "public/data/lessons", `${DateSchema.parse(date)}.json`); }
}
