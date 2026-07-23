import { load } from "cheerio";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Source } from "../../contracts/content";
import type { CandidateLink, Fetcher, UrlAccessGuard } from "../../contracts/transient";
import { fetchPublicSourceText } from "./fetcher";
import { sourceDomainMatches } from "./source-url";

const MAX_CANDIDATES_PER_SOURCE = 40;
const TRACKING_PARAMETER = /^(?:utm_|fbclid|gclid|dclid|msclkid|_ga|mc_|igshid|cmp(?:id)?|ref(?:_|$)|source|campaign|s_cid|wt_|trk|tracking)/iu;

export async function discoverFromHtmlPages(
  source: Source,
  pages: string[],
  allowedPath: RegExp,
  now: Date,
  fetcher: Fetcher,
  robots: UrlAccessGuard,
): Promise<CandidateLink[]> {
  const found = new Map<string, CandidateLink>();
  for (const page of pages) {
    const response = await fetchDiscoveryPage(source, page, fetcher, robots);
    if (!response) continue;
    const $ = load(response.text);
    $("a[href]").each((_, element) => {
      const href = $(element).attr("href");
      const title = $(element).text().replace(/\s+/gu, " ").trim();
      if (!href || title.length < 12) return;

      const url = normalizeCandidateUrl(href, page, source);
      if (!url || !matchesAllowedPath(url, allowedPath)) return;
      found.set(url, candidate(source, url, title, now, page));
    });
  }
  return [...found.values()].slice(0, MAX_CANDIDATES_PER_SOURCE);
}

export async function discoverFromRss(
  source: Source,
  feeds: string[],
  now: Date,
  fetcher: Fetcher,
  robots: UrlAccessGuard,
): Promise<CandidateLink[]> {
  const parser = new XMLParser({ ignoreAttributes: false });
  const found = new Map<string, CandidateLink>();
  for (const feed of feeds) {
    const response = await fetchDiscoveryPage(source, feed, fetcher, robots);
    if (!response || XMLValidator.validate(response.text) !== true) continue;
    const parsed = parser.parse(response.text) as { rss?: { channel?: { item?: unknown | unknown[] } } };
    const rawItems = parsed.rss?.channel?.item;
    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
    for (const raw of items) {
      if (typeof raw !== "object" || raw === null) continue;
      const item = raw as { title?: unknown; link?: unknown };
      if (typeof item.title !== "string" || typeof item.link !== "string") continue;

      const url = normalizeCandidateUrl(item.link, feed, source);
      if (!url) continue;
      found.set(url, candidate(source, url, item.title.trim(), now, feed));
    }
  }
  return [...found.values()].slice(0, MAX_CANDIDATES_PER_SOURCE);
}

async function fetchDiscoveryPage(
  source: Source,
  url: string,
  fetcher: Fetcher,
  robots: UrlAccessGuard,
): Promise<{ text: string } | undefined> {
  try {
    return await fetchPublicSourceText(source, url, fetcher, robots);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("initial-robots-disallowed:")) return undefined;
    throw error;
  }
}

function candidate(source: Source, url: string, title: string, now: Date, discoveryPage: string): CandidateLink {
  return {
    source,
    url,
    discoveredTitle: title,
    discoveredAt: now.toISOString(),
    sectionHint: new URL(discoveryPage).pathname,
  };
}

function normalizeCandidateUrl(raw: string, base: string, source: Source): string | undefined {
  try {
    const url = new URL(raw, base);
    if (url.protocol !== "https:" || !sourceDomainMatches(url.toString(), source)) return undefined;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMETER.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function matchesAllowedPath(url: string, allowedPath: RegExp): boolean {
  allowedPath.lastIndex = 0;
  return allowedPath.test(new URL(url).pathname);
}
