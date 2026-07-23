import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { Fetcher } from "../../src/contracts/transient";
import { createSourceAdapters } from "../../src/pipeline/sources/adapters";
import { discoverFromHtmlPages, discoverFromRss } from "../../src/pipeline/sources/discovery";

function fixtureFetcher(fixtures: Record<string, string>): Fetcher {
  return {
    async fetchText(url) {
      const text = fixtures[url];
      if (!text) throw new Error(`missing-fixture:${url}`);
      return { url, status: 200, headers: new Headers({ "content-type": "text/html" }), text };
    },
  };
}

describe("source adapters", () => {
  it("discovers normalized same-source HTTPS candidates in declared adapter order", async () => {
    const [feed, svt, dn] = await Promise.all([
      readFile("tests/fixtures/sources/aftonbladet-feed.xml", "utf8"),
      readFile("tests/fixtures/sources/svt-section.html", "utf8"),
      readFile("tests/fixtures/sources/dn-section.html", "utf8"),
    ]);
    const fetcher = fixtureFetcher({
      "https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/": feed,
      "https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/sport/": feed,
      "https://rss.aftonbladet.se/rss2/small/pages/sections/kultur/": feed,
      "https://www.svt.se/nyheter": svt,
      "https://www.svt.se/sport": svt,
      "https://www.dn.se/sverige/": dn,
      "https://www.dn.se/varlden/": dn,
      "https://www.dn.se/ekonomi/": dn,
      "https://www.dn.se/kultur/": dn,
      "https://www.dn.se/sport/": dn,
    });

    const adapters = createSourceAdapters();
    const results = await Promise.all(adapters.map((adapter) => adapter.discover(new Date("2026-07-23T05:00:00Z"), fetcher)));

    expect(adapters.map((adapter) => adapter.source)).toEqual(["svt", "aftonbladet", "dn"]);
    expect(results.map((items) => items[0]?.source)).toEqual(["svt", "aftonbladet", "dn"]);
    expect(results.flat().map((item) => item.url)).toEqual([
      "https://www.svt.se/nyheter/inrikes/exempel?keep=1",
      "https://www.aftonbladet.se/nyheter/a/example/ny-svensk-regel?keep=1",
      "https://www.dn.se/sverige/nytt-forslag/",
    ]);
    expect(results.flat()).toHaveLength(3);
  });

  it("deduplicates candidates and caps each source at forty without fetching article bodies", async () => {
    const links = Array.from({ length: 42 }, (_, index) =>
      `<a href="/nyheter/test-${index}?utm_campaign=mail#top">Tillräckligt lång rubrik nummer ${index}</a>`,
    ).join("");
    const calls: string[] = [];
    const fetcher: Fetcher = {
      async fetchText(url) {
        calls.push(url);
        return { url, status: 200, headers: new Headers(), text: `<body>${links}${links}</body>` };
      },
    };

    const candidates = await discoverFromHtmlPages(
      "svt",
      ["https://www.svt.se/nyheter"],
      /^\/nyheter\//u,
      new Date("2026-07-23T05:00:00Z"),
      fetcher,
    );

    expect(candidates).toHaveLength(40);
    expect(new Set(candidates.map((candidate) => candidate.url)).size).toBe(40);
    expect(candidates.every((candidate) => !candidate.url.includes("utm_campaign") && !candidate.url.includes("#"))).toBe(true);
    expect(calls).toEqual(["https://www.svt.se/nyheter"]);
  });

  it("rejects cross-source, non-HTTPS, and malformed RSS links", async () => {
    const candidates = await discoverFromRss(
      "dn",
      ["https://www.dn.se/feed"],
      new Date("2026-07-23T05:00:00Z"),
      fixtureFetcher({
        "https://www.dn.se/feed": [
          "<rss><channel>",
          "<item><title>Godkänd rubrik</title><link>https://www.dn.se/sverige/godkand?mc_cid=x</link></item>",
          "<item><title>Fel domän</title><link>https://www.svt.se/nyheter/fel</link></item>",
          "<item><title>Fel protokoll</title><link>http://www.dn.se/sverige/fel</link></item>",
          "<item><title>Fel format</title><link>javascript:alert(1)</link></item>",
          "</channel></rss>",
        ].join(""),
      }),
    );

    expect(candidates.map((candidate) => candidate.url)).toEqual(["https://www.dn.se/sverige/godkand"]);
  });
});
