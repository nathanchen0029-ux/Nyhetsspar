import {
  EditorialDaySchema,
  EditorialLedgerSchema,
  type EditorialLedger,
  type Scope,
  type Source,
  type Topic,
} from "../../contracts/content";
import type { FingerprintedArticle } from "../../contracts/transient";

const scopes: Scope[] = ["local", "sweden", "international"];
const topics: Topic[] = ["politics", "economy", "daily-life", "culture", "sports"];
const sources: Source[] = ["svt", "aftonbladet", "dn"];

function counts<T extends string>(values: readonly T[]): Record<T, number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>;
}

function rollingCounts(ledger: EditorialLedger) {
  const scope = counts(scopes);
  const topic = counts(topics);
  const source = counts(sources);
  for (const day of ledger.days) {
    for (const value of scopes) scope[value] += day.scopes[value] ?? 0;
    for (const value of topics) topic[value] += day.topics[value] ?? 0;
    for (const value of sources) source[value] += day.sources[value] ?? 0;
  }
  return { scope, topic, source };
}

function articleOrder(left: FingerprintedArticle, right: FingerprintedArticle): number {
  return left.article.canonicalUrl.localeCompare(right.article.canonicalUrl)
    || left.article.id.localeCompare(right.article.id);
}

function uniqueCandidates(candidates: FingerprintedArticle[]): FingerprintedArticle[] {
  const ids = new Set<string>();
  const canonicalUrls = new Set<string>();
  return [...candidates].sort(articleOrder).filter((item) => {
    if (ids.has(item.article.id) || canonicalUrls.has(item.article.canonicalUrl)) return false;
    ids.add(item.article.id);
    canonicalUrls.add(item.article.canonicalUrl);
    return true;
  });
}

export function selectDailyArticles(
  candidates: FingerprintedArticle[],
  ledger: EditorialLedger,
  limit: number,
): FingerprintedArticle[] {
  const maximum = Math.min(3, Math.floor(limit));
  if (maximum <= 0) return [];

  const remaining = uniqueCandidates(candidates);
  const rolling = rollingCounts(ledger);
  const daily = { scope: counts(scopes), topic: counts(topics), source: counts(sources) };
  const selected: FingerprintedArticle[] = [];
  const score = (item: FingerprintedArticle) =>
    40 / (1 + rolling.topic[item.fingerprint.topic] + daily.topic[item.fingerprint.topic])
    + 20 / (1 + rolling.source[item.article.source] + daily.source[item.article.source])
    + 10 / (1 + rolling.scope[item.fingerprint.scope] + daily.scope[item.fingerprint.scope])
    + Math.min(item.article.body.split(/\s+/u).filter(Boolean).length, 600) / 100
    + new Date(item.article.publishedAt).getTime() / 1e13;
  const choose = (eligible: (item: FingerprintedArticle) => boolean): boolean => {
    const matches = remaining.filter(eligible).sort((left, right) => score(right) - score(left) || articleOrder(left, right));
    const item = matches[0];
    if (!item) return false;
    selected.push(item);
    daily.scope[item.fingerprint.scope] += 1;
    daily.topic[item.fingerprint.topic] += 1;
    daily.source[item.article.source] += 1;
    remaining.splice(remaining.indexOf(item), 1);
    return true;
  };

  if (maximum >= 2) {
    choose((item) => item.fingerprint.scope !== "international");
    choose((item) => item.fingerprint.scope === "international");
  }
  while (selected.length < maximum && choose(() => true)) {
    // Continue while there are candidates left to select.
  }
  return selected;
}

export function appendLedgerDay(
  ledger: EditorialLedger,
  date: string,
  selected: FingerprintedArticle[],
): EditorialLedger {
  const day = EditorialDaySchema.parse({
    date,
    scopes: counts(scopes),
    topics: counts(topics),
    sources: counts(sources),
    eventFingerprints: selected.map((item) => item.fingerprint.canonical),
    eventDetails: selected.map((item) => item.fingerprint),
  });
  for (const item of selected) {
    day.scopes[item.fingerprint.scope] += 1;
    day.topics[item.fingerprint.topic] += 1;
    day.sources[item.article.source] += 1;
  }
  const days = [...ledger.days.filter((existing) => existing.date !== date), day]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-7);
  return EditorialLedgerSchema.parse({ schemaVersion: 1, days });
}
