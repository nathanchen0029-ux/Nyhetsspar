import { load } from "cheerio";

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

export function plainTextFromHtml(html: string): string {
  const withBlockBreaks = html.replace(/<\/(?:article|div|li|p|section)>/giu, " ");
  return load(withBlockBreaks)("body").text().replace(/\s+/gu, " ").trim();
}
