import { z } from "zod";

export const SourceSchema = z.enum(["svt", "aftonbladet", "dn"]);
export const ScopeSchema = z.enum(["local", "sweden", "international"]);
export const TopicSchema = z.enum(["politics", "economy", "daily-life", "culture", "sports"]);
export const SourceHealthSchema = z.enum(["ok", "partial", "failed"]);

export function countSwedishWords(text: string): number {
  return text.trim().split(/\s+/u).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

export const TextSegmentSchema = z.object({ text: z.string().min(1), annotationId: z.string().min(1).optional() });
export const StudyParagraphSchema = z.object({ id: z.string().min(1), segments: z.array(TextSegmentSchema).min(1) });

const AnnotationBaseSchema = z.object({
  id: z.string().min(1), canonical: z.string().min(1), targets: z.array(z.string().min(1)).min(1),
  meaningZh: z.string().min(1), meaningEn: z.string().min(1), exampleSv: z.string().min(1),
});

export const VocabularyAnnotationSchema = AnnotationBaseSchema.extend({
  kind: z.literal("vocabulary"), surface: z.string().min(1), lemma: z.string().min(1), partOfSpeech: z.string().min(1),
  inflections: z.array(z.string()), compoundParts: z.array(z.string()), note: z.string(),
});
export const PhraseAnnotationSchema = AnnotationBaseSchema.extend({
  kind: z.literal("phrase"), sourceForm: z.string().min(1), canonicalForm: z.string().min(1),
  verbForms: z.array(z.string()), usage: z.string().min(1),
});
export const GrammarAnnotationSchema = AnnotationBaseSchema.extend({
  kind: z.literal("grammar"), grammarId: z.string().min(1), sourceFragment: z.string().min(1),
  nameZh: z.string().min(1), nameEn: z.string().min(1), explanationZh: z.string().min(1), explanationEn: z.string().min(1),
});
export const AnnotationSchema = z.discriminatedUnion("kind", [VocabularyAnnotationSchema, PhraseAnnotationSchema, GrammarAnnotationSchema]);

export const OriginalSentenceNoteSchema = z.object({ quote: z.string().min(1), sourceUrl: z.string().url(), annotationIds: z.array(z.string()).min(1) });
export const RelatedCoverageSchema = z.object({ source: SourceSchema, title: z.string().min(1), url: z.string().url() });

export const LessonArticleSchema = z.object({
  id: z.string().min(1), eventFingerprint: z.string().min(1), source: SourceSchema, sourceUrl: z.string().url(), sourceTitle: z.string().min(1),
  publishedAt: z.string().datetime(), scope: ScopeSchema, topic: TopicSchema, isFollowUp: z.boolean(),
  difficulty: z.object({ level: z.string().regex(/^(?:A1|A2|B1|B2|C1|C2)(?:[–-](?:A1|A2|B1|B2|C1|C2))?$/u), reasons: z.array(z.string().min(1)).min(1), readingMinutes: z.number().int().positive() }),
  studyTitle: z.string().min(1), studyParagraphs: z.array(StudyParagraphSchema).min(2), wordCount: z.number().int().min(300).max(500),
  summaries: z.object({ sv: z.string().min(1), zh: z.string().min(1), en: z.string().min(1) }), factPoints: z.array(z.string().min(1)).min(2),
  originalSentenceNotes: z.array(OriginalSentenceNoteSchema).min(2).max(4), annotations: z.array(AnnotationSchema), relatedCoverage: z.array(RelatedCoverageSchema),
  generationModel: z.string().min(1), contentHash: z.string().min(1),
});

export const DailyLessonSchema = z.object({
  schemaVersion: z.literal(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), timezone: z.literal("Europe/Stockholm"), generatedAt: z.string().datetime(), status: z.enum(["ready", "delayed"]),
  sourceHealth: z.object({ svt: SourceHealthSchema, aftonbladet: SourceHealthSchema, dn: SourceHealthSchema }), selectionSummary: z.string().min(1), articles: z.array(LessonArticleSchema).max(3),
});

export const EditorialDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), scopes: z.record(ScopeSchema, z.number().int().nonnegative()),
  topics: z.record(TopicSchema, z.number().int().nonnegative()), sources: z.record(SourceSchema, z.number().int().nonnegative()), eventFingerprints: z.array(z.string()),
});
export const EditorialLedgerSchema = z.object({ schemaVersion: z.literal(1), days: z.array(EditorialDaySchema).max(7) });

export const LessonIndexEntrySchema = z.object({
  date: z.string(), status: z.enum(["ready", "delayed"]), articles: z.array(z.object({
    id: z.string(), title: z.string(), source: SourceSchema, scope: ScopeSchema, topic: TopicSchema, difficulty: z.string(), isFollowUp: z.boolean(),
  })),
});
export const LessonIndexSchema = z.object({ schemaVersion: z.literal(1), dates: z.array(LessonIndexEntrySchema) });

export type Source = z.infer<typeof SourceSchema>;
export type Scope = z.infer<typeof ScopeSchema>;
export type Topic = z.infer<typeof TopicSchema>;
export type Annotation = z.infer<typeof AnnotationSchema>;
export type LessonArticle = z.infer<typeof LessonArticleSchema>;
export type DailyLesson = z.infer<typeof DailyLessonSchema>;
export type EditorialLedger = z.infer<typeof EditorialLedgerSchema>;
export type LessonIndex = z.infer<typeof LessonIndexSchema>;
