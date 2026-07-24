import type { FingerprintedArticle } from "../../contracts/transient";
import { ZodError } from "zod";
import type { AiGateway, LessonFactClaim } from "../ai/gateway";
import { validateLessonAgainstSource } from "./validate";

export function lessonFactClaims(lesson: Awaited<ReturnType<typeof validateLessonAgainstSource>>): LessonFactClaim[] {
  const segmenter = new Intl.Segmenter("sv", { granularity: "sentence" });
  const studyClaims = lesson.studyParagraphs.flatMap((paragraph, paragraphIndex) =>
    Array.from(segmenter.segment(paragraph.segments.map((segment) => segment.text).join("")))
      .map((sentence) => sentence.segment.trim())
      .filter(Boolean)
      .map((text, sentenceIndex) => ({ id: `study-p${paragraphIndex + 1}-s${sentenceIndex + 1}`, text })),
  );
  return [
    { id: "study-title", text: lesson.studyTitle },
    ...studyClaims,
    { id: "summary-sv", text: lesson.summaries.sv },
    { id: "summary-zh", text: lesson.summaries.zh },
    { id: "summary-en", text: lesson.summaries.en },
    ...lesson.factPoints.map((text, index) => ({ id: `fact-point-${index + 1}`, text })),
  ];
}

function lessonRepairReason(error: Error): string {
  const internalReason = "repairReason" in error ? (error as Error & { repairReason?: unknown }).repairReason : undefined;
  if (typeof internalReason === "string" && internalReason.length > 0) return internalReason;
  if (error.message.startsWith("lesson-lemma-mismatch:")) {
    return `${error.message}; for every vocabulary annotation, set canonical to exactly the same string as lemma`;
  }
  if (error.message === "lesson-long-source-overlap") {
    return "lesson-long-source-overlap; rewrite the study paragraphs in original Swedish wording and do not repeat any sequence of 26 or more normalized words from sourceArticle";
  }
  if (!(error instanceof ZodError)) return error.message;
  const wordCountFailure = error.issues.some((issue) =>
    issue.path.some((part) => part === "wordCount" || part === "studyParagraphs" || part === "paragraphs"));
  if (wordCountFailure) {
    return "lesson-word-count-out-of-range: return exactly 4 study paragraphs with 90 to 110 Swedish words each; count paragraph text only";
  }
  const issues = error.issues.slice(0, 8).map((issue) => {
    const path = issue.path.filter((part): part is string | number =>
      typeof part === "string" || typeof part === "number").join(".");
    return `${path || "root"}:${issue.code}`;
  });
  return `lesson-schema-invalid:${issues.join(",")}`;
}

export async function generateValidatedLesson(selected: FingerprintedArticle, gateway: AiGateway) {
  let repairReason: string | undefined;
  const attemptedRepairs = new Set<string>();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let validated;
    try {
      const lesson = await gateway.generateLesson({
        article: selected.article,
        fingerprint: selected.fingerprint,
        related: selected.related,
        isFollowUp: selected.isFollowUp,
      }, repairReason);
      validated = validateLessonAgainstSource(lesson, selected.article.body, selected.article.canonicalUrl);
    } catch (error) {
      const repairable = error instanceof ZodError || (error instanceof Error && error.message.startsWith("lesson-"));
      if (!repairable) throw error;
      const nextRepairReason = lessonRepairReason(error);
      if (attempt === 2 || attemptedRepairs.has(nextRepairReason)) throw error;
      attemptedRepairs.add(nextRepairReason);
      repairReason = nextRepairReason;
      continue;
    }
    try {
      await gateway.verifyLessonFacts(selected.article.body, lessonFactClaims(validated));
      return validated;
    } catch (error) {
      const repairable = error instanceof Error && error.message.startsWith("lesson-unsupported-fact:");
      if (!repairable) throw error;
      const nextRepairReason = lessonRepairReason(error);
      if (attempt === 2 || attemptedRepairs.has(nextRepairReason)) throw error;
      attemptedRepairs.add(nextRepairReason);
      repairReason = nextRepairReason;
    }
  }
  throw new Error("lesson-generation-failed");
}
