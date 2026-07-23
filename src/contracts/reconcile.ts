import {
  DailyLessonSchema,
  LessonIndexEntrySchema,
  type DailyLesson,
  type LessonIndex,
} from "./content";

export function reconcileLessonIndexEntry(
  rawEntry: LessonIndex["dates"][number],
  rawLesson: DailyLesson,
): DailyLesson {
  const entry = LessonIndexEntrySchema.parse(rawEntry);
  const lesson = DailyLessonSchema.parse(rawLesson);
  const articlesMatch =
    lesson.articles.length === entry.articles.length &&
    lesson.articles.every((article, index) => {
      const indexed = entry.articles[index];
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
    lesson.date !== entry.date ||
    lesson.status !== entry.status ||
    !articlesMatch
  ) {
    throw new Error("lesson-index-mismatch");
  }
  return lesson;
}
