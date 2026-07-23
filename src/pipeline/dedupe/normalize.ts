export function normalizeTitle(title: string): string {
  return title.normalize("NFKC").toLocaleLowerCase("sv").replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(?:just nu|live|senaste nytt)\b/gu, " ").replace(/\s+/gu, " ").trim();
}

export function tokenSimilarity(left: string, right: string): number {
  const a = new Set(normalizeTitle(left).split(" ").filter(Boolean));
  const b = new Set(normalizeTitle(right).split(" ").filter(Boolean));
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}
