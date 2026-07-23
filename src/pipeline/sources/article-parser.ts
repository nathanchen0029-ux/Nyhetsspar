import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { Source } from "../../contracts/content";
import type { SourceArticle } from "../../contracts/transient";
import { classifyAccess } from "./access";

function jsonLdNodes(html: string): Record<string, unknown>[] {
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

function normalizeCanonical(raw: string, base: string): string {
  const canonical = new URL(raw, base);
  canonical.hash = "";
  for (const key of [...canonical.searchParams.keys()]) {
    if (/^(?:utm_|fbclid|cmpid|ref)/u.test(key)) canonical.searchParams.delete(key);
  }
  return canonical.toString();
}

export function parseArticle(source: Source, url: string, html: string): SourceArticle {
  const access = classifyAccess(html);
  const $ = load(html);
  const newsNode = jsonLdNodes(html).find((node) => {
    const type = node["@type"];
    return type === "NewsArticle" || (Array.isArray(type) && type.includes("NewsArticle"));
  });
  const title =
    (typeof newsNode?.headline === "string" ? newsNode.headline : undefined) ??
    $("h1").first().text().trim();
  const publishedAt =
    (typeof newsNode?.datePublished === "string" ? newsNode.datePublished : undefined) ??
    $("time[datetime]").first().attr("datetime");
  const canonicalUrl = normalizeCanonical(
    $("link[rel=\"canonical\"]").attr("href") ??
      (typeof newsNode?.url === "string" ? newsNode.url : url),
    url,
  );
  const bodyFromJson = typeof newsNode?.articleBody === "string" ? newsNode.articleBody.trim() : "";
  const body =
    bodyFromJson ||
    $("article p, main p")
      .map((_, element) => $(element).text().replace(/\s+/gu, " ").trim())
      .get()
      .filter((paragraph) => paragraph.length >= 30)
      .join("\n\n");

  if (!title || !publishedAt || !body) throw new Error(`article-parse-incomplete:${source}:${url}`);

  return {
    id: createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 16),
    source,
    url,
    canonicalUrl,
    title,
    publishedAt: new Date(publishedAt).toISOString(),
    body,
    contentHash: `sha256:${createHash("sha256").update(body).digest("hex")}`,
    isAccessibleForFree: access.accessible,
  };
}
