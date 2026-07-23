import type { EditorialLedger, EventFingerprintDetail } from "../../contracts/content";
import type { EventFingerprint, FingerprintedArticle, SourceArticle } from "../../contracts/transient";
import type { DuplicatePair, DuplicateReview, NewsAiGateway } from "../ai/gateway";
import { tokenSimilarity } from "./normalize";

function representative(left: SourceArticle, right: SourceArticle): SourceArticle {
  const score = (article: SourceArticle) => article.body.split(/\s+/u).length + new Date(article.publishedAt).getTime() / 1e12;
  const leftScore = score(left);
  const rightScore = score(right);
  if (rightScore !== leftScore) return rightScore > leftScore ? right : left;
  const canonicalComparison = left.canonicalUrl.localeCompare(right.canonicalUrl, "en");
  if (canonicalComparison !== 0) return canonicalComparison < 0 ? left : right;
  return left.id.localeCompare(right.id, "en") <= 0 ? left : right;
}

function fingerprintSimilarity(left: EventFingerprint, right: EventFingerprint): number {
  return tokenSimilarity(left.who.join(" "), right.who.join(" ")) * 0.25 + tokenSimilarity(left.action, right.action) * 0.35 + tokenSimilarity(left.where, right.where) * 0.1 + tokenSimilarity(left.when, right.when) * 0.1 + tokenSimilarity(left.outcome, right.outcome) * 0.2;
}

function assertIds(label: string, expected: string[], actual: string[]): void {
  const wanted = new Set(expected);
  const seen = new Set<string>();
  for (const id of actual) {
    if (!wanted.has(id) || seen.has(id)) throw new Error(`${label}: invalid ID`);
    seen.add(id);
  }
  if (seen.size !== wanted.size) throw new Error(`${label}: incomplete IDs`);
}

class UnionFind {
  private readonly parents: number[];
  constructor(size: number) { this.parents = Array.from({ length: size }, (_, index) => index); }
  find(index: number): number { const parent = this.parents[index]; if (parent === undefined) throw new Error("union-find-index"); if (parent !== index) this.parents[index] = this.find(parent); return this.parents[index] as number; }
  union(left: number, right: number): void { const leftRoot = this.find(left); const rightRoot = this.find(right); if (leftRoot !== rightRoot) this.parents[rightRoot] = leftRoot; }
}

interface HistoricalPair {
  pair: DuplicatePair;
  currentId: string;
}

function toFingerprint(detail: EventFingerprintDetail): EventFingerprint {
  return detail;
}

export async function deduplicateArticles(articles: SourceArticle[], ledger: EditorialLedger, gateway: NewsAiGateway): Promise<FingerprintedArticle[]> {
  const unique: SourceArticle[] = [];
  for (const article of articles) {
    const existing = unique.findIndex((current) => current.canonicalUrl === article.canonicalUrl || current.contentHash === article.contentHash);
    if (existing === -1) unique.push(article);
    else unique[existing] = representative(unique[existing] as SourceArticle, article);
  }
  if (unique.length === 0) return [];
  const fingerprints = await gateway.fingerprint(unique);
  assertIds("fingerprints", unique.map((article) => article.id), fingerprints.map((fingerprint) => fingerprint.candidateId));
  const byId = new Map(fingerprints.map((fingerprint) => [fingerprint.candidateId, fingerprint]));
  const currentPairs: DuplicatePair[] = [];
  for (let leftIndex = 0; leftIndex < unique.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < unique.length; rightIndex += 1) {
    const leftArticle = unique[leftIndex] as SourceArticle; const rightArticle = unique[rightIndex] as SourceArticle;
    if (leftArticle.source === rightArticle.source) continue;
    const left = byId.get(leftArticle.id) as EventFingerprint; const right = byId.get(rightArticle.id) as EventFingerprint;
    if (fingerprintSimilarity(left, right) >= 0.45 || tokenSimilarity(leftArticle.title, rightArticle.title) >= 0.55) currentPairs.push({ pairId: `${left.candidateId}:${right.candidateId}`, left, right });
  }
  const pairs = [...currentPairs];
  const pairIds = new Set(currentPairs.map((pair) => pair.pairId));
  const historicalPairs: HistoricalPair[] = [];
  const legacyHistorical = new Set<string>();
  let historyIndex = 0;
  for (const day of ledger.days) {
    const details = day.eventDetails ?? [];
    const detailedCanonicals = new Set(details.map((detail) => detail.canonical));
    for (const canonical of day.eventFingerprints) if (!detailedCanonicals.has(canonical)) legacyHistorical.add(canonical);
    for (const detail of details) {
      const historical = toFingerprint(detail);
      for (const current of fingerprints) {
        if (current.canonical !== historical.canonical && fingerprintSimilarity(current, historical) < 0.45 && tokenSimilarity(current.canonical, historical.canonical) < 0.65) continue;
        let pairId = `historical:${historyIndex}:${current.candidateId}`;
        let collision = 1;
        while (pairIds.has(pairId)) pairId = `historical:${historyIndex}:${current.candidateId}:${collision++}`;
        pairIds.add(pairId);
        const pair = { pairId, left: current, right: historical };
        pairs.push(pair);
        historicalPairs.push({ pair, currentId: current.candidateId });
      }
      historyIndex += 1;
    }
  }
  const reviews = await gateway.reviewPairs(pairs);
  assertIds("reviews", pairs.map((pair) => pair.pairId), reviews.map((review) => review.pairId));
  const accepted = new Map(reviews.filter((review) => review.sameEvent && review.confidence >= 0.85).map((review) => [review.pairId, review]));
  const indexById = new Map(unique.map((article, index) => [article.id, index]));
  const unions = new UnionFind(unique.length);
  for (const pair of currentPairs) {
    if (!accepted.has(pair.pairId)) continue;
    unions.union(indexById.get(pair.left.candidateId) as number, indexById.get(pair.right.candidateId) as number);
  }
  const components = new Map<number, SourceArticle[]>();
  unique.forEach((article, index) => { const root = unions.find(index); const members = components.get(root) ?? []; members.push(article); components.set(root, members); });
  const result: FingerprintedArticle[] = [];
  for (const cluster of components.values()) {
    const chosen = cluster.reduce(representative);
    const clusterFingerprints = cluster.map((article) => byId.get(article.id) as EventFingerprint);
    const memberIds = new Set(cluster.map((article) => article.id));
    const legacyExactRepeat = clusterFingerprints.some((item) => legacyHistorical.has(item.canonical));
    const currentReviewHasUpdate = currentPairs.some((pair) => memberIds.has(pair.left.candidateId) && memberIds.has(pair.right.candidateId) && (accepted.get(pair.pairId) as DuplicateReview | undefined)?.materialUpdate === true);
    const historicalReviews = historicalPairs.filter((item) => memberIds.has(item.currentId)).map((item) => accepted.get(item.pair.pairId)).filter((review): review is DuplicateReview => Boolean(review));
    const historicalUpdate = historicalReviews.some((review) => review.materialUpdate);
    const historicalSameWithoutUpdate = historicalReviews.some((review) => !review.materialUpdate);
    const isFollowUp = currentReviewHasUpdate || historicalUpdate;
    if (!legacyExactRepeat && !(historicalSameWithoutUpdate && !historicalUpdate)) result.push({ article: chosen, fingerprint: byId.get(chosen.id) as EventFingerprint, related: cluster.filter((article) => article.id !== chosen.id), isFollowUp });
  }
  return result;
}
