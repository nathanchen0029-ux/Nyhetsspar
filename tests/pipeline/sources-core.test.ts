import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { classifyAccess } from "../../src/pipeline/sources/access";
import { parseArticle } from "../../src/pipeline/sources/article-parser";
import { createHttpFetcher, fetchPublicSourceText } from "../../src/pipeline/sources/fetcher";
import { createRobotsGuard } from "../../src/pipeline/sources/robots";

describe("source safety core", () => {
  it("parses a public NewsArticle without persisting unrelated markup", async () => {
    const html = await readFile("tests/fixtures/sources/public-article.html", "utf8");
    const result = parseArticle("svt", "https://www.svt.se/nyheter/offentlig", html);
    expect(result.title).toBe("Kommunerna får nya regler");
    expect(result.isAccessibleForFree).toBe(true);
    expect(result.body).toContain("sorteringen enklare");
    expect(result.body).not.toContain("<script");
  });

  it("rejects an explicit paywall", async () => {
    const html = await readFile("tests/fixtures/sources/paywalled-article.html", "utf8");
    expect(classifyAccess("svt", "https://www.svt.se/nyheter/låst", html)).toEqual({
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
    expect(classifyAccess("svt", "https://www.svt.se/nyheter/test", html)).toEqual({ accessible: false, reason });
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
      expect(classifyAccess(source, "https://www." + source + ".se/nyheter/test", html)).toEqual({
        accessible: false,
        reason: "public-access-unconfirmed",
      });
    },
  );

  it("accepts stable public SVT text without JSON-LD access confirmation", () => {
    const html = "<main><article><p>" + "stabil offentlig text ".repeat(180) + "</p></article></main>";
    expect(classifyAccess("svt", "https://www.svt.se/nyheter/test", html)).toEqual({ accessible: true, reason: "public" });
  });

  it("throws a safety error instead of returning a restricted article body", async () => {
    const html = await readFile("tests/fixtures/sources/paywalled-article.html", "utf8");
    expect(() => parseArticle("svt", "https://www.svt.se/locked", html)).toThrow(
      "article-access-denied:structured-paywall",
    );
  });

  it("turns JSON-LD article HTML into normalized plain text before hashing", () => {
    const html = newsHtml({
      articleBody: "<p>" + "Första <strong>stycket</strong>. ".repeat(180) + "</p>",
    });
    const result = parseArticle("svt", "https://svt.se/nyheter/ren", html);
    expect(result.body).toContain("Första stycket.");
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

  it("does not treat unrelated JSON-LD public access as confirmation", () => {
    const html = newsHtml({ extraJsonLd: '{"@type":"WebPage","isAccessibleForFree":true}' }).replace(
      '"isAccessibleForFree":true,',
      "",
    );
    expect(classifyAccess("dn", "https://www.dn.se/nyheter/test", html)).toEqual({
      accessible: false,
      reason: "public-access-unconfirmed",
    });
  });

  it("falls back to DOM text when JSON-LD articleBody is too short", () => {
    const result = parseArticle(
      "svt",
      "https://www.svt.se/nyheter/fallback",
      newsHtml({ articleBody: "Kort JSON-LD-text." }),
    );
    expect(result.body).toContain("stabil offentlig text");
  });

  it("rejects an article whose final body remains too short", () => {
    const html = newsHtml({ articleBody: "Kort." }).replace("stabil offentlig text ".repeat(180), "Kort DOM.");
    expect(() => parseArticle("svt", "https://www.svt.se/nyheter/kort", html)).toThrow(
      "article-access-denied:insufficient-text",
    );
  });

  it("rejects when DOM word counting passes but extracted paragraphs do not", () => {
    const shortParagraphs = Array.from({ length: 180 }, () => "<p>x</p>").join("");
    const html = newsHtml({ articleBody: "Kort." }).replace(
      "<p>" + "stabil offentlig text ".repeat(180) + "</p>",
      shortParagraphs,
    );
    expect(() => parseArticle("svt", "https://www.svt.se/nyheter/fragment", html)).toThrow(
      "article-body-insufficient",
    );
  });

  it("rejects redirects without a redirect guard", async () => {
    const fetcher = createHttpFetcher({
      fetchImpl: vi.fn().mockResolvedValue(new Response("", {
        status: 302,
        headers: { location: "https://www.svt.se/next" },
      })),
      sleep: async () => undefined,
    });
    await expect(fetcher.fetchText("https://www.svt.se/start")).rejects.toThrow("redirect-not-allowed");
  });

  it("checks robots before every redirect hop and does not request a denied destination", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 302, headers: { location: "/allowed" } }))
      .mockResolvedValueOnce(new Response("", { status: 302, headers: { location: "/denied" } }));
    const robots = { isAllowed: vi.fn().mockImplementation(async (url: string) => !url.endsWith("/denied")) };
    await expect(fetchPublicSourceText("svt", "https://www.svt.se/start", createHttpFetcher({
      fetchImpl,
      sleep: async () => undefined,
    }), robots)).rejects.toThrow("redirect-robots-disallowed");
    expect(robots.isAllowed).toHaveBeenCalledWith("https://www.svt.se/denied");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects a redirect to another source domain", async () => {
    const fetcher = createHttpFetcher({
      fetchImpl: vi.fn().mockResolvedValue(new Response("", {
        status: 302,
        headers: { location: "https://www.dn.se/other" },
      })),
      sleep: async () => undefined,
    });
    await expect(fetchPublicSourceText("svt", "https://www.svt.se/start", fetcher, {
      isAllowed: async () => true,
    })).rejects.toThrow("redirect-source-domain-mismatch");
  });

  it("rejects the sixth redirect hop", async () => {
    const fetcher = createHttpFetcher({
      fetchImpl: vi.fn().mockImplementation(() => new Response("", {
        status: 302,
        headers: { location: "/next" },
      })),
      sleep: async () => undefined,
    });
    await expect(fetcher.fetchText("https://www.svt.se/start", {
      redirectGuard: async () => true,
    })).rejects.toThrow("redirect-limit-exceeded");
  });

  it("does not allow .test URLs in production parsing", () => {
    expect(() => parseArticle("svt", "https://example.test/nyheter", newsHtml())).toThrow(
      "article-source-domain-mismatch",
    );
  });

  it("does not accept a related NewsArticle public flag for the current DN page", () => {
    const html = multiArticleHtml({
      relatedAccessible: true,
    });
    expect(classifyAccess("dn", "https://www.dn.se/nyheter/current", html)).toEqual({
      accessible: false,
      reason: "public-access-unconfirmed",
    });
  });

  it("uses the URL-matched current NewsArticle when related coverage appears first", () => {
    const result = parseArticle("dn", "https://www.dn.se/nyheter/current", multiArticleHtml({
      currentAccessible: true,
      relatedAccessible: true,
    }));
    expect(result.title).toBe("Aktuell rubrik");
    expect(result.body).toContain("Aktuell brödtext");
    expect(result.body).not.toContain("Relaterad brödtext");
  });

  it("fails closed for DN when multiple NewsArticles cannot be uniquely bound", () => {
    const html = multiArticleHtml({
      relatedAccessible: true,
      unmatched: true,
    });
    expect(classifyAccess("dn", "https://www.dn.se/nyheter/current", html)).toEqual({
      accessible: false,
      reason: "public-access-unconfirmed",
    });
  });
});

function newsHtml(options: { articleBody?: string; canonical?: string; extraJsonLd?: string } = {}): string {
  const articleBody = options.articleBody ?? "JSON-LD-kropp som inte ska användas när den saknas.";
  const canonical = options.canonical ?? "/nyheter/ratt";
  return [
    "<html><head>",
    '<link rel="canonical" href="' + canonical + '" />',
    '<script type="application/ld+json">',
    '{"@type":"NewsArticle","headline":"Rubrik","datePublished":"2026-07-23T04:00:00Z","isAccessibleForFree":true,"articleBody":' + JSON.stringify(articleBody) + "}",
    "</script>",
    options.extraJsonLd ? '<script type="application/ld+json">' + options.extraJsonLd + "</script>" : "",
    "</head><body><main><article><p>",
    "stabil offentlig text ".repeat(180),
    "</p></article></main></body></html>",
  ].join("");
}

function multiArticleHtml(options: {
  currentAccessible?: boolean;
  relatedAccessible?: boolean;
  unmatched?: boolean;
}): string {
  const currentUrl = options.unmatched ? "https://www.dn.se/nyheter/other" : "https://www.dn.se/nyheter/current";
  const current = {
    "@type": "NewsArticle",
    url: currentUrl,
    headline: "Aktuell rubrik",
    datePublished: "2026-07-23T04:00:00Z",
    articleBody: "Aktuell brödtext ".repeat(180),
  } as Record<string, unknown>;
  const related = {
    "@type": "NewsArticle",
    url: "https://www.dn.se/nyheter/related",
    headline: "Relaterad rubrik",
    datePublished: "2026-07-22T04:00:00Z",
    articleBody: "Relaterad brödtext ".repeat(180),
  } as Record<string, unknown>;
  if (options.currentAccessible !== undefined) current.isAccessibleForFree = options.currentAccessible;
  if (options.relatedAccessible !== undefined) related.isAccessibleForFree = options.relatedAccessible;
  return [
    '<link rel="canonical" href="https://www.dn.se/nyheter/current" />',
    '<script type="application/ld+json">',
    JSON.stringify([related, current]),
    "</script><main><article><p>",
    "DOM text ".repeat(180),
    "</p></article></main>",
  ].join("");
}
