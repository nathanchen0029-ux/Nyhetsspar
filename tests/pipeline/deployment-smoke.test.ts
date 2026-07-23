import { afterEach, describe, expect, it, vi } from "vitest";
import { smokeDeployment } from "../../scripts/smoke-deployment";

const lessonPath = "data/lessons/2026-07-23-0123456789abcdef.json";
const delayedLesson = {
  schemaVersion: 1,
  date: "2026-07-23",
  timezone: "Europe/Stockholm",
  generatedAt: "2026-07-23T05:07:00.000Z",
  status: "delayed",
  sourceHealth: { svt: "ok", aftonbladet: "partial", dn: "failed" },
  selectionSummary: "No balanced issue was available.",
  articles: [],
};
const index = {
  schemaVersion: 1,
  dates: [{
    date: "2026-07-23",
    status: "delayed",
    lessonPath,
    articles: [],
  }],
};

function response(body: string, contentType: string): Response {
  return new Response(body, { headers: { "content-type": contentType } });
}

function installDeployment(
  homepage: string,
  overrides: Record<string, Response> = {},
) {
  const responses: Record<string, Response> = {
    "https://example.test/nyhetsspar/": response(homepage, "text/html"),
    "https://example.test/nyhetsspar/assets/app.js": response(
      "export {};",
      "text/javascript",
    ),
    "https://example.test/nyhetsspar/assets/app.css": response(
      "body{}",
      "text/css",
    ),
    "https://example.test/nyhetsspar/data/index.json": response(
      JSON.stringify(index),
      "application/json",
    ),
    [`https://example.test/nyhetsspar/${lessonPath}`]: response(
      JSON.stringify(delayedLesson),
      "application/json",
    ),
    ...overrides,
  };
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    return responses[url] ?? new Response("missing", { status: 404 });
  });
}

const validHomepage = [
  "<!doctype html>",
  '<script type="module" src="/nyhetsspar/assets/app.js"></script>',
  '<link rel="stylesheet" href="./assets/app.css">',
].join("\n");

describe("deployment smoke test", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads same-origin project-base assets and reconciles index metadata with the lesson", async () => {
    const fetchMock = installDeployment(validHomepage);

    await smokeDeployment("https://example.test/nyhetsspar");

    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      "https://example.test/nyhetsspar/",
      "https://example.test/nyhetsspar/assets/app.js",
      "https://example.test/nyhetsspar/assets/app.css",
      "https://example.test/nyhetsspar/data/index.json",
      `https://example.test/nyhetsspar/${lessonPath}`,
    ]);
  });

  it.each([
    [
      '<script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="./assets/app.css">',
      "smoke-asset-outside-base",
    ],
    [
      '<script type="module" src="https://cdn.example/app.js"></script><link rel="stylesheet" href="./assets/app.css">',
      "smoke-asset-cross-origin",
    ],
  ])("rejects an unsafe asset URL", async (homepage, expected) => {
    installDeployment(homepage);

    await expect(
      smokeDeployment("https://example.test/nyhetsspar/"),
    ).rejects.toThrow(expected);
  });

  it("requires both the JavaScript and stylesheet build assets", async () => {
    installDeployment('<script type="module" src="./assets/app.js"></script>');

    await expect(
      smokeDeployment("https://example.test/nyhetsspar/"),
    ).rejects.toThrow("smoke-missing-build-assets");
  });

  it("rejects an SPA fallback page returned for a missing data file", async () => {
    installDeployment(validHomepage, {
      "https://example.test/nyhetsspar/data/index.json": response(
        validHomepage,
        "text/html",
      ),
    });

    await expect(
      smokeDeployment("https://example.test/nyhetsspar/"),
    ).rejects.toThrow("smoke-content-type:json");
  });

  it("rejects a lesson that does not exactly match its index projection", async () => {
    installDeployment(validHomepage, {
      [`https://example.test/nyhetsspar/${lessonPath}`]: response(
        JSON.stringify({ ...delayedLesson, date: "2026-07-24" }),
        "application/json",
      ),
    });

    await expect(
      smokeDeployment("https://example.test/nyhetsspar/"),
    ).rejects.toThrow("lesson-index-mismatch");
  });
});
