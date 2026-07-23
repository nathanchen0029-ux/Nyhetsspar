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
  "Use no facts beyond the supplied source text.",
].join(" ");
