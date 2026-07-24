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
  if (!(error instanceof ZodError)) return error.message;
  const wordCountFailure = error.issues.some((issue) =>
    issue.path.some((part) => part === "wordCount" || part === "studyParagraphs"));
  if (wordCountFailure) {
    return "lesson-word-count-out-of-range: rewrite the study paragraphs to contain 360 to 440 Swedish words; count paragraph text only";
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
  for (let attempt = 0; attempt < 2; attempt += 1) {
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
      if (!repairable || attempt === 1) throw error;
      repairReason = lessonRepairReason(error);
      continue;
    }
    try {
      await gateway.verifyLessonFacts(selected.article.body, lessonFactClaims(validated));
      return validated;
    } catch (error) {
      const repairable = error instanceof Error && error.message.startsWith("lesson-unsupported-fact:");
      if (!repairable || attempt === 1) throw error;
      repairReason = error.message;
    }
  }
  throw new Error("lesson-generation-failed");
}
