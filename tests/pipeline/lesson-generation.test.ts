import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { LessonArticle } from "../../src/contracts/content";
import type { FingerprintedArticle, SourceArticle } from "../../src/contracts/transient";
import { createOpenAiGateway } from "../../src/pipeline/ai/openai-gateway";
import type { AiGateway } from "../../src/pipeline/ai/gateway";
import { decorateParagraphs } from "../../src/pipeline/lessons/decorate";
import { generateValidatedLesson } from "../../src/pipeline/lessons/generate";
import { validateLessonAgainstSource } from "../../src/pipeline/lessons/validate";

const sourceUrl = "https://www.svt.se/nyheter/test";
const sourceBody = [
  "Förändringen träder i kraft i januari.",
  "Kommunerna får nya regler.",
  "Beslutet gäller 42 kommuner.",
].join(" ");

function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `studieord${index}`).join(" ");
}

function annotation(kind: "vocabulary" | "phrase" | "grammar" = "vocabulary") {
  const base = {
    id: `${kind}:kraft`,
    canonical: "kraft",
    targets: ["kraft"],
    meaningZh: "力量",
    meaningEn: "force",
    exampleSv: "Kraft används här.",
  };
  if (kind === "phrase") {
    return { ...base, id: "phrase:träda-i-kraft", kind, targets: ["träder i kraft"], sourceForm: "träder i kraft", canonicalForm: "träda i kraft", verbForms: ["träder"], usage: "när en regel börjar gälla" };
  }
  if (kind === "grammar") {
    return { ...base, id: "grammar:kraft", kind, grammarId: "g1", sourceFragment: "kraft", nameZh: "语法", nameEn: "grammar", explanationZh: "说明", explanationEn: "explanation" };
  }
  return { ...base, kind, surface: "kraft", lemma: "kraft", partOfSpeech: "substantiv", inflections: [], compoundParts: [], note: "" };
}

function validLesson(): LessonArticle {
  const text = `Förändringen träder i kraft. ${words(296)}`;
  return {
    id: "one",
    eventFingerprint: "kommun-beslut",
    source: "svt",
    sourceUrl,
    sourceTitle: "Testnyhet",
    publishedAt: "2026-07-23T00:00:00.000Z",
    scope: "sweden",
    topic: "daily-life",
    isFollowUp: false,
    difficulty: { level: "B1", reasons: ["naturlig svenska"], readingMinutes: 3 },
    studyTitle: "En studie",
    studyParagraphs: [
      { id: "p1", segments: [{ text: "Förändringen " }, { text: "träder i kraft", annotationId: "phrase:träda-i-kraft" }, { text: `. ${words(296)}` }] },
      { id: "p2", segments: [{ text: "." }] },
    ],
    wordCount: 300,
    summaries: { sv: "Sammanfattning", zh: "摘要", en: "Summary" },
    factPoints: ["Beslutet gäller 42 kommuner.", "Kommunerna får nya regler."],
    originalSentenceNotes: [
      { quote: "Förändringen träder i kraft i januari.", sourceUrl, annotationIds: ["phrase:träda-i-kraft"] },
      { quote: "Förändringen träder i kraft i januari.", sourceUrl, annotationIds: ["phrase:träda-i-kraft"] },
    ],
    annotations: [annotation("phrase")],
    relatedCoverage: [],
    generationModel: "test",
    contentHash: "sha256:test",
  };
}

function selected(): FingerprintedArticle {
  const article: SourceArticle = {
    id: "one",
    source: "svt",
    url: sourceUrl,
    canonicalUrl: sourceUrl,
    title: "Testnyhet",
    publishedAt: "2026-07-23T00:00:00.000Z",
    body: sourceBody,
    contentHash: "sha256:test",
    isAccessibleForFree: true,
  };
  return {
    article,
    fingerprint: { candidateId: "one", who: ["kommunerna"], action: "beslutar", where: "Sverige", when: "2026-07-23", outcome: "regler", scope: "sweden", topic: "daily-life", canonical: "untrusted-model-canonical" },
    related: [{ ...article, id: "related", source: "dn", canonicalUrl: "https://www.dn.se/related", url: "https://www.dn.se/related", body: "hemlig relaterad text" }],
    isFollowUp: true,
  };
}

describe("lesson decoration", () => {
  it("prioritizes long phrases, then grammar, over vocabulary at Unicode word boundaries", () => {
    const paragraphs = decorateParagraphs(
      ["Förändringen träder i kraft. KRAFT och kraftig ska vara kvar."],
      [
        { id: "vocabulary:kraft", targets: ["kraft"], kind: "vocabulary" },
        { id: "grammar:träder-i-kraft", targets: ["träder i kraft"], kind: "grammar" },
        { id: "phrase:träda-i-kraft", targets: ["TRÄDER I KRAFT"], kind: "phrase" },
      ],
    );
    expect(paragraphs[0]?.segments).toEqual([
      { text: "Förändringen " },
      { text: "träder i kraft", annotationId: "phrase:träda-i-kraft" },
      { text: ". " },
      { text: "KRAFT", annotationId: "vocabulary:kraft" },
      { text: " och kraftig ska vara kvar." },
    ]);
    expect(paragraphs[0]?.segments.map((segment) => segment.text).join("")).toBe("Förändringen träder i kraft. KRAFT och kraftig ska vara kvar.");
  });
});

describe("lesson validation", () => {
  it("rejects quotes not found in source and texts outside 300-500 words", () => {
    const lesson = validLesson();
    lesson.wordCount = 299;
    lesson.originalSentenceNotes[0]!.quote = "Den här meningen finns inte.";
    expect(() => validateLessonAgainstSource(lesson, sourceBody, sourceUrl)).toThrow(/lesson-word-count/u);
  });

  it("rejects unsupported numbers and source copying of 26 normalized words", () => {
    const unsupported = validLesson();
    unsupported.factPoints[0] = "Beslutet gäller 99 kommuner.";
    expect(() => validateLessonAgainstSource(unsupported, sourceBody, sourceUrl)).toThrow("lesson-unsupported-number:99");

    const sourceWords = words(26);
    const overlap = validLesson();
    overlap.studyParagraphs[0]!.segments[0]!.text = `${sourceWords} `;
    overlap.studyParagraphs[0]!.segments[2]!.text = ` ${words(271)}`;
    expect(() => validateLessonAgainstSource(overlap, `${sourceBody} ${sourceWords}`, sourceUrl)).toThrow("lesson-long-source-overlap");
  });

  it("rejects duplicate, dangling, and wrongly decorated annotations", () => {
    const duplicate = validLesson();
    duplicate.annotations.push({ ...annotation("phrase"), id: "phrase:duplicate" });
    expect(() => validateLessonAgainstSource(duplicate, sourceBody, sourceUrl)).toThrow("lesson-duplicate-annotation");

    const dangling = validLesson();
    dangling.studyParagraphs[0]!.segments[0]!.annotationId = "missing";
    expect(() => validateLessonAgainstSource(dangling, sourceBody, sourceUrl)).toThrow("lesson-segment-annotation-missing");

    const mismatch = validLesson();
    mismatch.studyParagraphs[0]!.segments[0]!.text = "Förändringen träder i kraft ";
    mismatch.studyParagraphs[0]!.segments[1]!.text = "fel text nu";
    mismatch.studyParagraphs[0]!.segments[2]!.text = `. ${words(293)}`;
    expect(() => validateLessonAgainstSource(mismatch, sourceBody, sourceUrl)).toThrow("lesson-segment-target-mismatch");
  });

  it("binds every quoted annotation to a phrase or source fragment in that quote", () => {
    const lesson = validLesson();
    lesson.originalSentenceNotes[1]!.quote = "Kommunerna får nya regler.";
    expect(() => validateLessonAgainstSource(lesson, sourceBody, sourceUrl)).toThrow("lesson-quote-annotation-unbound");
  });
});

describe("validated lesson generation", () => {
  it("repairs once for content validation failures and forwards the reason", async () => {
    const invalid = validLesson();
    invalid.wordCount = 299;
    const calls: Array<string | undefined> = [];
    const gateway = { generateLesson: async (_input: unknown, reason?: string) => { calls.push(reason); return calls.length === 1 ? invalid : validLesson(); } } as AiGateway;
    await expect(generateValidatedLesson(selected(), gateway)).resolves.toMatchObject({ id: "one" });
    expect(calls).toEqual([undefined, "lesson-word-count:300"]);
  });

  it("does not retry permanent gateway errors", async () => {
    let calls = 0;
    const gateway = { generateLesson: async () => { calls += 1; throw Object.assign(new Error("bad request"), { status: 400 }); } } as unknown as AiGateway;
    await expect(generateValidatedLesson(selected(), gateway)).rejects.toThrow("bad request");
    expect(calls).toBe(1);
  });

  it("repairs a structured-output Zod error only once", async () => {
    let calls = 0;
    const gateway = { generateLesson: async () => { calls += 1; throw z.object({ required: z.string() }).parse({}); } } as unknown as AiGateway;
    await expect(generateValidatedLesson(selected(), gateway)).rejects.toBeInstanceOf(z.ZodError);
    expect(calls).toBe(2);
  });
});

describe("OpenAI lesson gateway", () => {
  it("assembles trusted metadata and safe ID while exposing no related body to the model", async () => {
    const payloads: unknown[] = [];
    const client = {
      responses: {
        parse: async (params: { input: Array<{ content: string }> }) => {
          payloads.push(JSON.parse(params.input[1]!.content));
          return { output_parsed: draft(), usage: { input_tokens: 1, output_tokens: 2 } };
        },
      },
    };
    const result = await createOpenAiGateway({ apiKey: "test", client: client as never, model: "model" }).generateLesson(selected());
    expect(result).toMatchObject({ id: "one", sourceUrl, eventFingerprint: "untrusted-model-canonical", isFollowUp: true, contentHash: "sha256:test" });
    expect(payloads[0]).toMatchObject({ relatedCoverage: [{ source: "dn", title: "Testnyhet", url: "https://www.dn.se/related" }] });
    expect(JSON.stringify(payloads[0])).not.toContain("hemlig relaterad text");
  });
});

function draft() {
  const lesson = validLesson();
  return {
    studyTitle: lesson.studyTitle,
    paragraphs: lesson.studyParagraphs.map((paragraph) => paragraph.segments.map((segment) => segment.text).join("")),
    difficulty: lesson.difficulty,
    summaries: lesson.summaries,
    factPoints: lesson.factPoints,
    originalSentenceNotes: lesson.originalSentenceNotes.map(({ quote, annotationIds }) => ({ quote, annotationIds })),
    annotations: Array.from({ length: 6 }, (_, index) => ({ ...annotation("phrase"), id: `phrase:träda-i-kraft-${index}`, canonical: `träda-i-kraft-${index}` })),
    id: "model-controlled-id",
    sourceUrl: "https://evil.test/",
  };
}
