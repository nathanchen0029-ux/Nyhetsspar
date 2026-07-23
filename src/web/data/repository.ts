import {
  DailyLessonSchema,
  LessonIndexEntrySchema,
  LessonIndexSchema,
  type DailyLesson,
  type LessonIndex,
} from "../../contracts/content";

const base = import.meta.env.BASE_URL;

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${base}${path.replace(/^\//u, "")}`);
  if (!response.ok) {
    throw new Error(`data-http-${response.status}:${path}`);
  }
  return response.json();
}

export class LessonRepository {
  async loadIndex(): Promise<LessonIndex> {
    return LessonIndexSchema.parse(await getJson("data/index.json"));
  }

  async loadLesson(entry: LessonIndex["dates"][number]): Promise<DailyLesson> {
    const parsedEntry = LessonIndexEntrySchema.parse(entry);
    const lesson = DailyLessonSchema.parse(await getJson(parsedEntry.lessonPath));
    const articlesMatch =
      lesson.articles.length === parsedEntry.articles.length &&
      lesson.articles.every((article, index) => {
        const indexed = parsedEntry.articles[index];
        return (
          indexed !== undefined &&
          indexed.id === article.id &&
          indexed.title === article.studyTitle &&
          indexed.source === article.source &&
          indexed.scope === article.scope &&
          indexed.topic === article.topic &&
          indexed.difficulty === article.difficulty.level &&
          indexed.isFollowUp === article.isFollowUp
        );
      });

    if (
      lesson.date !== parsedEntry.date ||
      lesson.status !== parsedEntry.status ||
      !articlesMatch
    ) {
      throw new Error("lesson-index-mismatch");
    }
    return lesson;
  }
}
