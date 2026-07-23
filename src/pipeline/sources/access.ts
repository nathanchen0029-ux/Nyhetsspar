import { load } from "cheerio";
import type { Source } from "../../contracts/content";
import { isNewsArticle, jsonLdNodes, plainTextFromHtml } from "./json-ld";

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
  const nodes = jsonLdNodes(html);
  let explicitlyPublic = false;
  for (const node of nodes) {
    if (node.isAccessibleForFree === false) {
      return { accessible: false, reason: "structured-paywall" };
    }
    if (isNewsArticle(node) && node.isAccessibleForFree === true) {
      explicitlyPublic = true;
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
  const articleNode = nodes.find(isNewsArticle);
  const jsonBody = typeof articleNode?.articleBody === "string" ? plainTextFromHtml(articleNode.articleBody) : "";
  const stableText = wordCount(jsonBody) >= 180 ? jsonBody : articleText;
  const articleWordCount = wordCount(stableText);
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

function wordCount(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length;
}
