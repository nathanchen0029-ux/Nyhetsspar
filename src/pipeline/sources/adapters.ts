import type { SourceAdapter } from "../../contracts/transient";
import { discoverFromHtmlPages, discoverFromRss } from "./discovery";

const svt: SourceAdapter = {
  source: "svt",
  discover(now, fetcher) {
    return discoverFromHtmlPages(
      "svt",
      ["https://www.svt.se/nyheter", "https://www.svt.se/sport"],
      /^\/(?:nyheter|sport)\//u,
      now,
      fetcher,
    );
  },
};

const aftonbladet: SourceAdapter = {
  source: "aftonbladet",
  discover(now, fetcher) {
    return discoverFromRss(
      "aftonbladet",
      [
        "https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/",
        "https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/sport/",
        "https://rss.aftonbladet.se/rss2/small/pages/sections/kultur/",
      ],
      now,
      fetcher,
    );
  },
};

const dn: SourceAdapter = {
  source: "dn",
  discover(now, fetcher) {
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
    );
  },
};

export function createSourceAdapters(): SourceAdapter[] {
  return [svt, aftonbladet, dn];
}
