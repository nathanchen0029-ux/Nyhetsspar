import type { SourceAdapter } from "../../contracts/transient";
import { discoverFromHtmlPages, discoverFromRss } from "./discovery";

const svt: SourceAdapter = {
  source: "svt",
  discover(now, fetcher, robots) {
    return discoverFromHtmlPages(
      "svt",
      ["https://www.svt.se/nyheter", "https://www.svt.se/sport"],
      /^\/(?:nyheter|sport)\//u,
      now,
      fetcher,
      robots,
    );
  },
};

const aftonbladet: SourceAdapter = {
  source: "aftonbladet",
  discover(now, fetcher, robots) {
    return discoverFromRss(
      "aftonbladet",
      [
        "https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/",
        "https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/sport/",
        "https://rss.aftonbladet.se/rss2/small/pages/sections/kultur/",
      ],
      now,
      fetcher,
      robots,
    );
  },
};

const dn: SourceAdapter = {
  source: "dn",
  discover(now, fetcher, robots) {
    return discoverFromHtmlPages(
      "dn",
      [
        "https://www.dn.se/sverige/",
        "https://www.dn.se/varlden/",
        "https://www.dn.se/ekonomi/",
        "https://www.dn.se/kultur/",
        "https://www.dn.se/sport/",
      ],
      /^\/(?:sverige|varlden|ekonomi|kultur|sport)\//u,
      now,
      fetcher,
      robots,
    );
  },
};

export function createSourceAdapters(): SourceAdapter[] {
  return [svt, aftonbladet, dn];
}
