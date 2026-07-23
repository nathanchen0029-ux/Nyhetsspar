import type { Scope, Source, Topic } from "./content";

export interface CandidateLink { source: Source; url: string; discoveredTitle: string; discoveredAt: string; sectionHint?: string; }
export interface SourceArticle { id: string; source: Source; url: string; canonicalUrl: string; title: string; publishedAt: string; body: string; contentHash: string; isAccessibleForFree: boolean; sectionHint?: string; }
export interface EventFingerprint { candidateId: string; who: string[]; action: string; where: string; when: string; outcome: string; scope: Scope; topic: Topic; canonical: string; }
export interface FingerprintedArticle { article: SourceArticle; fingerprint: EventFingerprint; related: SourceArticle[]; isFollowUp: boolean; }
export interface FetchResponse { url: string; status: number; headers: Headers; text: string; }
export interface FetchTextOptions {
  redirectGuard?: (nextUrl: string) => Promise<boolean>;
}
export interface Fetcher { fetchText(url: string, options?: FetchTextOptions): Promise<FetchResponse>; }
export interface SourceAdapter { source: Source; discover(now: Date, fetcher: Fetcher): Promise<CandidateLink[]>; }
