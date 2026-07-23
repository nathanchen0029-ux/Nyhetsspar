import type { LessonArticle } from "../../contracts/content";
import type { EventFingerprint, SourceArticle } from "../../contracts/transient";

export interface DuplicatePair {
  pairId: string;
  left: EventFingerprint;
  right: EventFingerprint;
}

export interface DuplicateReview {
  pairId: string;
  sameEvent: boolean;
  confidence: number;
  reason: string;
  materialUpdate: boolean;
}

export interface LessonGenerationInput {
  article: SourceArticle;
  fingerprint: EventFingerprint;
  related: SourceArticle[];
  isFollowUp: boolean;
}

export interface NewsAiGateway {
  fingerprint(articles: SourceArticle[]): Promise<EventFingerprint[]>;
  reviewPairs(pairs: DuplicatePair[]): Promise<DuplicateReview[]>;
}

export interface LessonAiGateway {
  generateLesson(input: LessonGenerationInput, repairReason?: string): Promise<LessonArticle>;
}

export type AiGateway = NewsAiGateway & LessonAiGateway;
