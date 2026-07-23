import type { FingerprintedArticle } from "../../contracts/transient";
import { ZodError } from "zod";
import type { AiGateway } from "../ai/gateway";
import { validateLessonAgainstSource } from "./validate";

export async function generateValidatedLesson(selected: FingerprintedArticle, gateway: AiGateway) {
  let repairReason: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const lesson = await gateway.generateLesson({
        article: selected.article,
        fingerprint: selected.fingerprint,
        related: selected.related,
        isFollowUp: selected.isFollowUp,
      }, repairReason);
      return validateLessonAgainstSource(lesson, selected.article.body, selected.article.canonicalUrl);
    } catch (error) {
      const repairable = error instanceof ZodError || (error instanceof Error && error.message.startsWith("lesson-"));
      if (!repairable || attempt === 1) throw error;
      repairReason = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error("lesson-generation-failed");
}
