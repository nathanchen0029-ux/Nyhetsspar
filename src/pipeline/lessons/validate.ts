import { countSwedishWords, LessonArticleSchema, type Annotation, type LessonArticle } from "../../contracts/content";

export function lessonText(lesson: LessonArticle): string {
  return lesson.studyParagraphs.map((paragraph) => paragraph.segments.map((segment) => segment.text).join("")).join("\n\n");
}

function normalize(text: string): string {
  return text.normalize("NFKC").toLocaleLowerCase("sv").replace(/\s+/gu, " ").trim();
}

export function isWholeTargetIn(text: string, target: string): boolean {
  if (!target) return false;
  const escaped = target.normalize("NFKC").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\s+/gu, "\\s+");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(text.normalize("NFKC"));
}

export function quoteForms(annotation: Annotation): string[] {
  if (annotation.kind === "grammar") return [...annotation.targets, annotation.sourceFragment];
  if (annotation.kind === "phrase") return [...annotation.targets, annotation.sourceForm, annotation.canonicalForm, ...annotation.verbForms];
  return [...annotation.targets, annotation.surface, annotation.canonical, annotation.lemma, ...annotation.inflections];
}

export function annotationAppearsInText(annotation: Annotation, text: string): boolean {
  return quoteForms(annotation).some((form) => isWholeTargetIn(text, form));
}

function annotationMatchesSegment(annotation: Annotation, text: string): boolean {
  return annotation.targets.some((target) => normalize(target) === normalize(text));
}

function normalizedWords(text: string): string[] {
  return normalize(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

const numericToken = /(?<![\p{L}\p{N}])\d+(?:[.,]\d+)?%?(?![\p{L}\p{N}])/gu;

function numericTokens(text: string): Set<string> {
  return new Set(text.normalize("NFKC").match(numericToken) ?? []);
}

export function validateLessonAgainstSource(input: LessonArticle, sourceBody: string, sourceUrl: string): LessonArticle {
  const actualCount = countSwedishWords(lessonText(input));
  if (actualCount < 300 || actualCount > 500 || input.wordCount !== actualCount) {
    throw new Error(`lesson-word-count:${actualCount}`);
  }
  const lesson = LessonArticleSchema.parse(input);
  const quotedWords = lesson.originalSentenceNotes.reduce((total, note) => total + countSwedishWords(note.quote), 0);
  if (quotedWords > 80) throw new Error(`lesson-quote-total:${quotedWords}`);

  const annotationsById = new Map<string, Annotation>();
  const canonicalKeys = new Set<string>();
  const linkedAnnotationIds = new Set<string>();
  const study = lessonText(lesson);
  for (const annotation of lesson.annotations) {
    if (annotationsById.has(annotation.id)) throw new Error(`lesson-duplicate-annotation-id:${annotation.id}`);
    annotationsById.set(annotation.id, annotation);
    const canonicalKey = `${annotation.kind}:${normalize(annotation.canonical)}`;
    if (canonicalKeys.has(canonicalKey)) throw new Error("lesson-duplicate-annotation");
    canonicalKeys.add(canonicalKey);
    if (!annotation.targets.some((target) => isWholeTargetIn(study, target))) {
      throw new Error(`lesson-annotation-target-missing:${annotation.id}`);
    }
    if (annotation.kind === "vocabulary" && normalize(annotation.canonical) !== normalize(annotation.lemma)) {
      throw new Error(`lesson-lemma-mismatch:${annotation.id}`);
    }
  }

  for (const paragraph of lesson.studyParagraphs) {
    for (const segment of paragraph.segments) {
      if (!segment.annotationId) continue;
      const annotation = annotationsById.get(segment.annotationId);
      if (!annotation) throw new Error(`lesson-segment-annotation-missing:${segment.annotationId}`);
      if (!annotationMatchesSegment(annotation, segment.text)) {
        throw new Error(`lesson-segment-target-mismatch:${segment.annotationId}`);
      }
      linkedAnnotationIds.add(segment.annotationId);
    }
  }
  for (const id of annotationsById.keys()) {
    if (!linkedAnnotationIds.has(id)) throw new Error(`lesson-annotation-unlinked:${id}`);
  }

  const quoteKeys = new Set<string>();
  for (const note of lesson.originalSentenceNotes) {
    if (countSwedishWords(note.quote) > 25) throw new Error("lesson-quote-too-long");
    const quoteKey = normalize(note.quote);
    if (quoteKeys.has(quoteKey)) throw new Error("lesson-duplicate-quote");
    quoteKeys.add(quoteKey);
    if (!sourceBody.includes(note.quote)) throw new Error("lesson-quote-not-in-source");
    if (note.sourceUrl !== sourceUrl) throw new Error("lesson-quote-source-mismatch");
    for (const id of note.annotationIds) {
      const annotation = annotationsById.get(id);
      if (!annotation) throw new Error("lesson-quote-annotation-missing");
      if (!annotationAppearsInText(annotation, note.quote)) {
        throw new Error(`lesson-quote-annotation-unbound:${id}`);
      }
    }
  }

  const sourceNumbers = numericTokens(sourceBody);
  for (const claim of numericTokens(`${study}\n${lesson.factPoints.join("\n")}`)) {
    if (!sourceNumbers.has(claim)) throw new Error(`lesson-unsupported-number:${claim}`);
  }

  const sourceWords = normalizedWords(sourceBody);
  const studyWords = normalizedWords(study).join(" ");
  for (let index = 0; index <= sourceWords.length - 26; index += 1) {
    if (studyWords.includes(sourceWords.slice(index, index + 26).join(" "))) throw new Error("lesson-long-source-overlap");
  }
  return lesson;
}
