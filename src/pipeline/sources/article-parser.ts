import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { Source } from "../../contracts/content";
import type { SourceArticle } from "../../contracts/transient";
import { classifyAccess } from "./access";
import { isNewsArticle, jsonLdNodes, plainTextFromHtml } from "./json-ld";
import { sourceDomainMatches } from "./source-url";

function normalizeCanonical(raw: string, base: string): string {
  const canonical = new URL(raw, base);
  canonical.hash = "";
  for (const key of [...canonical.searchParams.keys()]) {
    if (/^(?:utm_|fbclid|gclid|mc_|igshid|cmpid|ref)/iu.test(key)) {
      canonical.searchParams.delete(key);
    }
  }
  return canonical.toString();
}

export function parseArticle(source: Source, url: string, html: string): SourceArticle {
  const access = classifyAccess(source, html);
  if (!access.accessible) throw new Error("article-access-denied:" + access.reason);
  if (!sourceDomainMatches(url, source)) {
    throw new Error("article-source-domain-mismatch:" + source + ":" + url);
  }

  const $ = load(html);
  const newsNode = jsonLdNodes(html).find(isNewsArticle);
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
  if (!sourceDomainMatches(canonicalUrl, source)) {
    throw new Error("article-source-domain-mismatch:" + source + ":" + canonicalUrl);
  }
  const bodyFromJson =
    typeof newsNode?.articleBody === "string" ? plainTextFromHtml(newsNode.articleBody) : "";
  const bodyFromDom = $("article p, main p")
      .map((_, element) => $(element).text().replace(/\s+/gu, " ").trim())
      .get()
      .filter((paragraph) => paragraph.length >= 30)
      .join("\n\n");
  const body = wordCount(bodyFromJson) >= 180 ? bodyFromJson : bodyFromDom;

  if (!title || !publishedAt) throw new Error(`article-parse-incomplete:${source}:${url}`);
  if (wordCount(body) < 180) throw new Error("article-body-insufficient:" + source + ":" + url);

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

function wordCount(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length;
}
