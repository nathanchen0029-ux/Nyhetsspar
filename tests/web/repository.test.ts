import { afterEach, describe, expect, it, vi } from "vitest";
import { LessonRepository } from "../../src/web/data/repository";

const lessonPath = "data/lessons/2026-07-23-0123456789abcdef.json";
const indexPayload = {
  schemaVersion: 1,
  dates: [
    {
      date: "2026-07-23",
      status: "delayed",
      lessonPath,
      articles: [],
    },
  ],
};
const lessonPayload = {
  schemaVersion: 1,
  date: "2026-07-23",
  timezone: "Europe/Stockholm",
  generatedAt: "2026-07-23T05:05:00.000Z",
  status: "delayed",
  sourceHealth: { svt: "ok", aftonbladet: "partial", dn: "failed" },
  selectionSummary: "No balanced issue was available.",
  articles: [],
};

describe("LessonRepository", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the exact content-hashed lesson path from the parsed index entry", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(indexPayload)))
      .mockResolvedValueOnce(new Response(JSON.stringify(lessonPayload)));
    const repository = new LessonRepository();

    const index = await repository.loadIndex();
    const lesson = await repository.loadLesson(index.dates[0]!);

    expect(lesson.date).toBe("2026-07-23");
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/data/index.json",
      `/${lessonPath}`,
    ]);
  });

  it("rejects non-successful data responses before parsing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("missing", { status: 404 }),
    );

    await expect(new LessonRepository().loadIndex()).rejects.toThrow(
      "data-http-404:data/index.json",
    );
  });
});
