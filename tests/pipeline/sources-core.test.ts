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
    expect(classifyAccess("svt", html)).toEqual({
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
    expect(classifyAccess("svt", html)).toEqual({ accessible: false, reason });
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

  it.each(["aftonbladet", "dn"] as const)(
    "requires structured public-access confirmation for %s",
    async (source) => {
      const html = (await readFile("tests/fixtures/sources/public-article.html", "utf8")).replace(
        '"isAccessibleForFree": true',
        '"section": "nyheter"',
      );
      expect(classifyAccess(source, html)).toEqual({
        accessible: false,
        reason: "public-access-unconfirmed",
      });
    },
  );

  it("accepts stable public SVT text without JSON-LD access confirmation", () => {
    const html = "<main><article><p>" + "stabil offentlig text ".repeat(180) + "</p></article></main>";
    expect(classifyAccess("svt", html)).toEqual({ accessible: true, reason: "public" });
  });

  it("throws a safety error instead of returning a restricted article body", async () => {
    const html = await readFile("tests/fixtures/sources/paywalled-article.html", "utf8");
    expect(() => parseArticle("svt", "https://example.test/locked", html)).toThrow(
      "article-access-denied:structured-paywall",
    );
  });

  it("turns JSON-LD article HTML into normalized plain text before hashing", () => {
    const html = newsHtml({
      articleBody: "<p>Första <strong>stycket</strong>.</p><p>Andra&nbsp; stycket.</p>",
    });
    const result = parseArticle("svt", "https://svt.se/nyheter/ren", html);
    expect(result.body).toBe("Första stycket. Andra stycket.");
    expect(result.contentHash).toContain("sha256:");
    expect(result.body).not.toContain("<strong>");
  });

  it("rejects a real request domain that does not match its declared source", () => {
    const html = newsHtml();
    expect(() => parseArticle("svt", "https://www.dn.se/nyheter/fel", html)).toThrow(
      "article-source-domain-mismatch",
    );
  });

  it("rejects a real canonical domain that does not match its declared source", () => {
    const html = newsHtml({ canonical: "https://www.dn.se/nyheter/fel" });
    expect(() => parseArticle("svt", "https://svt.se/nyheter/ratt", html)).toThrow(
      "article-source-domain-mismatch",
    );
  });

  it("normalizes relative canonicals and case-insensitive tracking parameters", () => {
    const html = newsHtml({
      canonical:
        "/nyheter/ratt?UTM_Source=x&gclid=a&MC_id=b&IGSHID=c&fbclid=d&cmpid=e&ref=f&keep=ok#fragment",
    });
    expect(parseArticle("svt", "https://svt.se/start", html).canonicalUrl).toBe(
      "https://svt.se/nyheter/ratt?keep=ok",
    );
  });
});

function newsHtml(options: { articleBody?: string; canonical?: string } = {}): string {
  const articleBody = options.articleBody ?? "JSON-LD-kropp som inte ska användas när den saknas.";
  const canonical = options.canonical ?? "/nyheter/ratt";
  return [
    "<html><head>",
    '<link rel="canonical" href="' + canonical + '" />',
    '<script type="application/ld+json">',
    '{"@type":"NewsArticle","headline":"Rubrik","datePublished":"2026-07-23T04:00:00Z","isAccessibleForFree":true,"articleBody":' + JSON.stringify(articleBody) + "}",
    "</script></head><body><main><article><p>",
    "stabil offentlig text ".repeat(180),
    "</p></article></main></body></html>",
  ].join("");
}
