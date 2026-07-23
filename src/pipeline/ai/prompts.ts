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
  "Do not simplify toward a CEFR target; only label observed difficulty.",
  "Use no facts beyond the supplied source text.",
  "Never add unsupported numbers, people, causal claims, or background facts; omit uncertain details.",
  "Write 300 to 500 Swedish words across the study paragraphs.",
  "Provide Swedish, Chinese, and English summaries.",
  "Every vocabulary, phrase, and grammar item needs Chinese and English explanations.",
  "Quote 2 to 4 short source extracts, each at most 25 Swedish words and at most 80 quoted words total.",
  "A quote must appear verbatim in the source text.",
].join(" ");
