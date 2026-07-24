export const FINGERPRINT_SYSTEM = [
  "Classify Swedish news articles into factual event fingerprints.",
  "Use only supplied article text.",
  "Return concise lowercase canonical event identifiers.",
  "Scope must be local, sweden, or international.",
  "Topic must be politics, economy, daily-life, culture, or sports.",
].join(" ");

export const DUPLICATE_SYSTEM = [
  "Judge whether each pair describes the same concrete news event.",
  "sameEvent requires matching actors, action, time, and outcome.",
  "materialUpdate is true only for a new decision, result, data release, or confirmed development.",
  "Do not merge merely because the subject or person is the same.",
].join(" ");

export const LESSON_SYSTEM = [
  "Create a natural Swedish news-learning lesson from one supplied public source article.",
  "Return a complete new draft; when repairReason is present, correct that failure without omitting any required field.",
  "Write naturally in Swedish; label observed difficulty only and never simplify to a target level.",
  "Do not simplify toward a CEFR target; only label observed difficulty.",
  "Use no facts beyond the supplied source text.",
  "Never add unsupported numbers, people, causal claims, or background facts; omit uncertain details.",
  "Write 360 to 440 Swedish words across the study paragraphs so the final text remains safely inside the required 300-to-500-word validation range.",
  "Count only the Swedish study-paragraph text before returning; titles, summaries, quotes, and annotations do not count.",
  "Provide Swedish, Chinese, and English summaries.",
  "Create 6 to 18 useful vocabulary, phrase, or grammar annotations with unique IDs and unique kind-plus-canonical pairs.",
  "Every annotation needs Chinese and English explanations and at least one exact standalone target occurrence in the study paragraphs.",
  "Choose non-overlapping annotation targets: no target occurrence may sit inside or overlap another annotation target occurrence.",
  "For vocabulary annotations, canonical and lemma must be identical.",
  "Quote 2 to 4 short source extracts, each at most 25 Swedish words and at most 80 quoted words total.",
  "Every quote must be unique and appear verbatim in the source text with exactly matching spelling, punctuation, and whitespace.",
  "Every quoted sentence must contain at least one exact standalone form from an annotation that is also used in the study paragraphs.",
  "Each quote annotationIds entry must name only annotations whose target, source form, canonical form, verb form, or grammar fragment occurs in that exact quote.",
].join(" ");

export const FACT_CHECK_SYSTEM = [
  "Verify each supplied lesson claim against only the supplied primary source article body.",
  "Do not use related coverage, titles, prior knowledge, or inference beyond the primary source.",
  "Return one result for every claim ID.",
  "Mark supported true only when the claim is supported by the source, and copy a short verbatim evidence substring directly from sourceBody.",
  "Preserve the evidence spelling and punctuation; source line breaks or repeated whitespace may be returned as a single space.",
  "When repairReason is present, correct that verifier-format failure while still returning one result for every claim ID.",
].join(" ");
