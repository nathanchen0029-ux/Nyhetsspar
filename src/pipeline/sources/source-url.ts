import type { Source } from "../../contracts/content";

const domains: Record<Source, string> = {
  svt: "svt.se",
  aftonbladet: "aftonbladet.se",
  dn: "dn.se",
};

export function sourceDomainMatches(url: string, source: Source): boolean {
  const hostname = new URL(url).hostname.toLowerCase();
  const domain = domains[source];
  return hostname === domain || hostname.endsWith("." + domain);
}
