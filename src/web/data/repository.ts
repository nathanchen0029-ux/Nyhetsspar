import {
  DailyLessonSchema,
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
    return DailyLessonSchema.parse(await getJson(entry.lessonPath));
  }
}
