import {
  DailyLessonSchema,
  LessonIndexEntrySchema,
  LessonIndexSchema,
  type DailyLesson,
  type LessonIndex,
} from "../../contracts/content";
import { reconcileLessonIndexEntry } from "../../contracts/reconcile";

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
    return reconcileLessonIndexEntry(parsedEntry, lesson);
  }
}
