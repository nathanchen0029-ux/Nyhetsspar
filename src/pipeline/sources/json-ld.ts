import { load } from "cheerio";

const TRACKING_PARAMETER = /^(?:utm_|fbclid|gclid|mc_|igshid|cmpid|ref)/iu;

export function jsonLdNodes(html: string): Record<string, unknown>[] {
  const $ = load(html);
  const nodes: Record<string, unknown>[] = [];
  $("script[type=\"application/ld+json\"]").each((_, element) => {
    try {
      const parsed: unknown = JSON.parse($(element).text());
      const values = Array.isArray(parsed)
        ? parsed
        : typeof parsed === "object" && parsed !== null && "@graph" in parsed
          ? (parsed as { "@graph": unknown[] })["@graph"]
          : [parsed];
      for (const value of values) {
        if (typeof value === "object" && value !== null) nodes.push(value as Record<string, unknown>);
      }
    } catch {
      return;
    }
  });
  return nodes;
}

export function isNewsArticle(node: Record<string, unknown>): boolean {
  const type = node["@type"];
  return type === "NewsArticle" || (Array.isArray(type) && type.includes("NewsArticle"));
}

export function normalizeArticleUrl(raw: string, base: string): string {
  const normalized = new URL(raw, base);
  normalized.hash = "";
  for (const key of [...normalized.searchParams.keys()]) {
    if (TRACKING_PARAMETER.test(key)) normalized.searchParams.delete(key);
  }
  return normalized.toString();
}

export function canonicalUrlFromHtml(html: string, pageUrl: string): string | undefined {
  const raw = load(html)('link[rel="canonical"]').attr("href");
  if (!raw) return undefined;
  try {
    return normalizeArticleUrl(raw, pageUrl);
  } catch {
    return undefined;
  }
}

export function selectCurrentArticleNode(
  nodes: Record<string, unknown>[],
  pageUrl: string,
  canonicalUrl: string,
): Record<string, unknown> | undefined {
  const articles = nodes.filter(isNewsArticle);
  if (articles.length === 1) return articles[0];
  if (articles.length === 0) return undefined;

  const candidates = new Set([
    comparableUrl(normalizeArticleUrl(pageUrl, pageUrl)),
    comparableUrl(normalizeArticleUrl(canonicalUrl, pageUrl)),
  ]);
  const matches = articles.filter((article) =>
    articleIdentifiers(article).some((identifier) => {
      try {
        return candidates.has(comparableUrl(normalizeArticleUrl(identifier, pageUrl)));
      } catch {
        return false;
      }
    }),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export function plainTextFromHtml(html: string): string {
  const withBlockBreaks = html.replace(/<\/(?:article|div|li|p|section)>/giu, " ");
  return load(withBlockBreaks)("body").text().replace(/\s+/gu, " ").trim();
}

function comparableUrl(url: string): string {
  const normalized = new URL(url);
  if (normalized.pathname.length > 1) normalized.pathname = normalized.pathname.replace(/\/+$/u, "");
  return normalized.toString();
}

function articleIdentifiers(node: Record<string, unknown>): string[] {
  const values = [node.url, node["@id"], node.mainEntityOfPage];
  const identifiers: string[] = [];
  for (const value of values) {
    if (typeof value === "string") identifiers.push(value);
    if (typeof value === "object" && value !== null) {
      const entity = value as Record<string, unknown>;
      if (typeof entity["@id"] === "string") identifiers.push(entity["@id"]);
      if (typeof entity.url === "string") identifiers.push(entity.url);
    }
  }
  return identifiers;
}
