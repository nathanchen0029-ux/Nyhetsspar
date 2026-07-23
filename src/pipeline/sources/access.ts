import { load } from "cheerio";
import type { Source } from "../../contracts/content";

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
        | "insufficient-text"
        | "public-access-unconfirmed";
    };

export function classifyAccess(source: Source, html: string): AccessDecision {
  const $ = load(html);
  const scripts = $("script[type=\"application/ld+json\"]")
    .map((_, element) => $(element).text())
    .get();

  let explicitlyPublic = false;
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
        if (
          typeof node === "object" &&
          node !== null &&
          "isAccessibleForFree" in node &&
          (node as { isAccessibleForFree: unknown }).isAccessibleForFree === true
        ) {
          explicitlyPublic = true;
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
  if (source !== "svt" && !explicitlyPublic) {
    return { accessible: false, reason: "public-access-unconfirmed" };
  }
  return { accessible: true, reason: "public" };
}
