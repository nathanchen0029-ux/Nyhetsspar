import { load } from "cheerio";

export type AccessDecision =
  | { accessible: true; reason: "public" }
  | {
      accessible: false;
      reason:
        | "structured-paywall"
        | "login-wall"
        | "paywall-marker"
        | "video-only"
        | "live-feed"
        | "insufficient-text";
    };

export function classifyAccess(html: string): AccessDecision {
  const $ = load(html);
  const scripts = $("script[type=\"application/ld+json\"]")
    .map((_, element) => $(element).text())
    .get();

  for (const raw of scripts) {
    try {
      const data: unknown = JSON.parse(raw);
      const nodes = Array.isArray(data)
        ? data
        : typeof data === "object" && data !== null && "@graph" in data
          ? (data as { "@graph": unknown[] })["@graph"]
          : [data];
      for (const node of nodes) {
        if (
          typeof node === "object" &&
          node !== null &&
          "isAccessibleForFree" in node &&
          (node as { isAccessibleForFree: unknown }).isAccessibleForFree === false
        ) {
          return { accessible: false, reason: "structured-paywall" };
        }
      }
    } catch {
      continue;
    }
  }

  const pageText = $("body").text().replace(/\s+/gu, " ").toLowerCase();
  if (/logga in för att läsa|sign in to continue/u.test(pageText)) {
    return { accessible: false, reason: "login-wall" };
  }
  if (/prenumerera för att läsa|endast för prenumeranter|plusartikel/u.test(pageText)) {
    return { accessible: false, reason: "paywall-marker" };
  }

  const articleText = $("article p, main p")
    .map((_, element) => $(element).text().trim())
    .get()
    .join(" ");
  const articleWordCount = articleText.split(/\s+/u).filter(Boolean).length;
  if ($("video").length > 0 && articleWordCount < 80) {
    return { accessible: false, reason: "video-only" };
  }
  if ($(".live-feed, [data-live], [data-testid*='live']").length > 0 && articleWordCount < 200) {
    return { accessible: false, reason: "live-feed" };
  }
  if (articleWordCount < 180) {
    return { accessible: false, reason: "insufficient-text" };
  }
  return { accessible: true, reason: "public" };
}
