import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { classifyAccess } from "../../src/pipeline/sources/access";
import { parseArticle } from "../../src/pipeline/sources/article-parser";
import { createHttpFetcher } from "../../src/pipeline/sources/fetcher";
import { createRobotsGuard } from "../../src/pipeline/sources/robots";

describe("source safety core", () => {
  it("parses a public NewsArticle without persisting unrelated markup", async () => {
    const html = await readFile("tests/fixtures/sources/public-article.html", "utf8");
    const result = parseArticle("svt", "https://example.test/nyheter/offentlig", html);
    expect(result.title).toBe("Kommunerna får nya regler");
    expect(result.isAccessibleForFree).toBe(true);
    expect(result.body).toContain("sorteringen enklare");
    expect(result.body).not.toContain("<script");
  });

  it("rejects an explicit paywall", async () => {
    const html = await readFile("tests/fixtures/sources/paywalled-article.html", "utf8");
    expect(classifyAccess(html)).toEqual({
      accessible: false,
      reason: "structured-paywall",
    });
  });

  it.each([
    ["login-wall.html", "login-wall"],
    ["video-only.html", "video-only"],
    ["live-feed.html", "live-feed"],
  ])("rejects unstable or restricted text in %s", async (fixture, reason) => {
    const html = await readFile(`tests/fixtures/sources/${fixture}`, "utf8");
    expect(classifyAccess(html)).toEqual({ accessible: false, reason });
  });

  it("retries transient responses exactly twice", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const fetcher = createHttpFetcher({ fetchImpl, sleep: async () => undefined });
    const response = await fetcher.fetchText("https://example.test/article");
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not fetch a path disallowed by robots rules", async () => {
    const guard = createRobotsGuard({
      async fetchText(url) {
        return {
          url,
          status: 200,
          headers: new Headers(),
          text: "User-agent: *\nDisallow: /locked",
        };
      },
    });
    await expect(guard.isAllowed("https://example.test/locked/article")).resolves.toBe(false);
  });
});
