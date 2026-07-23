# Nyhetsspår Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a static Swedish-news learning site that publishes 2–3 deduplicated, bilingual lessons every morning from public SVT, Aftonbladet, and DN articles.

**Architecture:** A TypeScript pipeline runs in GitHub Actions, discovers public articles through RSS or section pages, rejects restricted content, deduplicates events, selects a seven-day-balanced set, and asks the OpenAI Responses API for schema-validated lesson drafts. The pipeline writes only derived lesson JSON and non-copyrighted metadata to the public repository. A React/Vite static application reads those files from GitHub Pages and keeps known vocabulary and progress in versioned browser localStorage.

**Tech Stack:** Node.js 22, pnpm 10, TypeScript 5, React 19, Vite 7, Zod 4, OpenAI JavaScript SDK with `responses.parse` and `zodTextFormat`, Cheerio, fast-xml-parser, robots-parser, Vitest, Testing Library, Playwright, GitHub Actions, GitHub Pages.

## Global Constraints

- Normal daily output is exactly 2 or 3 lesson articles.
- At least one selected article is Swedish/local and at least one is international.
- Politics, economy, daily life, culture, sport, and source representation are balanced over a rolling seven-day ledger.
- Duplicate events across sources or the prior seven days are suppressed; a materially updated event is labeled as follow-up coverage.
- Each Swedish study text contains 300–500 whitespace-delimited words, excluding titles, summaries, annotations, and labels.
- Article difficulty is labeled but never used as a selection filter or simplification target.
- Each lesson contains Chinese and English summaries and Chinese and English meanings for vocabulary, phrases, and grammar.
- Direct source quotations are limited to 2–4 extracts, at most 25 Swedish words each and 80 quoted words total per lesson.
- Full source article bodies are ephemeral: never commit them, upload them as artifacts, or print them in logs.
- Never bypass robots rules, login, subscription, paywall, or access-control behavior.
- The default model is `gpt-5.4-mini`, configurable with `OPENAI_MODEL`.
- Transient fetch/API failures are retried at most twice; a single operation has at most three total attempts.
- Format or word-count repair is attempted once.
- `OPENAI_API_KEY` is read only in the pipeline and must never be included in the browser bundle.
- GitHub Pages uses hash routing so deep links work on project pages without server rewrites.
- The public repository contains no personal learning state; known items and progress remain in localStorage.
- The monthly OpenAI spend target is USD 5, enforced operationally with request usage logging and an account-side budget.
- UI implementation tasks must invoke `frontend-design` before writing final CSS and `verification-before-completion` before claiming completion.

---

## Planned File Structure

```text
.
├── .env.example
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── pages.yml
├── README.md
├── data/
│   ├── cache/
│   │   └── index.json
│   └── editorial-ledger.json
├── index.html
├── package.json
├── playwright.config.ts
├── pnpm-lock.yaml
├── public/
│   └── data/
│       ├── index.json
│       └── lessons/
├── scripts/
│   ├── check-build-secrets.ts
│   ├── run-daily.ts
│   └── smoke-deployment.ts
├── src/
│   ├── contracts/
│   │   ├── content.ts
│   │   └── transient.ts
│   ├── pipeline/
│   │   ├── ai/
│   │   │   ├── gateway.ts
│   │   │   ├── openai-gateway.ts
│   │   │   └── prompts.ts
│   │   ├── dedupe/
│   │   │   ├── cluster.ts
│   │   │   └── normalize.ts
│   │   ├── lessons/
│   │   │   ├── decorate.ts
│   │   │   ├── generate.ts
│   │   │   └── validate.ts
│   │   ├── persistence/
│   │   │   └── repository.ts
│   │   ├── selection/
│   │   │   └── select.ts
│   │   ├── sources/
│   │   │   ├── access.ts
│   │   │   ├── adapters.ts
│   │   │   ├── article-parser.ts
│   │   │   ├── discovery.ts
│   │   │   ├── fetcher.ts
│   │   │   └── robots.ts
│   │   ├── clock.ts
│   │   └── run.ts
│   └── web/
│       ├── components/
│       │   ├── AnnotationText.tsx
│       │   ├── ArticleCard.tsx
│       │   ├── LanguageCard.tsx
│       │   └── Shell.tsx
│       ├── data/
│       │   └── repository.ts
│       ├── pages/
│       │   ├── HistoryPage.tsx
│       │   ├── KnownPage.tsx
│       │   ├── LessonPage.tsx
│       │   └── TodayPage.tsx
│       ├── storage/
│       │   ├── known.ts
│       │   └── progress.ts
│       ├── App.tsx
│       ├── main.tsx
│       └── styles.css
├── tests/
│   ├── contracts/
│   ├── e2e/
│   ├── fixtures/
│   │   └── sources/
│   ├── pipeline/
│   └── web/
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

The boundaries are deliberate:

- `contracts` contains every persisted and transient type shared across tasks.
- `pipeline/sources` performs network access and HTML/XML extraction only.
- `pipeline/dedupe` decides event identity but does not select topics.
- `pipeline/selection` applies editorial balance but does not call the model.
- `pipeline/lessons` converts one selected source article into publishable derived content.
- `pipeline/persistence` is the only module allowed to write lesson, ledger, index, or cache files.
- `web` never imports pipeline code or the OpenAI SDK.

---

### Task 1: Project Foundation and Versioned Content Contracts

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `index.html`
- Create: `src/contracts/content.ts`
- Create: `src/contracts/transient.ts`
- Create: `tests/contracts/content.test.ts`
- Create: `public/data/index.json`

**Interfaces:**
- Produces: `DailyLessonSchema`, `LessonArticleSchema`, `EditorialLedgerSchema`, `SourceArticle`, `CandidateLink`, `SourceAdapter`, and their inferred TypeScript types.
- Consumes: no application interfaces.

- [ ] **Step 1: Add package and tool configuration**

Create `package.json`:

```json
{
  "name": "nyhetsspar",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.0.0",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "pipeline": "tsx scripts/run-daily.ts",
    "check:secrets": "tsx scripts/check-build-secrets.ts",
    "smoke": "tsx scripts/smoke-deployment.ts"
  },
  "dependencies": {
    "cheerio": "^1.1.0",
    "fast-xml-parser": "^5.0.0",
    "openai": "^6.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0",
    "robots-parser": "^3.0.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.55.0",
    "@testing-library/jest-dom": "^6.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.0.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "jsdom": "^26.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.9.0",
    "vite": "^7.0.0",
    "vitest": "^3.0.0"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "types": ["node", "vitest/globals", "@testing-library/jest-dom"],
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "scripts", "tests", "*.ts"]
}
```

Create `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repository = process.env.GITHUB_REPOSITORY?.split("/")[1];

export default defineConfig({
  plugins: [react()],
  base: repository ? `/${repository}/` : "/",
});
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    setupFiles: [],
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
});
```

Create `index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="每天通过真实瑞典新闻学习瑞典语" />
    <title>Nyhetsspår</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/web/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Install dependencies and lock them**

Run:

```bash
pnpm install
```

Expected: exit code 0 and a new `pnpm-lock.yaml`.

- [ ] **Step 3: Write failing contract tests**

Create `tests/contracts/content.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DailyLessonSchema,
  EditorialLedgerSchema,
  countSwedishWords,
} from "../../src/contracts/content";

describe("persisted content contracts", () => {
  it("accepts a 300-word lesson and rejects a 299-word lesson", () => {
    const words300 = Array.from({ length: 300 }, (_, index) => `ord${index}`).join(" ");
    const words299 = Array.from({ length: 299 }, (_, index) => `ord${index}`).join(" ");
    expect(countSwedishWords(words300)).toBe(300);
    expect(countSwedishWords(words299)).toBe(299);
  });

  it("requires bilingual summaries and annotation meanings", () => {
    const firstHalf = Array.from({ length: 150 }, (_, index) => `ord${index}`).join(" ");
    const secondHalf = Array.from({ length: 150 }, (_, index) => `nyhet${index}`).join(" ");
    const lesson = {
      schemaVersion: 1,
      date: "2026-07-23",
      timezone: "Europe/Stockholm",
      generatedAt: "2026-07-23T05:05:00.000Z",
      status: "ready",
      sourceHealth: { svt: "ok", aftonbladet: "ok", dn: "ok" },
      selectionSummary: "Balanced Sweden and international coverage.",
      articles: [
        {
          id: "lesson-1",
          eventFingerprint: "kommun-atervinning-2026",
          source: "svt",
          sourceUrl: "https://www.svt.se/nyheter/test",
          sourceTitle: "Testnyhet",
          publishedAt: "2026-07-23T04:00:00.000Z",
          scope: "sweden",
          topic: "daily-life",
          isFollowUp: false,
          difficulty: {
            level: "B1-B2",
            reasons: ["passiv form"],
            readingMinutes: 9
          },
          studyTitle: "Nya regler för återvinning",
          studyParagraphs: [
            {
              id: "p1",
              segments: [{ text: firstHalf }]
            },
            {
              id: "p2",
              segments: [{ text: secondHalf }]
            },
          ],
          wordCount: 300,
          summaries: {
            sv: "En svensk sammanfattning.",
            zh: "中文摘要。",
            en: "English summary."
          },
          factPoints: [
            "Kommunerna får nya regler.",
            "Beslutet börjar gälla nästa år."
          ],
          originalSentenceNotes: [
            {
              quote: "Kommunerna får nya regler.",
              sourceUrl: "https://www.svt.se/nyheter/test",
              annotationIds: ["vocabulary:ansvar"]
            },
            {
              quote: "Beslutet börjar gälla nästa år.",
              sourceUrl: "https://www.svt.se/nyheter/test",
              annotationIds: ["vocabulary:ansvar"]
            }
          ],
          annotations: [
            {
              id: "vocabulary:ansvar",
              kind: "vocabulary",
              canonical: "ansvar",
              targets: ["ansvar"],
              meaningZh: "责任",
              meaningEn: "responsibility",
              exampleSv: "Kommunen har ett stort ansvar.",
              surface: "ansvar",
              lemma: "ansvar",
              partOfSpeech: "substantiv",
              inflections: ["ansvaret"],
              compoundParts: [],
              note: ""
            }
          ],
          relatedCoverage: [],
          generationModel: "gpt-5.4-mini",
          contentHash: "sha256:test"
        }
      ]
    };
    expect(DailyLessonSchema.parse(lesson).articles[0]?.summaries.zh).toBe("中文摘要。");
  });

  it("requires seven-day ledger counters and event history", () => {
    const ledger = EditorialLedgerSchema.parse({
      schemaVersion: 1,
      days: [],
    });
    expect(ledger.days).toEqual([]);
  });
});
```

- [ ] **Step 4: Run the contract test and confirm failure**

Run:

```bash
pnpm vitest run tests/contracts/content.test.ts
```

Expected: FAIL because `src/contracts/content.ts` does not exist.

- [ ] **Step 5: Implement the persisted and transient contracts**

Create `src/contracts/content.ts`:

```ts
import { z } from "zod";

export const SourceSchema = z.enum(["svt", "aftonbladet", "dn"]);
export const ScopeSchema = z.enum(["local", "sweden", "international"]);
export const TopicSchema = z.enum(["politics", "economy", "daily-life", "culture", "sports"]);
export const SourceHealthSchema = z.enum(["ok", "partial", "failed"]);

export function countSwedishWords(text: string): number {
  return text
    .trim()
    .split(/\s+/u)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

export const TextSegmentSchema = z.object({
  text: z.string().min(1),
  annotationId: z.string().min(1).optional(),
});

export const StudyParagraphSchema = z.object({
  id: z.string().min(1),
  segments: z.array(TextSegmentSchema).min(1),
});

const AnnotationBaseSchema = z.object({
  id: z.string().min(1),
  canonical: z.string().min(1),
  targets: z.array(z.string().min(1)).min(1),
  meaningZh: z.string().min(1),
  meaningEn: z.string().min(1),
  exampleSv: z.string().min(1),
});

export const VocabularyAnnotationSchema = AnnotationBaseSchema.extend({
  kind: z.literal("vocabulary"),
  surface: z.string().min(1),
  lemma: z.string().min(1),
  partOfSpeech: z.string().min(1),
  inflections: z.array(z.string()),
  compoundParts: z.array(z.string()),
  note: z.string(),
});

export const PhraseAnnotationSchema = AnnotationBaseSchema.extend({
  kind: z.literal("phrase"),
  sourceForm: z.string().min(1),
  canonicalForm: z.string().min(1),
  verbForms: z.array(z.string()),
  usage: z.string().min(1),
});

export const GrammarAnnotationSchema = AnnotationBaseSchema.extend({
  kind: z.literal("grammar"),
  grammarId: z.string().min(1),
  sourceFragment: z.string().min(1),
  nameZh: z.string().min(1),
  nameEn: z.string().min(1),
  explanationZh: z.string().min(1),
  explanationEn: z.string().min(1),
});

export const AnnotationSchema = z.discriminatedUnion("kind", [
  VocabularyAnnotationSchema,
  PhraseAnnotationSchema,
  GrammarAnnotationSchema,
]);

export const OriginalSentenceNoteSchema = z.object({
  quote: z.string().min(1),
  sourceUrl: z.string().url(),
  annotationIds: z.array(z.string()).min(1),
});

export const RelatedCoverageSchema = z.object({
  source: SourceSchema,
  title: z.string().min(1),
  url: z.string().url(),
});

export const LessonArticleSchema = z.object({
  id: z.string().min(1),
  eventFingerprint: z.string().min(1),
  source: SourceSchema,
  sourceUrl: z.string().url(),
  sourceTitle: z.string().min(1),
  publishedAt: z.string().datetime(),
  scope: ScopeSchema,
  topic: TopicSchema,
  isFollowUp: z.boolean(),
  difficulty: z.object({
    level: z.string().regex(/^(?:A1|A2|B1|B2|C1|C2)(?:[–-](?:A1|A2|B1|B2|C1|C2))?$/u),
    reasons: z.array(z.string().min(1)).min(1),
    readingMinutes: z.number().int().positive(),
  }),
  studyTitle: z.string().min(1),
  studyParagraphs: z.array(StudyParagraphSchema).min(2),
  wordCount: z.number().int().min(300).max(500),
  summaries: z.object({
    sv: z.string().min(1),
    zh: z.string().min(1),
    en: z.string().min(1),
  }),
  factPoints: z.array(z.string().min(1)).min(2),
  originalSentenceNotes: z.array(OriginalSentenceNoteSchema).min(2).max(4),
  annotations: z.array(AnnotationSchema),
  relatedCoverage: z.array(RelatedCoverageSchema),
  generationModel: z.string().min(1),
  contentHash: z.string().min(1),
});

export const DailyLessonSchema = z.object({
  schemaVersion: z.literal(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  timezone: z.literal("Europe/Stockholm"),
  generatedAt: z.string().datetime(),
  status: z.enum(["ready", "delayed"]),
  sourceHealth: z.object({
    svt: SourceHealthSchema,
    aftonbladet: SourceHealthSchema,
    dn: SourceHealthSchema,
  }),
  selectionSummary: z.string().min(1),
  articles: z.array(LessonArticleSchema).max(3),
});

export const EditorialDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  scopes: z.record(ScopeSchema, z.number().int().nonnegative()),
  topics: z.record(TopicSchema, z.number().int().nonnegative()),
  sources: z.record(SourceSchema, z.number().int().nonnegative()),
  eventFingerprints: z.array(z.string()),
});

export const EditorialLedgerSchema = z.object({
  schemaVersion: z.literal(1),
  days: z.array(EditorialDaySchema).max(7),
});

export const LessonIndexEntrySchema = z.object({
  date: z.string(),
  status: z.enum(["ready", "delayed"]),
  articles: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      source: SourceSchema,
      scope: ScopeSchema,
      topic: TopicSchema,
      difficulty: z.string(),
      isFollowUp: z.boolean(),
    }),
  ),
});

export const LessonIndexSchema = z.object({
  schemaVersion: z.literal(1),
  dates: z.array(LessonIndexEntrySchema),
});

export type Source = z.infer<typeof SourceSchema>;
export type Scope = z.infer<typeof ScopeSchema>;
export type Topic = z.infer<typeof TopicSchema>;
export type Annotation = z.infer<typeof AnnotationSchema>;
export type LessonArticle = z.infer<typeof LessonArticleSchema>;
export type DailyLesson = z.infer<typeof DailyLessonSchema>;
export type EditorialLedger = z.infer<typeof EditorialLedgerSchema>;
export type LessonIndex = z.infer<typeof LessonIndexSchema>;
```

Create `src/contracts/transient.ts`:

```ts
import type { Scope, Source, Topic } from "./content";

export interface CandidateLink {
  source: Source;
  url: string;
  discoveredTitle: string;
  discoveredAt: string;
  sectionHint?: string;
}

export interface SourceArticle {
  id: string;
  source: Source;
  url: string;
  canonicalUrl: string;
  title: string;
  publishedAt: string;
  body: string;
  contentHash: string;
  isAccessibleForFree: boolean;
  sectionHint?: string;
}

export interface EventFingerprint {
  candidateId: string;
  who: string[];
  action: string;
  where: string;
  when: string;
  outcome: string;
  scope: Scope;
  topic: Topic;
  canonical: string;
}

export interface FingerprintedArticle {
  article: SourceArticle;
  fingerprint: EventFingerprint;
  related: SourceArticle[];
  isFollowUp: boolean;
}

export interface FetchResponse {
  url: string;
  status: number;
  headers: Headers;
  text: string;
}

export interface Fetcher {
  fetchText(url: string): Promise<FetchResponse>;
}

export interface SourceAdapter {
  source: Source;
  discover(now: Date, fetcher: Fetcher): Promise<CandidateLink[]>;
}
```

Create `public/data/index.json`:

```json
{
  "schemaVersion": 1,
  "dates": []
}
```

- [ ] **Step 6: Run contract tests and type checking**

Run:

```bash
pnpm vitest run tests/contracts/content.test.ts
pnpm exec tsc --noEmit
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit the foundation**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vite.config.ts vitest.config.ts index.html src/contracts tests/contracts public/data
git commit -m "chore: scaffold Nyhetsspår contracts"
```

---

### Task 2: Safe Fetching, robots Rules, Public-Access Detection, and Article Parsing

**Files:**
- Create: `src/pipeline/sources/fetcher.ts`
- Create: `src/pipeline/sources/robots.ts`
- Create: `src/pipeline/sources/access.ts`
- Create: `src/pipeline/sources/article-parser.ts`
- Create: `tests/fixtures/sources/public-article.html`
- Create: `tests/fixtures/sources/paywalled-article.html`
- Create: `tests/fixtures/sources/login-wall.html`
- Create: `tests/fixtures/sources/video-only.html`
- Create: `tests/fixtures/sources/live-feed.html`
- Create: `tests/pipeline/sources-core.test.ts`

**Interfaces:**
- Consumes: `Fetcher`, `FetchResponse`, `SourceArticle`, and `Source`.
- Produces: `createHttpFetcher`, `createRobotsGuard`, `classifyAccess`, and `parseArticle`.

- [ ] **Step 1: Add synthetic source fixtures**

Create `tests/fixtures/sources/public-article.html`:

```html
<!doctype html>
<html>
  <head>
    <link rel="canonical" href="https://example.test/nyheter/offentlig" />
    <script type="application/ld+json">
      {
        "@type": "NewsArticle",
        "headline": "Kommunerna får nya regler",
        "datePublished": "2026-07-23T04:00:00Z",
        "isAccessibleForFree": true
      }
    </script>
  </head>
  <body>
    <main>
      <article>
        <p>Kommunerna får nya regler för återvinning från nästa år.</p>
        <p>Beslutet ska göra sorteringen enklare för invånarna.</p>
        <p>Regeringen följer resultatet under de kommande två åren.</p>
        <p>Kommunerna ska informera hushållen om hur det nya systemet fungerar.</p>
        <p>Företagen får samtidigt tydligare ansvar för insamling och rapportering.</p>
        <p>De första resultaten ska redovisas under hösten året därpå.</p>
        <p>Förslaget har diskuterats med flera kommuner och berörda organisationer.</p>
        <p>Myndigheten bedömer att övergången kräver tydlig och tidig information.</p>
        <p>Hushållen får nya anvisningar innan reglerna börjar gälla nationellt.</p>
        <p>Kommunerna ansvarar själva för hur informationen sprids till invånarna.</p>
        <p>Det gamla systemet fortsätter under en kort övergångsperiod nästa år.</p>
        <p>Flera kommuner planerar också att utbilda personal vid återvinningscentralerna.</p>
        <p>Företagen ska lämna uppgifter om mängder och olika typer av avfall.</p>
        <p>Uppgifterna ska hjälpa myndigheten att följa reformens praktiska effekter.</p>
        <p>En första utvärdering genomförs när systemet har använts ett år.</p>
        <p>Därefter kan reglerna justeras om sorteringen inte fungerar som planerat.</p>
        <p>Organisationerna välkomnar tydligare ansvar men efterfrågar långsiktig finansiering.</p>
        <p>Kommunerna vill samtidigt ha gemensamma digitala verktyg för rapporteringen.</p>
        <p>Regeringen säger att mer detaljerade instruktioner kommer före årsskiftet.</p>
        <p>Invånarna behöver inte vidta några åtgärder innan informationen skickas ut.</p>
      </article>
    </main>
  </body>
</html>
```

Create `tests/fixtures/sources/paywalled-article.html`:

```html
<!doctype html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@type": "NewsArticle",
        "headline": "Låst artikel",
        "datePublished": "2026-07-23T04:00:00Z",
        "isAccessibleForFree": false
      }
    </script>
  </head>
  <body>
    <main><p>Logga in för att läsa vidare.</p></main>
  </body>
</html>
```

Create `tests/fixtures/sources/login-wall.html`:

```html
<!doctype html>
<html><body><main><p>Logga in för att läsa vidare.</p></main></body></html>
```

Create `tests/fixtures/sources/video-only.html`:

```html
<!doctype html>
<html><body><main><video controls></video><p>Se hela inslaget i videon.</p></main></body></html>
```

Create `tests/fixtures/sources/live-feed.html`:

```html
<!doctype html>
<html><body><main class="live-feed"><p>Direktrapportering pågår.</p></main></body></html>
```

- [ ] **Step 2: Write failing source-core tests**

Create `tests/pipeline/sources-core.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { classifyAccess } from "../../src/pipeline/sources/access";
import { parseArticle } from "../../src/pipeline/sources/article-parser";
import { createHttpFetcher } from "../../src/pipeline/sources/fetcher";
import { createRobotsGuard } from "../../src/pipeline/sources/robots";

describe("source safety core", () => {
  it("parses a public NewsArticle without persisting unrelated markup", async () => {
    const html = await readFile("tests/fixtures/sources/public-article.html", "utf8");
    const result = parseArticle("svt", "https://example.test/nyheter/offentlig", html);
    expect(result.title).toBe("Kommunerna får nya regler");
    expect(result.isAccessibleForFree).toBe(true);
    expect(result.body).toContain("sorteringen enklare");
    expect(result.body).not.toContain("<script");
  });

  it("rejects an explicit paywall", async () => {
    const html = await readFile("tests/fixtures/sources/paywalled-article.html", "utf8");
    expect(classifyAccess(html)).toEqual({
      accessible: false,
      reason: "structured-paywall",
    });
  });

  it.each([
    ["login-wall.html", "login-wall"],
    ["video-only.html", "video-only"],
    ["live-feed.html", "live-feed"],
  ])("rejects unstable or restricted text in %s", async (fixture, reason) => {
    const html = await readFile(`tests/fixtures/sources/${fixture}`, "utf8");
    expect(classifyAccess(html)).toEqual({ accessible: false, reason });
  });

  it("retries transient responses exactly twice", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const fetcher = createHttpFetcher({ fetchImpl, sleep: async () => undefined });
    const response = await fetcher.fetchText("https://example.test/article");
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not fetch a path disallowed by robots rules", async () => {
    const guard = createRobotsGuard({
      async fetchText(url) {
        return {
          url,
          status: 200,
          headers: new Headers(),
          text: "User-agent: *\nDisallow: /locked",
        };
      },
    });
    await expect(guard.isAllowed("https://example.test/locked/article")).resolves.toBe(false);
  });
});
```

- [ ] **Step 3: Run source-core tests and confirm failure**

Run:

```bash
pnpm vitest run tests/pipeline/sources-core.test.ts
```

Expected: FAIL because the source-core modules do not exist.

- [ ] **Step 4: Implement safe fetching and parsing**

Create `src/pipeline/sources/fetcher.ts`:

```ts
import type { Fetcher, FetchResponse } from "../../contracts/transient";

const USER_AGENT = "Nyhetsspar/1.0 (+public educational reader; one daily fetch)";

interface FetcherOptions {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  minimumOriginIntervalMs?: number;
  now?: () => number;
}

export function createHttpFetcher(options: FetcherOptions = {}): Fetcher {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const minimumOriginIntervalMs = options.minimumOriginIntervalMs ?? 1_000;
  const nextAllowedAt = new Map<string, number>();
  const sleep =
    options.sleep ??
    ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  return {
    async fetchText(url: string): Promise<FetchResponse> {
      let lastError: Error | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const origin = new URL(url).origin;
          const scheduledAt = Math.max(now(), nextAllowedAt.get(origin) ?? 0);
          const wait = scheduledAt - now();
          nextAllowedAt.set(origin, scheduledAt + minimumOriginIntervalMs);
          if (wait > 0) await sleep(wait);
          const response = await fetchImpl(url, {
            headers: {
              "user-agent": USER_AGENT,
              accept: "text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.1",
            },
            redirect: "follow",
            signal: AbortSignal.timeout(15_000),
          });
          const text = await response.text();
          if (response.status >= 500 || response.status === 429) {
            throw new Error(`transient-http-${response.status}`);
          }
          return {
            url: response.url || url,
            status: response.status,
            headers: response.headers,
            text,
          };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt < 2) {
            await sleep(2_000 * 4 ** attempt);
          }
        }
      }
      throw lastError ?? new Error("fetch-failed");
    },
  };
}
```

Create `src/pipeline/sources/robots.ts`:

```ts
import robotsParser from "robots-parser";
import type { Fetcher } from "../../contracts/transient";

const USER_AGENT = "Nyhetsspar";

export interface RobotsGuard {
  isAllowed(url: string): Promise<boolean>;
}

export function createRobotsGuard(fetcher: Fetcher): RobotsGuard {
  const cache = new Map<string, ReturnType<typeof robotsParser>>();

  return {
    async isAllowed(url: string): Promise<boolean> {
      const parsed = new URL(url);
      const origin = parsed.origin;
      let rules = cache.get(origin);
      if (!rules) {
        const robotsUrl = new URL("/robots.txt", origin).toString();
        const response = await fetcher.fetchText(robotsUrl);
        rules = robotsParser(robotsUrl, response.status === 200 ? response.text : "");
        cache.set(origin, rules);
      }
      return rules.isAllowed(url, USER_AGENT) !== false;
    },
  };
}
```

Create `src/pipeline/sources/access.ts`:

```ts
import { load } from "cheerio";

export type AccessDecision =
  | { accessible: true; reason: "public" }
  | {
      accessible: false;
      reason:
        | "structured-paywall"
        | "login-wall"
        | "paywall-marker"
        | "video-only"
        | "live-feed"
        | "insufficient-text";
    };

export function classifyAccess(html: string): AccessDecision {
  const $ = load(html);
  const scripts = $('script[type="application/ld+json"]')
    .map((_, element) => $(element).text())
    .get();

  for (const raw of scripts) {
    try {
      const data: unknown = JSON.parse(raw);
      const nodes = Array.isArray(data)
        ? data
        : typeof data === "object" && data !== null && "@graph" in data
          ? (data as { "@graph": unknown[] })["@graph"]
          : [data];
      for (const node of nodes) {
        if (
          typeof node === "object" &&
          node !== null &&
          "isAccessibleForFree" in node &&
          (node as { isAccessibleForFree: unknown }).isAccessibleForFree === false
        ) {
          return { accessible: false, reason: "structured-paywall" };
        }
      }
    } catch {
      continue;
    }
  }

  const pageText = $("body").text().replace(/\s+/gu, " ").toLowerCase();
  if (/logga in för att läsa|sign in to continue/u.test(pageText)) {
    return { accessible: false, reason: "login-wall" };
  }
  if (/prenumerera för att läsa|endast för prenumeranter|plusartikel/u.test(pageText)) {
    return { accessible: false, reason: "paywall-marker" };
  }
  const articleText = $("article p, main p")
    .map((_, element) => $(element).text().trim())
    .get()
    .join(" ");
  const articleWordCount = articleText.split(/\s+/u).filter(Boolean).length;
  if ($("video").length > 0 && articleWordCount < 80) {
    return { accessible: false, reason: "video-only" };
  }
  if ($(".live-feed, [data-live], [data-testid*='live']").length > 0 && articleWordCount < 200) {
    return { accessible: false, reason: "live-feed" };
  }
  if (articleWordCount < 180) {
    return { accessible: false, reason: "insufficient-text" };
  }
  return { accessible: true, reason: "public" };
}
```

Create `src/pipeline/sources/article-parser.ts`:

```ts
import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { Source } from "../../contracts/content";
import type { SourceArticle } from "../../contracts/transient";
import { classifyAccess } from "./access";

function jsonLdNodes(html: string): Record<string, unknown>[] {
  const $ = load(html);
  const nodes: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const parsed: unknown = JSON.parse($(element).text());
      const values = Array.isArray(parsed)
        ? parsed
        : typeof parsed === "object" && parsed !== null && "@graph" in parsed
          ? (parsed as { "@graph": unknown[] })["@graph"]
          : [parsed];
      for (const value of values) {
        if (typeof value === "object" && value !== null) {
          nodes.push(value as Record<string, unknown>);
        }
      }
    } catch {
      return;
    }
  });
  return nodes;
}

function normalizeCanonical(raw: string, base: string): string {
  const canonical = new URL(raw, base);
  canonical.hash = "";
  for (const key of [...canonical.searchParams.keys()]) {
    if (/^(?:utm_|fbclid|cmpid|ref)/u.test(key)) canonical.searchParams.delete(key);
  }
  return canonical.toString();
}

export function parseArticle(source: Source, url: string, html: string): SourceArticle {
  const access = classifyAccess(html);
  const $ = load(html);
  const newsNode = jsonLdNodes(html).find((node) => {
    const type = node["@type"];
    return type === "NewsArticle" || (Array.isArray(type) && type.includes("NewsArticle"));
  });
  const title =
    (typeof newsNode?.headline === "string" ? newsNode.headline : undefined) ??
    $("h1").first().text().trim();
  const publishedAt =
    (typeof newsNode?.datePublished === "string" ? newsNode.datePublished : undefined) ??
    $("time[datetime]").first().attr("datetime");
  const canonicalUrl = normalizeCanonical(
    $('link[rel="canonical"]').attr("href") ??
      (typeof newsNode?.url === "string" ? newsNode.url : url),
    url,
  );
  const bodyFromJson =
    typeof newsNode?.articleBody === "string" ? newsNode.articleBody.trim() : "";
  const body =
    bodyFromJson ||
    $("article p, main p")
      .map((_, element) => $(element).text().replace(/\s+/gu, " ").trim())
      .get()
      .filter((paragraph) => paragraph.length >= 30)
      .join("\n\n");

  if (!title || !publishedAt || !body) {
    throw new Error(`article-parse-incomplete:${source}:${url}`);
  }

  return {
    id: createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 16),
    source,
    url,
    canonicalUrl,
    title,
    publishedAt: new Date(publishedAt).toISOString(),
    body,
    contentHash: `sha256:${createHash("sha256").update(body).digest("hex")}`,
    isAccessibleForFree: access.accessible,
  };
}
```

- [ ] **Step 5: Run source-core tests**

Run:

```bash
pnpm vitest run tests/pipeline/sources-core.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Commit source safety core**

```bash
git add src/pipeline/sources tests/fixtures/sources tests/pipeline/sources-core.test.ts
git commit -m "feat: add safe public article parser"
```

---

### Task 3: SVT, Aftonbladet, and DN Discovery Adapters

**Files:**
- Create: `src/pipeline/sources/discovery.ts`
- Create: `src/pipeline/sources/adapters.ts`
- Create: `tests/fixtures/sources/aftonbladet-feed.xml`
- Create: `tests/fixtures/sources/svt-section.html`
- Create: `tests/fixtures/sources/dn-section.html`
- Create: `tests/pipeline/adapters.test.ts`

**Interfaces:**
- Consumes: `CandidateLink`, `Fetcher`, `SourceAdapter`.
- Produces: `createSourceAdapters()` returning exactly three adapters and `discoverFromHtmlPages`.

- [ ] **Step 1: Create minimal synthetic discovery fixtures**

Create `tests/fixtures/sources/aftonbladet-feed.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Ny svensk regel presenteras</title>
      <link>https://www.aftonbladet.se/nyheter/a/example/ny-svensk-regel</link>
      <pubDate>Thu, 23 Jul 2026 04:30:00 GMT</pubDate>
    </item>
  </channel>
</rss>
```

Create `tests/fixtures/sources/svt-section.html`:

```html
<!doctype html>
<html><body><a href="/nyheter/inrikes/exempel">Kommunerna får nya regler</a></body></html>
```

Create `tests/fixtures/sources/dn-section.html`:

```html
<!doctype html>
<html><body><a href="/sverige/nytt-forslag/">Nytt förslag presenteras</a></body></html>
```

- [ ] **Step 2: Write failing adapter tests**

Create `tests/pipeline/adapters.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { Fetcher } from "../../src/contracts/transient";
import { createSourceAdapters } from "../../src/pipeline/sources/adapters";

function fixtureFetcher(fixtures: Record<string, string>): Fetcher {
  return {
    async fetchText(url) {
      const text = fixtures[url];
      if (!text) {
        throw new Error(`missing-fixture:${url}`);
      }
      return {
        url,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        text,
      };
    },
  };
}

describe("source adapters", () => {
  it("discovers candidates from all three sources", async () => {
    const [feed, svt, dn] = await Promise.all([
      readFile("tests/fixtures/sources/aftonbladet-feed.xml", "utf8"),
      readFile("tests/fixtures/sources/svt-section.html", "utf8"),
      readFile("tests/fixtures/sources/dn-section.html", "utf8"),
    ]);
    const fetcher = fixtureFetcher({
      "https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/": feed,
      "https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/sport/": feed,
      "https://rss.aftonbladet.se/rss2/small/pages/sections/kultur/": feed,
      "https://www.svt.se/nyheter": svt,
      "https://www.svt.se/sport": svt,
      "https://www.dn.se/sverige/": dn,
      "https://www.dn.se/varlden/": dn,
      "https://www.dn.se/ekonomi/": dn,
      "https://www.dn.se/kultur/": dn,
      "https://www.dn.se/sport/": dn,
    });
    const adapters = createSourceAdapters();
    const results = await Promise.all(
      adapters.map((adapter) => adapter.discover(new Date("2026-07-23T05:00:00Z"), fetcher)),
    );
    expect(results.map((items) => items[0]?.source)).toEqual(["svt", "aftonbladet", "dn"]);
    expect(results.flat().every((item) => item.url.startsWith("https://"))).toBe(true);
  });
});
```

- [ ] **Step 3: Run the adapter test and confirm failure**

Run:

```bash
pnpm vitest run tests/pipeline/adapters.test.ts
```

Expected: FAIL because `createSourceAdapters` is missing.

- [ ] **Step 4: Implement reusable page/feed discovery**

Create `src/pipeline/sources/discovery.ts`:

```ts
import { load } from "cheerio";
import { XMLParser } from "fast-xml-parser";
import type { Source } from "../../contracts/content";
import type { CandidateLink, Fetcher } from "../../contracts/transient";

export async function discoverFromHtmlPages(
  source: Source,
  pages: string[],
  allowedPath: RegExp,
  now: Date,
  fetcher: Fetcher,
): Promise<CandidateLink[]> {
  const found = new Map<string, CandidateLink>();
  for (const page of pages) {
    const response = await fetcher.fetchText(page);
    const $ = load(response.text);
    $("a[href]").each((_, element) => {
      const href = $(element).attr("href");
      const title = $(element).text().replace(/\s+/gu, " ").trim();
      if (!href || title.length < 12) {
        return;
      }
      const url = new URL(href, page);
      if (url.protocol !== "https:" || !allowedPath.test(url.pathname)) {
        return;
      }
      url.search = "";
      const normalized = url.toString();
      found.set(normalized, {
        source,
        url: normalized,
        discoveredTitle: title,
        discoveredAt: now.toISOString(),
        sectionHint: new URL(page).pathname,
      });
    });
  }
  return [...found.values()].slice(0, 40);
}

export async function discoverFromRss(
  source: Source,
  feeds: string[],
  now: Date,
  fetcher: Fetcher,
): Promise<CandidateLink[]> {
  const parser = new XMLParser({ ignoreAttributes: false });
  const found = new Map<string, CandidateLink>();
  for (const feed of feeds) {
    const response = await fetcher.fetchText(feed);
    const parsed = parser.parse(response.text) as {
      rss?: { channel?: { item?: unknown | unknown[] } };
    };
    const rawItems = parsed.rss?.channel?.item;
    const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
    for (const raw of items) {
      if (typeof raw !== "object" || raw === null) {
        continue;
      }
      const item = raw as { title?: unknown; link?: unknown };
      if (typeof item.title !== "string" || typeof item.link !== "string") {
        continue;
      }
      const url = new URL(item.link);
      url.search = "";
      found.set(url.toString(), {
        source,
        url: url.toString(),
        discoveredTitle: item.title,
        discoveredAt: now.toISOString(),
        sectionHint: new URL(feed).pathname,
      });
    }
  }
  return [...found.values()].slice(0, 40);
}
```

Create `src/pipeline/sources/adapters.ts`:

```ts
import type { SourceAdapter } from "../../contracts/transient";
import { discoverFromHtmlPages, discoverFromRss } from "./discovery";

const svt: SourceAdapter = {
  source: "svt",
  discover(now, fetcher) {
    return discoverFromHtmlPages(
      "svt",
      ["https://www.svt.se/nyheter", "https://www.svt.se/sport"],
      /^\/(?:nyheter|sport)\//u,
      now,
      fetcher,
    );
  },
};

const aftonbladet: SourceAdapter = {
  source: "aftonbladet",
  discover(now, fetcher) {
    return discoverFromRss(
      "aftonbladet",
      [
        "https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/",
        "https://rss.aftonbladet.se/rss2/small/pages/sections/senastenytt/sport/",
        "https://rss.aftonbladet.se/rss2/small/pages/sections/kultur/",
      ],
      now,
      fetcher,
    );
  },
};

const dn: SourceAdapter = {
  source: "dn",
  discover(now, fetcher) {
    return discoverFromHtmlPages(
      "dn",
      [
        "https://www.dn.se/sverige/",
        "https://www.dn.se/varlden/",
        "https://www.dn.se/ekonomi/",
        "https://www.dn.se/kultur/",
        "https://www.dn.se/sport/",
      ],
      /^\/(?:sverige|varlden|ekonomi|kultur|sport)\//u,
      now,
      fetcher,
    );
  },
};

export function createSourceAdapters(): SourceAdapter[] {
  return [svt, aftonbladet, dn];
}
```

- [ ] **Step 5: Run adapters and source-core tests**

Run:

```bash
pnpm vitest run tests/pipeline/adapters.test.ts tests/pipeline/sources-core.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit all three adapters**

```bash
git add src/pipeline/sources tests/fixtures/sources tests/pipeline/adapters.test.ts
git commit -m "feat: discover news from three Swedish sources"
```

---

### Task 4: OpenAI Gateway, Event Fingerprints, and Cross-Source Deduplication

**Files:**
- Create: `src/pipeline/ai/gateway.ts`
- Create: `src/pipeline/ai/openai-gateway.ts`
- Create: `src/pipeline/ai/prompts.ts`
- Create: `src/pipeline/dedupe/normalize.ts`
- Create: `src/pipeline/dedupe/cluster.ts`
- Create: `tests/pipeline/dedupe.test.ts`

**Interfaces:**
- Consumes: `SourceArticle`, `EventFingerprint`, `EditorialLedger`.
- Produces: `NewsAiGateway.fingerprint`, `NewsAiGateway.reviewPairs`, `normalizeTitle`, `deduplicateArticles`.

- [ ] **Step 1: Write failing dedupe tests with a fake AI gateway**

Create `tests/pipeline/dedupe.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { EditorialLedger } from "../../src/contracts/content";
import type { SourceArticle } from "../../src/contracts/transient";
import type { NewsAiGateway } from "../../src/pipeline/ai/gateway";
import { deduplicateArticles } from "../../src/pipeline/dedupe/cluster";

function article(id: string, source: SourceArticle["source"], title: string): SourceArticle {
  return {
    id,
    source,
    url: `https://example.test/${id}`,
    canonicalUrl: `https://example.test/${id}`,
    title,
    publishedAt: "2026-07-23T04:00:00.000Z",
    body: `${title}. Kommunerna har presenterat ett gemensamt beslut om återvinning.`,
    contentHash: `sha256:${id}`,
    isAccessibleForFree: true,
  };
}

const emptyLedger: EditorialLedger = { schemaVersion: 1, days: [] };

describe("event deduplication", () => {
  it("keeps one representative and attaches related coverage", async () => {
    const gateway: NewsAiGateway = {
      async fingerprint(articles) {
        return articles.map((item) => ({
          candidateId: item.id,
          who: ["kommunerna"],
          action: "nya regler för återvinning",
          where: "Sverige",
          when: "2026-07-23",
          outcome: "enklare sortering",
          scope: "sweden",
          topic: "daily-life",
          canonical: "kommunerna-nya-regler-atervinning-2026-07-23",
        }));
      },
      async reviewPairs(pairs) {
        return pairs.map((pair) => ({
          pairId: pair.pairId,
          sameEvent: true,
          confidence: 0.94,
          reason: "same decision",
          materialUpdate: false,
        }));
      },
    };
    const result = await deduplicateArticles(
      [
        article("svt-1", "svt", "Kommunerna får nya regler"),
        article("dn-1", "dn", "Nytt beslut ska ändra återvinningen"),
      ],
      emptyLedger,
      gateway,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.related).toHaveLength(1);
  });

  it("suppresses a seven-day repeat without a material update", async () => {
    const ledger: EditorialLedger = {
      schemaVersion: 1,
      days: [
        {
          date: "2026-07-22",
          scopes: { local: 0, sweden: 1, international: 1 },
          topics: { politics: 0, economy: 0, "daily-life": 1, culture: 1, sports: 0 },
          sources: { svt: 1, aftonbladet: 1, dn: 0 },
          eventFingerprints: ["kommunerna-nya-regler-atervinning-2026-07-23"],
        },
      ],
    };
    const gateway: NewsAiGateway = {
      async fingerprint(items) {
        return items.map((item) => ({
          candidateId: item.id,
          who: ["kommunerna"],
          action: "nya regler för återvinning",
          where: "Sverige",
          when: "2026-07-23",
          outcome: "enklare sortering",
          scope: "sweden",
          topic: "daily-life",
          canonical: "kommunerna-nya-regler-atervinning-2026-07-23",
        }));
      },
      async reviewPairs() {
        return [];
      },
    };
    const result = await deduplicateArticles(
      [article("svt-1", "svt", "Kommunerna får nya regler")],
      ledger,
      gateway,
    );
    expect(result).toEqual([]);
  });

  it("keeps different events about the same institution separate", async () => {
    const gateway: NewsAiGateway = {
      async fingerprint(items) {
        return items.map((item, index) => ({
          candidateId: item.id,
          who: ["regeringen"],
          action: index === 0 ? "presenterar en budget" : "utser en utredare",
          where: "Sverige",
          when: "2026-07-23",
          outcome: index === 0 ? "nya anslag" : "ny utredning",
          scope: "sweden",
          topic: "politics",
          canonical: index === 0 ? "regeringen-budget" : "regeringen-utredare",
        }));
      },
      async reviewPairs(pairs) {
        return pairs.map((pair) => ({
          pairId: pair.pairId,
          sameEvent: false,
          confidence: 0.98,
          reason: "different decisions",
          materialUpdate: false,
        }));
      },
    };
    const result = await deduplicateArticles(
      [
        article("budget", "svt", "Regeringen presenterar budget"),
        article("utredning", "dn", "Regeringen utser utredare"),
      ],
      emptyLedger,
      gateway,
    );
    expect(result).toHaveLength(2);
  });

  it("labels merged coverage with a material update as follow-up", async () => {
    const gateway: NewsAiGateway = {
      async fingerprint(items) {
        return items.map((item) => ({
          candidateId: item.id,
          who: ["valmyndigheten"],
          action: "publicerar valresultat",
          where: "Sverige",
          when: "2026-07-23",
          outcome: "slutligt resultat",
          scope: "sweden",
          topic: "politics",
          canonical: "valmyndigheten-slutligt-resultat",
        }));
      },
      async reviewPairs(pairs) {
        return pairs.map((pair) => ({
          pairId: pair.pairId,
          sameEvent: true,
          confidence: 0.96,
          reason: "new confirmed result",
          materialUpdate: true,
        }));
      },
    };
    const result = await deduplicateArticles(
      [
        article("preliminar", "svt", "Preliminärt valresultat"),
        article("slutligt", "dn", "Slutligt valresultat klart"),
      ],
      emptyLedger,
      gateway,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.isFollowUp).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
pnpm vitest run tests/pipeline/dedupe.test.ts
```

Expected: FAIL because the AI and dedupe modules are missing.

- [ ] **Step 3: Define the AI boundary and prompts**

Create `src/pipeline/ai/gateway.ts`:

```ts
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
  generateLesson(
    input: LessonGenerationInput,
    repairReason?: string,
  ): Promise<LessonArticle>;
}

export type AiGateway = NewsAiGateway & LessonAiGateway;
```

Create `src/pipeline/ai/prompts.ts`:

```ts
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
```

- [ ] **Step 4: Implement the current Responses API structured-output gateway**

Create `src/pipeline/ai/openai-gateway.ts` with Zod response schemas matching the interfaces:

```ts
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { ScopeSchema, TopicSchema } from "../../contracts/content";
import type { EventFingerprint } from "../../contracts/transient";
import type {
  NewsAiGateway,
  DuplicatePair,
  DuplicateReview,
} from "./gateway";
import { DUPLICATE_SYSTEM, FINGERPRINT_SYSTEM } from "./prompts";

const FingerprintBatchSchema = z.object({
  items: z.array(
    z.object({
      candidateId: z.string(),
      who: z.array(z.string()),
      action: z.string(),
      where: z.string(),
      when: z.string(),
      outcome: z.string(),
      scope: ScopeSchema,
      topic: TopicSchema,
      canonical: z.string(),
    }),
  ),
});

const DuplicateBatchSchema = z.object({
  items: z.array(
    z.object({
      pairId: z.string(),
      sameEvent: z.boolean(),
      confidence: z.number().min(0).max(1),
      reason: z.string(),
      materialUpdate: z.boolean(),
    }),
  ),
});

interface OpenAiGatewayOptions {
  apiKey: string;
  model?: string;
  client?: OpenAI;
}

export function createOpenAiGateway(options: OpenAiGatewayOptions): NewsAiGateway {
  const client = options.client ?? new OpenAI({ apiKey: options.apiKey });
  const model = options.model ?? "gpt-5.4-mini";

  async function parse<T>(
    schema: z.ZodType<T>,
    name: string,
    system: string,
    payload: unknown,
  ): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await client.responses.parse({
          model,
          max_output_tokens: 4_500,
          input: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify(payload) },
          ],
          text: { format: zodTextFormat(schema, name) },
        });
        if (!response.output_parsed) {
          throw new Error(`openai-empty-structured-output:${name}`);
        }
        const usage = response.usage;
        process.stdout.write(
          `${JSON.stringify({
            type: "openai-usage",
            model,
            operation: name,
            inputTokens: usage?.input_tokens ?? 0,
            outputTokens: usage?.output_tokens ?? 0,
          })}\n`,
        );
        return response.output_parsed;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const status =
          typeof error === "object" && error !== null && "status" in error
            ? Number((error as { status: unknown }).status)
            : 0;
        const transient =
          status === 429 ||
          status >= 500 ||
          lastError.name === "APIConnectionError" ||
          lastError.name === "APITimeoutError";
        if (!transient || attempt === 2) {
          throw lastError;
        }
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 2_000 * 4 ** attempt));
        }
      }
    }
    throw lastError ?? new Error(`openai-failed:${name}`);
  }

  return {
    async fingerprint(articles): Promise<EventFingerprint[]> {
      const result = await parse(
        FingerprintBatchSchema,
        "event_fingerprints",
        FINGERPRINT_SYSTEM,
        articles.map(({ id, title, publishedAt, body }) => {
          const eventExcerpt =
            body.length <= 2_400
              ? body
              : `${body.slice(0, 1_600)}\n[…]\n${body.slice(-800)}`;
          return { candidateId: id, title, publishedAt, body: eventExcerpt };
        }),
      );
      return result.items;
    },

    async reviewPairs(pairs: DuplicatePair[]): Promise<DuplicateReview[]> {
      if (pairs.length === 0) {
        return [];
      }
      const result = await parse(
        DuplicateBatchSchema,
        "duplicate_reviews",
        DUPLICATE_SYSTEM,
        pairs,
      );
      return result.items;
    },
  };
}
```

This implementation follows the official JavaScript pattern: `openai.responses.parse`, `zodTextFormat`, `text.format`, and `response.output_parsed`.

- [ ] **Step 5: Implement normalization and clustering**

Create `src/pipeline/dedupe/normalize.ts`:

```ts
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLocaleLowerCase("sv")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(?:just nu|live|senaste nytt)\b/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function tokenSimilarity(left: string, right: string): number {
  const a = new Set(normalizeTitle(left).split(" ").filter(Boolean));
  const b = new Set(normalizeTitle(right).split(" ").filter(Boolean));
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}
```

Create `src/pipeline/dedupe/cluster.ts`:

```ts
import type { EditorialLedger } from "../../contracts/content";
import type {
  EventFingerprint,
  FingerprintedArticle,
  SourceArticle,
} from "../../contracts/transient";
import type { DuplicatePair, NewsAiGateway } from "../ai/gateway";
import { tokenSimilarity } from "./normalize";

function representative(left: SourceArticle, right: SourceArticle): SourceArticle {
  const score = (article: SourceArticle) =>
    article.body.split(/\s+/u).length + new Date(article.publishedAt).getTime() / 1e12;
  return score(right) > score(left) ? right : left;
}

function fingerprintSimilarity(left: EventFingerprint, right: EventFingerprint): number {
  return (
    tokenSimilarity(left.who.join(" "), right.who.join(" ")) * 0.25 +
    tokenSimilarity(left.action, right.action) * 0.35 +
    tokenSimilarity(left.where, right.where) * 0.1 +
    tokenSimilarity(left.when, right.when) * 0.1 +
    tokenSimilarity(left.outcome, right.outcome) * 0.2
  );
}

export async function deduplicateArticles(
  articles: SourceArticle[],
  ledger: EditorialLedger,
  gateway: NewsAiGateway,
): Promise<FingerprintedArticle[]> {
  const exact: SourceArticle[] = [];
  for (const article of articles) {
    const index = exact.findIndex(
      (current) =>
        current.canonicalUrl === article.canonicalUrl ||
        current.contentHash === article.contentHash,
    );
    if (index === -1) exact.push(article);
    else exact[index] = representative(exact[index] as SourceArticle, article);
  }
  const unique = exact;
  const fingerprints = await gateway.fingerprint(unique);
  const byId = new Map(fingerprints.map((item) => [item.candidateId, item]));
  const pairs: DuplicatePair[] = [];

  for (let leftIndex = 0; leftIndex < unique.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < unique.length; rightIndex += 1) {
      const leftArticle = unique[leftIndex];
      const rightArticle = unique[rightIndex];
      if (!leftArticle || !rightArticle) continue;
      const left = byId.get(leftArticle.id);
      const right = byId.get(rightArticle.id);
      if (!left || !right) continue;
      const score = fingerprintSimilarity(left, right);
      if (score >= 0.45 || tokenSimilarity(leftArticle.title, rightArticle.title) >= 0.55) {
        pairs.push({ pairId: `${left.candidateId}:${right.candidateId}`, left, right });
      }
    }
  }

  const reviews = new Map(
    (await gateway.reviewPairs(pairs))
      .filter((item) => item.sameEvent && item.confidence >= 0.85)
      .map((item) => [item.pairId, item]),
  );
  const consumed = new Set<string>();
  const historical = new Set(ledger.days.flatMap((day) => day.eventFingerprints));
  const result: FingerprintedArticle[] = [];

  for (const article of unique) {
    if (consumed.has(article.id)) continue;
    const fingerprint = byId.get(article.id);
    if (!fingerprint) continue;
    const cluster = [article];
    let isFollowUp = false;

    for (const other of unique) {
      if (other.id === article.id || consumed.has(other.id)) continue;
      const review =
        reviews.get(`${article.id}:${other.id}`) ?? reviews.get(`${other.id}:${article.id}`);
      if (!review) continue;
      cluster.push(other);
      consumed.add(other.id);
      isFollowUp ||= review.materialUpdate;
    }

    const chosen = cluster.reduce(representative);
    const chosenFingerprint = byId.get(chosen.id) ?? fingerprint;
    const related = cluster.filter((item) => item.id !== chosen.id);
    const clusterFingerprints = cluster
      .map((item) => byId.get(item.id))
      .filter((item): item is EventFingerprint => Boolean(item));
    const exactHistoricalRepeat = clusterFingerprints.some((item) =>
      historical.has(item.canonical),
    );
    const relatedHistoricalUpdate = clusterFingerprints.some((item) =>
      [...historical].some(
        (previous) =>
          previous !== item.canonical &&
          tokenSimilarity(previous, item.canonical) >= 0.65,
      ),
    );
    isFollowUp ||= relatedHistoricalUpdate;
    if (exactHistoricalRepeat && !isFollowUp) {
      consumed.add(article.id);
      continue;
    }
    consumed.add(article.id);
    result.push({ article: chosen, fingerprint: chosenFingerprint, related, isFollowUp });
  }
  return result;
}
```

- [ ] **Step 6: Run dedupe and contract tests**

Run:

```bash
pnpm vitest run tests/pipeline/dedupe.test.ts tests/contracts/content.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit AI and dedupe boundaries**

```bash
git add src/pipeline/ai src/pipeline/dedupe tests/pipeline/dedupe.test.ts
git commit -m "feat: deduplicate cross-source news events"
```

---

### Task 5: Seven-Day Editorial Selection

**Files:**
- Create: `src/pipeline/selection/select.ts`
- Create: `tests/pipeline/selection.test.ts`

**Interfaces:**
- Consumes: `FingerprintedArticle[]`, `EditorialLedger`.
- Produces: `selectDailyArticles(candidates, ledger, limit)` and `appendLedgerDay`.

- [ ] **Step 1: Write failing selection tests**

Create `tests/pipeline/selection.test.ts` with a candidate factory and these exact assertions:

```ts
import { describe, expect, it } from "vitest";
import type { EditorialLedger } from "../../src/contracts/content";
import type { FingerprintedArticle } from "../../src/contracts/transient";
import { selectDailyArticles } from "../../src/pipeline/selection/select";

function candidate(
  id: string,
  scope: FingerprintedArticle["fingerprint"]["scope"],
  topic: FingerprintedArticle["fingerprint"]["topic"],
  source: FingerprintedArticle["article"]["source"],
): FingerprintedArticle {
  return {
    article: {
      id,
      source,
      url: `https://example.test/${id}`,
      canonicalUrl: `https://example.test/${id}`,
      title: id,
      publishedAt: "2026-07-23T04:00:00.000Z",
      body: Array.from({ length: 250 }, () => "saklig").join(" "),
      contentHash: `sha256:${id}`,
      isAccessibleForFree: true,
    },
    fingerprint: {
      candidateId: id,
      who: [],
      action: id,
      where: scope === "international" ? "världen" : "Sverige",
      when: "2026-07-23",
      outcome: id,
      scope,
      topic,
      canonical: id,
    },
    related: [],
    isFollowUp: false,
  };
}

describe("daily editorial selection", () => {
  it("always contains Swedish and international coverage", () => {
    const ledger: EditorialLedger = { schemaVersion: 1, days: [] };
    const selected = selectDailyArticles(
      [
        candidate("se", "sweden", "daily-life", "svt"),
        candidate("world", "international", "politics", "dn"),
        candidate("culture", "sweden", "culture", "aftonbladet"),
        candidate("sport", "international", "sports", "aftonbladet"),
      ],
      ledger,
      3,
    );
    expect(selected.some((item) => item.fingerprint.scope !== "international")).toBe(true);
    expect(selected.some((item) => item.fingerprint.scope === "international")).toBe(true);
  });

  it("prefers a topic absent from the rolling ledger", () => {
    const ledger: EditorialLedger = {
      schemaVersion: 1,
      days: [
        {
          date: "2026-07-22",
          scopes: { local: 0, sweden: 2, international: 1 },
          topics: { politics: 1, economy: 1, "daily-life": 1, culture: 0, sports: 0 },
          sources: { svt: 1, aftonbladet: 1, dn: 1 },
          eventFingerprints: ["old"],
        },
      ],
    };
    const selected = selectDailyArticles(
      [
        candidate("se", "sweden", "daily-life", "svt"),
        candidate("world", "international", "politics", "dn"),
        candidate("culture", "sweden", "culture", "aftonbladet"),
      ],
      ledger,
      3,
    );
    expect(selected.map((item) => item.fingerprint.topic)).toContain("culture");
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
pnpm vitest run tests/pipeline/selection.test.ts
```

Expected: FAIL because selection module is missing.

- [ ] **Step 3: Implement deterministic balanced selection**

Create `src/pipeline/selection/select.ts`:

```ts
import type {
  EditorialLedger,
  Scope,
  Source,
  Topic,
} from "../../contracts/content";
import { EditorialDaySchema } from "../../contracts/content";
import type { FingerprintedArticle } from "../../contracts/transient";
import type { z } from "zod";

const scopes: Scope[] = ["local", "sweden", "international"];
const topics: Topic[] = ["politics", "economy", "daily-life", "culture", "sports"];
const sources: Source[] = ["svt", "aftonbladet", "dn"];

function counts<T extends string>(values: T[]): Record<T, number> {
  return Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>;
}

function rollingCounts(ledger: EditorialLedger) {
  const scope = counts(scopes);
  const topic = counts(topics);
  const source = counts(sources);
  for (const day of ledger.days) {
    for (const value of scopes) scope[value] += day.scopes[value] ?? 0;
    for (const value of topics) topic[value] += day.topics[value] ?? 0;
    for (const value of sources) source[value] += day.sources[value] ?? 0;
  }
  return { scope, topic, source };
}

export function selectDailyArticles(
  candidates: FingerprintedArticle[],
  ledger: EditorialLedger,
  limit: number,
): FingerprintedArticle[] {
  const rolling = rollingCounts(ledger);
  const score = (item: FingerprintedArticle) =>
    40 / (1 + rolling.topic[item.fingerprint.topic]) +
    20 / (1 + rolling.source[item.article.source]) +
    Math.min(item.article.body.split(/\s+/u).length, 600) / 100 +
    new Date(item.article.publishedAt).getTime() / 1e13;
  const sorted = [...candidates].sort((left, right) => score(right) - score(left));
  const selected: FingerprintedArticle[] = [];
  const domestic = sorted.find((item) => item.fingerprint.scope !== "international");
  const international = sorted.find(
    (item) => item.fingerprint.scope === "international" && item.article.id !== domestic?.article.id,
  );
  if (domestic) selected.push(domestic);
  if (international) selected.push(international);
  for (const item of sorted) {
    if (selected.length >= limit) break;
    if (!selected.some((chosen) => chosen.article.id === item.article.id)) {
      selected.push(item);
    }
  }
  return selected.slice(0, limit);
}

export function appendLedgerDay(
  ledger: EditorialLedger,
  date: string,
  selected: FingerprintedArticle[],
): EditorialLedger {
  const day: z.infer<typeof EditorialDaySchema> = {
    date,
    scopes: counts(scopes),
    topics: counts(topics),
    sources: counts(sources),
    eventFingerprints: selected.map((item) => item.fingerprint.canonical),
  };
  for (const item of selected) {
    day.scopes[item.fingerprint.scope] += 1;
    day.topics[item.fingerprint.topic] += 1;
    day.sources[item.article.source] += 1;
  }
  return { schemaVersion: 1, days: [...ledger.days, day].slice(-7) };
}
```

- [ ] **Step 4: Run selection tests**

Run:

```bash
pnpm vitest run tests/pipeline/selection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit editorial selection**

```bash
git add src/pipeline/selection tests/pipeline/selection.test.ts
git commit -m "feat: balance seven-day news selection"
```

---

### Task 6: Lesson Generation, Annotation Decoration, and Copyright/Fact Validation

**Files:**
- Create: `src/pipeline/lessons/decorate.ts`
- Create: `src/pipeline/lessons/validate.ts`
- Create: `src/pipeline/lessons/generate.ts`
- Create: `tests/pipeline/lesson-generation.test.ts`

**Interfaces:**
- Consumes: `AiGateway.generateLesson`, `LessonGenerationInput`, `LessonArticle`.
- Produces: `decorateParagraphs`, `validateLessonAgainstSource`, `generateValidatedLesson`.

- [ ] **Step 1: Write failing validation and decoration tests**

Create `tests/pipeline/lesson-generation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decorateParagraphs } from "../../src/pipeline/lessons/decorate";
import { validateLessonAgainstSource } from "../../src/pipeline/lessons/validate";

describe("lesson validation", () => {
  it("prioritizes a longer phrase over an overlapping vocabulary item", () => {
    const paragraphs = decorateParagraphs(
      ["Förändringen träder i kraft i januari."],
      [
        { id: "vocabulary:kraft", targets: ["kraft"], kind: "vocabulary" },
        { id: "phrase:träda i kraft", targets: ["träder i kraft"], kind: "phrase" },
      ],
    );
    expect(paragraphs[0]?.segments).toEqual([
      { text: "Förändringen " },
      { text: "träder i kraft", annotationId: "phrase:träda i kraft" },
      { text: " i januari." },
    ]);
  });

  it("rejects quotes not found in the source and texts outside 300-500 words", () => {
    const lesson = {
      wordCount: 299,
      studyParagraphs: [{ id: "p1", segments: [{ text: "kort text" }] }],
      originalSentenceNotes: [
        { quote: "Den här meningen finns inte.", sourceUrl: "https://example.test", annotationIds: ["x"] },
      ],
    };
    expect(() =>
      validateLessonAgainstSource(
        lesson as never,
        "En annan källtext.",
        "https://example.test",
      ),
    ).toThrow(/lesson-word-count/u);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
pnpm vitest run tests/pipeline/lesson-generation.test.ts
```

Expected: FAIL because lesson modules are missing.

- [ ] **Step 3: Implement deterministic inline decoration**

Create `src/pipeline/lessons/decorate.ts`:

```ts
import type { Annotation } from "../../contracts/content";

interface TargetOnly {
  id: string;
  targets: string[];
  kind: Annotation["kind"];
}

const priority: Record<Annotation["kind"], number> = {
  phrase: 3,
  grammar: 2,
  vocabulary: 1,
};

export function decorateParagraphs(paragraphs: string[], annotations: TargetOnly[]) {
  return paragraphs.map((paragraph, paragraphIndex) => {
    const matches: Array<{ start: number; end: number; id: string; priority: number }> = [];
    for (const annotation of annotations) {
      for (const target of annotation.targets) {
        const haystack = paragraph.toLocaleLowerCase("sv");
        const needle = target.toLocaleLowerCase("sv");
        let offset = 0;
        while (offset < haystack.length) {
          const start = haystack.indexOf(needle, offset);
          if (start === -1) break;
          matches.push({
            start,
            end: start + target.length,
            id: annotation.id,
            priority: priority[annotation.kind] * 10_000 + target.length,
          });
          offset = start + target.length;
        }
      }
    }
    const accepted = matches
      .sort((left, right) => right.priority - left.priority || left.start - right.start)
      .filter(
        (match, index, all) =>
          !all
            .slice(0, index)
            .some((acceptedMatch) => match.start < acceptedMatch.end && match.end > acceptedMatch.start),
      )
      .sort((left, right) => left.start - right.start);

    const segments: Array<{ text: string; annotationId?: string }> = [];
    let cursor = 0;
    for (const match of accepted) {
      if (cursor < match.start) segments.push({ text: paragraph.slice(cursor, match.start) });
      segments.push({ text: paragraph.slice(match.start, match.end), annotationId: match.id });
      cursor = match.end;
    }
    if (cursor < paragraph.length) segments.push({ text: paragraph.slice(cursor) });
    return { id: `p${paragraphIndex + 1}`, segments };
  });
}
```

- [ ] **Step 4: Implement publish-time validation**

Create `src/pipeline/lessons/validate.ts`:

```ts
import { countSwedishWords, LessonArticleSchema, type LessonArticle } from "../../contracts/content";

export function lessonText(lesson: LessonArticle): string {
  return lesson.studyParagraphs
    .map((paragraph) => paragraph.segments.map((segment) => segment.text).join(""))
    .join("\n\n");
}

export function validateLessonAgainstSource(
  input: LessonArticle,
  sourceBody: string,
  sourceUrl: string,
): LessonArticle {
  const actualCount = countSwedishWords(lessonText(input));
  if (actualCount < 300 || actualCount > 500 || input.wordCount !== actualCount) {
    throw new Error(`lesson-word-count:${actualCount}`);
  }
  const lesson = LessonArticleSchema.parse(input);
  const quotedWords = lesson.originalSentenceNotes.reduce(
    (total, note) => total + countSwedishWords(note.quote),
    0,
  );
  if (quotedWords > 80) {
    throw new Error(`lesson-quote-total:${quotedWords}`);
  }
  for (const note of lesson.originalSentenceNotes) {
    if (countSwedishWords(note.quote) > 25) throw new Error("lesson-quote-too-long");
    if (!sourceBody.includes(note.quote)) throw new Error("lesson-quote-not-in-source");
    if (note.sourceUrl !== sourceUrl) throw new Error("lesson-quote-source-mismatch");
  }
  const ids = new Set(lesson.annotations.map((annotation) => annotation.id));
  for (const note of lesson.originalSentenceNotes) {
    if (note.annotationIds.some((id) => !ids.has(id))) {
      throw new Error("lesson-quote-annotation-missing");
    }
  }
  const study = lessonText(lesson);
  const normalizedStudy = study.normalize("NFKC").toLocaleLowerCase("sv");
  const annotationKeys = new Set<string>();
  for (const annotation of lesson.annotations) {
    const key = `${annotation.kind}:${annotation.canonical
      .normalize("NFKC")
      .toLocaleLowerCase("sv")}`;
    if (annotationKeys.has(key)) throw new Error("lesson-duplicate-annotation");
    annotationKeys.add(key);
    if (
      !annotation.targets.some((target) =>
        normalizedStudy.includes(target.normalize("NFKC").toLocaleLowerCase("sv")),
      )
    ) {
      throw new Error(`lesson-annotation-target-missing:${annotation.id}`);
    }
    if (
      annotation.kind === "vocabulary" &&
      annotation.canonical.toLocaleLowerCase("sv") !==
        annotation.lemma.toLocaleLowerCase("sv")
    ) {
      throw new Error(`lesson-lemma-mismatch:${annotation.id}`);
    }
  }
  const numericClaims =
    `${study}\n${lesson.factPoints.join("\n")}`.match(/\b\d+(?:[.,]\d+)?%?\b/gu) ?? [];
  for (const claim of new Set(numericClaims)) {
    if (!sourceBody.includes(claim)) throw new Error(`lesson-unsupported-number:${claim}`);
  }
  const normalizeWords = (text: string) =>
    text
      .normalize("NFKC")
      .toLocaleLowerCase("sv")
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const sourceWords = normalizeWords(sourceBody);
  const normalizedStudyWords = normalizeWords(study).join(" ");
  for (let index = 0; index <= sourceWords.length - 26; index += 1) {
    if (normalizedStudyWords.includes(sourceWords.slice(index, index + 26).join(" "))) {
      throw new Error("lesson-long-source-overlap");
    }
  }
  return lesson;
}
```

- [ ] **Step 5: Extend the OpenAI gateway with a locally assembled lesson draft**

Modify the imports in `src/pipeline/ai/openai-gateway.ts`:

```ts
import {
  AnnotationSchema,
  LessonArticleSchema,
  ScopeSchema,
  TopicSchema,
  countSwedishWords,
} from "../../contracts/content";
import type { EventFingerprint } from "../../contracts/transient";
import { decorateParagraphs } from "../lessons/decorate";
import type {
  AiGateway,
  DuplicatePair,
  DuplicateReview,
} from "./gateway";
import { DUPLICATE_SYSTEM, FINGERPRINT_SYSTEM, LESSON_SYSTEM } from "./prompts";
```

Add this schema after `DuplicateBatchSchema`. It intentionally excludes source identity,
URLs, hashes, event classification, and generated inline segments so those values cannot
be invented by the model:

```ts
const LessonDraftSchema = z.object({
  studyTitle: z.string().min(1),
  paragraphs: z.array(z.string().min(1)).min(2),
  difficulty: z.object({
    level: z.string().regex(/^(?:A1|A2|B1|B2|C1|C2)(?:[–-](?:A1|A2|B1|B2|C1|C2))?$/u),
    reasons: z.array(z.string().min(1)).min(1),
    readingMinutes: z.number().int().positive(),
  }),
  summaries: z.object({
    sv: z.string().min(1),
    zh: z.string().min(1),
    en: z.string().min(1),
  }),
  factPoints: z.array(z.string().min(1)).min(2),
  originalSentenceNotes: z
    .array(
      z.object({
        quote: z.string().min(1),
        annotationIds: z.array(z.string()).min(1),
      }),
    )
    .min(2)
    .max(4),
  annotations: z.array(AnnotationSchema).min(6).max(18),
});
```

Change the factory return type:

```ts
export function createOpenAiGateway(options: OpenAiGatewayOptions): AiGateway {
```

Add `generateLesson` after `reviewPairs` in the returned object:

```ts
    async generateLesson(input, repairReason) {
      const draft = await parse(
        LessonDraftSchema,
        "lesson_draft",
        LESSON_SYSTEM,
        {
          sourceArticle: {
            title: input.article.title,
            publishedAt: input.article.publishedAt,
            body:
              input.article.body.length <= 12_000
                ? input.article.body
                : `${input.article.body.slice(0, 9_000)}\n[…]\n${input.article.body.slice(-3_000)}`,
          },
          eventFingerprint: input.fingerprint,
          relatedCoverage: input.related.map(({ source, title, canonicalUrl }) => ({
            source,
            title,
            url: canonicalUrl,
          })),
          repairReason,
        },
      );
      const studyParagraphs = decorateParagraphs(draft.paragraphs, draft.annotations);
      const wordCount = countSwedishWords(draft.paragraphs.join("\n\n"));
      return LessonArticleSchema.parse({
        id: `${input.article.source}-${input.fingerprint.canonical}`,
        eventFingerprint: input.fingerprint.canonical,
        source: input.article.source,
        sourceUrl: input.article.canonicalUrl,
        sourceTitle: input.article.title,
        publishedAt: input.article.publishedAt,
        scope: input.fingerprint.scope,
        topic: input.fingerprint.topic,
        isFollowUp: input.isFollowUp,
        difficulty: draft.difficulty,
        studyTitle: draft.studyTitle,
        studyParagraphs,
        wordCount,
        summaries: draft.summaries,
        factPoints: draft.factPoints,
        originalSentenceNotes: draft.originalSentenceNotes.map((note) => ({
          ...note,
          sourceUrl: input.article.canonicalUrl,
        })),
        annotations: draft.annotations,
        relatedCoverage: input.related.map(({ source, title, canonicalUrl }) => ({
          source,
          title,
          url: canonicalUrl,
        })),
        generationModel: model,
        contentHash: input.article.contentHash,
      });
    },
```

This preserves a narrow trust boundary: only learning copy, annotations, summaries,
difficulty, facts, and verbatim quote choices come from structured output. Source
metadata and content identity always come from the parser.

- [ ] **Step 6: Implement one-repair lesson validation**

Create `src/pipeline/lessons/generate.ts`:

```ts
import type { FingerprintedArticle } from "../../contracts/transient";
import { ZodError } from "zod";
import type { AiGateway } from "../ai/gateway";
import { validateLessonAgainstSource } from "./validate";

export async function generateValidatedLesson(
  selected: FingerprintedArticle,
  gateway: AiGateway,
) {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const lesson = await gateway.generateLesson({
        article: selected.article,
        fingerprint: selected.fingerprint,
        related: selected.related,
        isFollowUp: selected.isFollowUp,
      }, attempt === 1 ? lastError?.message : undefined);
      return validateLessonAgainstSource(
        lesson,
        selected.article.body,
        selected.article.canonicalUrl,
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const repairable =
        error instanceof ZodError || lastError.message.startsWith("lesson-");
      if (!repairable || attempt === 1) throw lastError;
    }
  }
  throw lastError ?? new Error("lesson-generation-failed");
}
```

The second call is the single allowed content repair. The gateway receives the first
validation error as `repairReason`; its internal transient retry ceiling remains three
attempts for only rate-limit, connection, timeout, or server failures.

- [ ] **Step 7: Run lesson and dedupe tests**

Run:

```bash
pnpm vitest run tests/pipeline/lesson-generation.test.ts tests/pipeline/dedupe.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit lesson generation**

```bash
git add src/pipeline/lessons src/pipeline/ai/openai-gateway.ts tests/pipeline/lesson-generation.test.ts
git commit -m "feat: generate validated bilingual lessons"
```

---

### Task 7: Persistence, Stockholm Clock Gate, and Daily Pipeline Orchestration

**Files:**
- Create: `src/pipeline/clock.ts`
- Create: `src/pipeline/persistence/repository.ts`
- Create: `src/pipeline/run.ts`
- Create: `scripts/run-daily.ts`
- Create: `data/editorial-ledger.json`
- Create: `data/cache/index.json`
- Create: `tests/pipeline/run.test.ts`

**Interfaces:**
- Consumes: adapters, robots guard, parser, dedupe, selector, lesson generator.
- Produces: `stockholmDateTime`, `FileRepository`, `runDailyPipeline`, executable `pnpm pipeline`.

- [ ] **Step 1: Write failing clock and orchestration tests**

Create `tests/pipeline/run.test.ts`:

```ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stockholmDateTime } from "../../src/pipeline/clock";
import { FileRepository } from "../../src/pipeline/persistence/repository";

describe("daily pipeline infrastructure", () => {
  it("maps summer and winter UTC triggers to Stockholm 07:00", () => {
    expect(stockholmDateTime(new Date("2026-07-23T05:00:00Z")).hour).toBe(7);
    expect(stockholmDateTime(new Date("2026-01-23T06:00:00Z")).hour).toBe(7);
  });

  it("writes derived JSON but never persists a source body", async () => {
    const root = await mkdtemp(join(tmpdir(), "nyhetsspar-"));
    const repository = new FileRepository(root);
    await repository.saveCacheEntry({
      canonicalUrl: "https://example.test/article",
      contentHash: "sha256:test",
      lessonDate: "2026-07-23",
      lessonId: "lesson-1",
    });
    const raw = await readFile(join(root, "data/cache/index.json"), "utf8");
    expect(raw).not.toContain("source body");
    expect(raw).toContain("sha256:test");
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
pnpm vitest run tests/pipeline/run.test.ts
```

Expected: FAIL because clock and repository modules are missing.

- [ ] **Step 3: Implement timezone gating**

Create `src/pipeline/clock.ts`:

```ts
export interface StockholmDateTime {
  date: string;
  hour: number;
}

export function stockholmDateTime(now: Date): StockholmDateTime {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
  };
}
```

- [ ] **Step 4: Implement the only persistent writer**

Create `src/pipeline/persistence/repository.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DailyLessonSchema,
  EditorialLedgerSchema,
  LessonIndexSchema,
  type DailyLesson,
  type EditorialLedger,
  type LessonIndex,
} from "../../contracts/content";

export interface CacheEntry {
  canonicalUrl: string;
  contentHash: string;
  lessonDate: string;
  lessonId: string;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export class FileRepository {
  constructor(private readonly root: string) {}

  async loadLedger(): Promise<EditorialLedger> {
    const value = await readJson(join(this.root, "data/editorial-ledger.json"), {
      schemaVersion: 1,
      days: [],
    });
    return EditorialLedgerSchema.parse(value);
  }

  async saveLedger(ledger: EditorialLedger): Promise<void> {
    await writeJson(
      join(this.root, "data/editorial-ledger.json"),
      EditorialLedgerSchema.parse(ledger),
    );
  }

  async lessonExists(date: string): Promise<boolean> {
    const index = await this.loadIndex();
    return index.dates.some((entry) => entry.date === date && entry.status === "ready");
  }

  async loadLesson(date: string): Promise<DailyLesson | null> {
    const value = await readJson<unknown | null>(
      join(this.root, `public/data/lessons/${date}.json`),
      null,
    );
    return value === null ? null : DailyLessonSchema.parse(value);
  }

  async loadIndex(): Promise<LessonIndex> {
    const value = await readJson(join(this.root, "public/data/index.json"), {
      schemaVersion: 1,
      dates: [],
    });
    return LessonIndexSchema.parse(value);
  }

  async saveLesson(lesson: DailyLesson): Promise<void> {
    const valid = DailyLessonSchema.parse(lesson);
    await writeJson(join(this.root, `public/data/lessons/${lesson.date}.json`), valid);
    const current = await this.loadIndex();
    const entry = {
      date: valid.date,
      status: valid.status,
      articles: valid.articles.map((article) => ({
        id: article.id,
        title: article.studyTitle,
        source: article.source,
        scope: article.scope,
        topic: article.topic,
        difficulty: article.difficulty.level,
        isFollowUp: article.isFollowUp,
      })),
    };
    const dates = [entry, ...current.dates.filter((item) => item.date !== valid.date)].sort((a, b) =>
      b.date.localeCompare(a.date),
    );
    await writeJson(
      join(this.root, "public/data/index.json"),
      LessonIndexSchema.parse({ schemaVersion: 1, dates }),
    );
  }

  async saveCacheEntry(entry: CacheEntry): Promise<void> {
    const path = join(this.root, "data/cache/index.json");
    const current = await readJson<{ schemaVersion: 1; entries: CacheEntry[] }>(path, {
      schemaVersion: 1,
      entries: [],
    });
    const entries = [
      entry,
      ...current.entries.filter((item) => item.canonicalUrl !== entry.canonicalUrl),
    ];
    await writeJson(path, { schemaVersion: 1, entries });
  }

  async findCachedLesson(
    canonicalUrl: string,
    contentHash: string,
  ): Promise<DailyLesson["articles"][number] | null> {
    const cache = await readJson<{ schemaVersion: 1; entries: CacheEntry[] }>(
      join(this.root, "data/cache/index.json"),
      { schemaVersion: 1, entries: [] },
    );
    const entry = cache.entries.find(
      (item) => item.canonicalUrl === canonicalUrl && item.contentHash === contentHash,
    );
    if (!entry) return null;
    const day = await this.loadLesson(entry.lessonDate);
    return day?.articles.find((article) => article.id === entry.lessonId) ?? null;
  }
}
```

- [ ] **Step 5: Implement the daily orchestration function**

Create `src/pipeline/run.ts`:

```ts
import type { DailyLesson, LessonArticle, Source } from "../contracts/content";
import type { FingerprintedArticle, SourceArticle } from "../contracts/transient";
import type { AiGateway } from "./ai/gateway";
import { deduplicateArticles } from "./dedupe/cluster";
import { generateValidatedLesson } from "./lessons/generate";
import { FileRepository } from "./persistence/repository";
import { appendLedgerDay, selectDailyArticles } from "./selection/select";
import { createSourceAdapters } from "./sources/adapters";
import { parseArticle } from "./sources/article-parser";
import { createHttpFetcher } from "./sources/fetcher";
import { createRobotsGuard } from "./sources/robots";
import { stockholmDateTime } from "./clock";

export interface RunOptions {
  root: string;
  now: Date;
  gateway: AiGateway;
  force?: boolean;
  dateOverride?: string;
}

export async function runDailyPipeline(options: RunOptions): Promise<DailyLesson | null> {
  const clock = stockholmDateTime(options.now);
  const date = options.dateOverride ?? clock.date;
  const repository = new FileRepository(options.root);
  if (options.dateOverride && options.dateOverride !== clock.date) {
    throw new Error("date-override-must-match-stockholm-today");
  }
  if (!options.force && clock.hour < 7) return null;
  if (!options.force && (await repository.lessonExists(date))) return null;

  const fetcher = createHttpFetcher();
  const robots = createRobotsGuard(fetcher);
  const adapters = createSourceAdapters();
  const sourceHealth: Record<Source, "ok" | "partial" | "failed"> = {
    svt: "ok",
    aftonbladet: "ok",
    dn: "ok",
  };
  const articles: SourceArticle[] = [];

  for (const adapter of adapters) {
    try {
      const links = await adapter.discover(options.now, fetcher);
      for (const link of links.slice(0, 12)) {
        if (!(await robots.isAllowed(link.url))) continue;
        const response = await fetcher.fetchText(link.url);
        if (response.status !== 200) continue;
        const parsed = parseArticle(adapter.source, link.url, response.text);
        const age = options.now.getTime() - new Date(parsed.publishedAt).getTime();
        if (
          parsed.isAccessibleForFree &&
          age >= -60 * 60 * 1_000 &&
          age <= 24 * 60 * 60 * 1_000
        ) {
          articles.push(parsed);
        }
      }
      if (links.length === 0) sourceHealth[adapter.source] = "partial";
    } catch (error) {
      sourceHealth[adapter.source] = "failed";
      process.stdout.write(
        `${JSON.stringify({
          type: "source-health",
          source: adapter.source,
          status: "failed",
          error:
            error instanceof Error
              ? `${error.name}:${error.message.slice(0, 160)}`
              : "unknown",
        })}\n`,
      );
    }
  }

  const ledger = await repository.loadLedger();
  const deduplicated = await deduplicateArticles(articles, ledger, options.gateway);
  const generationQueue = selectDailyArticles(
    deduplicated,
    ledger,
    Math.min(6, deduplicated.length),
  );
  const generated: Array<{
    selected: FingerprintedArticle;
    lesson: LessonArticle;
  }> = [];

  for (const item of generationQueue) {
    if (generated.length >= 3) break;
    try {
      const cached = await repository.findCachedLesson(
        item.article.canonicalUrl,
        item.article.contentHash,
      );
      const lesson = cached ?? (await generateValidatedLesson(item, options.gateway));
      generated.push({ selected: item, lesson });
    } catch {
      continue;
    }
  }

  const lessons = generated.map(({ lesson }) => lesson);
  const hasDomestic = generated.some(
    ({ selected }) => selected.fingerprint.scope !== "international",
  );
  const hasInternational = generated.some(
    ({ selected }) => selected.fingerprint.scope === "international",
  );
  const ready = lessons.length >= 2 && hasDomestic && hasInternational;
  const daily: DailyLesson = {
    schemaVersion: 1,
    date,
    timezone: "Europe/Stockholm",
    generatedAt: options.now.toISOString(),
    status: ready ? "ready" : "delayed",
    sourceHealth,
    selectionSummary: ready
      ? "Domestic and international coverage selected with seven-day topic balancing."
      : "Fewer than two fully validated public lessons were available.",
    articles: ready ? lessons.slice(0, 3) : [],
  };
  await repository.saveLesson(daily);
  if (ready) {
    await repository.saveLedger(
      appendLedgerDay(
        ledger,
        date,
        generated.map(({ selected: generatedSelection }) => generatedSelection),
      ),
    );
    for (const { lesson } of generated) {
      await repository.saveCacheEntry({
        canonicalUrl: lesson.sourceUrl,
        contentHash: lesson.contentHash,
        lessonDate: date,
        lessonId: lesson.id,
      });
    }
  }
  return daily;
}
```

Create `scripts/run-daily.ts`:

```ts
import { resolve } from "node:path";
import { createOpenAiGateway } from "../src/pipeline/ai/openai-gateway";
import { runDailyPipeline } from "../src/pipeline/run";

const args = new Map(
  process.argv
    .slice(2)
    .map((item) => item.split("=", 2))
    .map(([key, value]) => [key, value ?? "true"]),
);
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is required");

const result = await runDailyPipeline({
  root: resolve("."),
  now: new Date(),
  gateway: createOpenAiGateway({
    apiKey,
    model: process.env.OPENAI_MODEL ?? "gpt-5.4-mini",
  }),
  force: args.get("--force") === "true",
  dateOverride: args.get("--date"),
});

process.stdout.write(
  result
    ? `lesson:${result.date}:${result.status}:${result.articles.length}\n`
    : "lesson:skipped\n",
);
```

Create `data/editorial-ledger.json`:

```json
{
  "schemaVersion": 1,
  "days": []
}
```

Create `data/cache/index.json`:

```json
{
  "schemaVersion": 1,
  "entries": []
}
```

- [ ] **Step 6: Run orchestration tests and type checking**

Run:

```bash
pnpm vitest run tests/pipeline/run.test.ts
pnpm exec tsc --noEmit
```

Expected: PASS and no type errors.

- [ ] **Step 7: Commit the daily pipeline**

```bash
git add src/pipeline scripts/run-daily.ts data tests/pipeline/run.test.ts
git commit -m "feat: orchestrate daily lesson publishing"
```

---

### Task 8: Browser Data Repository, Application Shell, Today Page, and History Page

**Files:**
- Create: `src/web/data/repository.ts`
- Create: `src/web/components/Shell.tsx`
- Create: `src/web/components/ArticleCard.tsx`
- Create: `src/web/pages/TodayPage.tsx`
- Create: `src/web/pages/HistoryPage.tsx`
- Create: `src/web/App.tsx`
- Create: `src/web/main.tsx`
- Create: `src/web/styles.css`
- Create: `tests/web/today.test.tsx`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: persisted `LessonIndex` and `DailyLesson`.
- Produces: `LessonRepository` and application routes `#/` and `#/history`.

- [ ] **Step 1: Configure jsdom for web tests**

Modify `vitest.config.ts` so files under `tests/web` use jsdom and load jest-dom:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    environmentMatchGlobs: [["tests/web/**/*.test.tsx", "jsdom"]],
    setupFiles: ["tests/web/setup.ts"],
    coverage: { reporter: ["text", "json-summary"] },
  },
});
```

Create `tests/web/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 2: Write a failing Today page test**

Create `tests/web/today.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { DailyLesson } from "../../src/contracts/content";
import { TodayPage } from "../../src/web/pages/TodayPage";

const lesson: DailyLesson = {
  schemaVersion: 1,
  date: "2026-07-23",
  timezone: "Europe/Stockholm",
  generatedAt: "2026-07-23T05:05:00.000Z",
  status: "ready",
  sourceHealth: { svt: "ok", aftonbladet: "ok", dn: "ok" },
  selectionSummary: "Balanced.",
  articles: [],
};

describe("TodayPage", () => {
  it("renders the daily issue and empty article state accessibly", () => {
    render(
      <MemoryRouter>
        <TodayPage lesson={lesson} completedIds={new Set()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: /dagens lektion/i })).toBeVisible();
    expect(screen.getByText(/课程正在准备/i)).toBeVisible();
  });
});
```

- [ ] **Step 3: Run and confirm failure**

Run:

```bash
pnpm vitest run tests/web/today.test.tsx
```

Expected: FAIL because web components do not exist.

- [ ] **Step 4: Implement browser data loading**

Create `src/web/data/repository.ts`:

```ts
import {
  DailyLessonSchema,
  LessonIndexSchema,
  type DailyLesson,
  type LessonIndex,
} from "../../contracts/content";

const base = import.meta.env.BASE_URL;

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(`${base}${path.replace(/^\//u, "")}`);
  if (!response.ok) throw new Error(`data-http-${response.status}:${path}`);
  return response.json();
}

export class LessonRepository {
  async loadIndex(): Promise<LessonIndex> {
    return LessonIndexSchema.parse(await getJson("data/index.json"));
  }

  async loadLesson(date: string): Promise<DailyLesson> {
    return DailyLessonSchema.parse(await getJson(`data/lessons/${date}.json`));
  }
}
```

- [ ] **Step 5: Implement the shell, cards, and pages**

Create `src/web/components/Shell.tsx`:

```tsx
import type { PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";

export function Shell({ children }: PropsWithChildren) {
  return (
    <div className="app-shell">
      <header className="site-header">
        <NavLink className="brand" to="/">Nyhetsspår</NavLink>
        <nav aria-label="主导航">
          <NavLink to="/">今日课程</NavLink>
          <NavLink to="/history">历史</NavLink>
        </nav>
      </header>
      <main id="main-content">{children}</main>
    </div>
  );
}
```

Create `src/web/components/ArticleCard.tsx`:

```tsx
import { Link } from "react-router-dom";
import type { LessonArticle } from "../../contracts/content";

export function ArticleCard({
  article,
  date,
  completed,
}: {
  article: LessonArticle;
  date: string;
  completed: boolean;
}) {
  return (
    <article className="article-card">
      <div className="article-card__meta">
        <span>{article.scope}</span>
        <span>{article.topic}</span>
        <span>{article.source.toUpperCase()}</span>
        {article.isFollowUp ? <span>后续报道</span> : null}
      </div>
      <h2>{article.studyTitle}</h2>
      <p>{article.summaries.sv}</p>
      <div className="article-card__footer">
        <span>{article.difficulty.level} · {article.difficulty.readingMinutes} min</span>
        <Link to={`/lesson/${date}/${article.id}`}>
          {completed ? "复习" : "开始阅读"}
        </Link>
      </div>
    </article>
  );
}
```

Create `src/web/pages/TodayPage.tsx`:

```tsx
import type { DailyLesson } from "../../contracts/content";
import { ArticleCard } from "../components/ArticleCard";

export function TodayPage({
  lesson,
  completedIds,
}: {
  lesson: DailyLesson;
  completedIds: Set<string>;
}) {
  const completeCount = lesson.articles.filter((article) => completedIds.has(article.id)).length;
  return (
    <section className="page today-page">
      <p className="eyebrow">{lesson.date}</p>
      <h1>Dagens lektion · 今日课程</h1>
      <p className="lead">
        {lesson.status === "ready"
          ? `${lesson.articles.length} 篇新闻，已完成 ${completeCount} 篇`
          : "今日课程生成延迟，请稍后再试。"}
      </p>
      <p className="source-health" aria-label="来源状态">
        来源状态：
        {Object.entries(lesson.sourceHealth)
          .map(([source, status]) => `${source.toUpperCase()} ${status}`)
          .join(" · ")}
      </p>
      {lesson.articles.length === 0 ? (
        <div className="empty-state">课程正在准备，历史课程仍可正常阅读。</div>
      ) : (
        <div className="article-grid">
          {lesson.articles.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              date={lesson.date}
              completed={completedIds.has(article.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
```

Create `src/web/pages/HistoryPage.tsx`:

```tsx
import { useState } from "react";
import type { LessonIndex } from "../../contracts/content";
import { Link } from "react-router-dom";

export function HistoryPage({ index }: { index: LessonIndex }) {
  const [source, setSource] = useState("all");
  const [scope, setScope] = useState("all");
  const [topic, setTopic] = useState("all");
  return (
    <section className="page">
      <p className="eyebrow">ARKIV</p>
      <h1>历史课程</h1>
      <div className="history-filters" aria-label="历史筛选">
        <label>
          来源
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="all">全部</option>
            <option value="svt">SVT</option>
            <option value="aftonbladet">Aftonbladet</option>
            <option value="dn">DN</option>
          </select>
        </label>
        <label>
          范围
          <select value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="all">全部</option>
            <option value="local">本地</option>
            <option value="sweden">瑞典</option>
            <option value="international">国际</option>
          </select>
        </label>
        <label>
          主题
          <select value={topic} onChange={(event) => setTopic(event.target.value)}>
            <option value="all">全部</option>
            <option value="politics">政治</option>
            <option value="economy">经济</option>
            <option value="daily-life">民生</option>
            <option value="culture">文化</option>
            <option value="sports">体育</option>
          </select>
        </label>
      </div>
      <div className="history-list">
        {index.dates.map((day) => {
          const articles = day.articles.filter(
            (article) =>
              (source === "all" || article.source === source) &&
              (scope === "all" || article.scope === scope) &&
              (topic === "all" || article.topic === topic),
          );
          return articles.length > 0 ? (
            <section key={day.date}>
              <h2>{day.date}</h2>
              {articles.map((article) => (
                <Link key={article.id} to={`/lesson/${day.date}/${article.id}`}>
                  {article.title} · {article.source.toUpperCase()} · {article.difficulty}
                  {article.isFollowUp ? " · 后续报道" : ""}
                </Link>
              ))}
            </section>
          ) : null;
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Wire hash routes and asynchronous loading**

Create `src/web/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import type { DailyLesson, LessonIndex } from "../contracts/content";
import { Shell } from "./components/Shell";
import { LessonRepository } from "./data/repository";
import { HistoryPage } from "./pages/HistoryPage";
import { TodayPage } from "./pages/TodayPage";

const repository = new LessonRepository();

export function App() {
  const [index, setIndex] = useState<LessonIndex | null>(null);
  const [today, setToday] = useState<DailyLesson | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    repository
      .loadIndex()
      .then(async (loadedIndex) => {
        setIndex(loadedIndex);
        const latest = loadedIndex.dates[0];
        if (latest) setToday(await repository.loadLesson(latest.date));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  return (
    <HashRouter>
      <Shell>
        {error ? (
          <div role="alert" className="error-state">课程加载失败：{error}</div>
        ) : !index ? (
          <div className="loading-state">正在加载课程…</div>
        ) : (
          <Routes>
            <Route
              path="/"
              element={
                today ? (
                  <TodayPage lesson={today} completedIds={new Set()} />
                ) : (
                  <div className="empty-state">还没有课程。</div>
                )
              }
            />
            <Route path="/history" element={<HistoryPage index={index} />} />
          </Routes>
        )}
      </Shell>
    </HashRouter>
  );
}
```

Create `src/web/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("root element is missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Create the minimal `src/web/styles.css` required for a readable unstyled shell. Task 11
will replace it with the approved visual system:

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; }
.site-header { display: flex; justify-content: space-between; padding: 16px 24px; }
.site-header nav { display: flex; gap: 16px; }
.page { width: min(1080px, calc(100% - 32px)); margin: 40px auto; }
.article-grid { display: grid; gap: 20px; }
```

- [ ] **Step 7: Run Today page tests**

Run:

```bash
pnpm vitest run tests/web/today.test.tsx
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit the application shell**

```bash
git add src/web tests/web vitest.config.ts
git commit -m "feat: add daily issue and history pages"
```

---

### Task 9: Known-Item Store, Annotation Reader, and Completion Progress

**Files:**
- Create: `src/web/storage/known.ts`
- Create: `src/web/storage/progress.ts`
- Create: `src/web/components/AnnotationText.tsx`
- Create: `src/web/components/LanguageCard.tsx`
- Create: `src/web/pages/LessonPage.tsx`
- Create: `tests/web/reader.test.tsx`
- Modify: `src/web/App.tsx`

**Interfaces:**
- Consumes: lesson annotations and paragraphs.
- Produces: `KnownStore`, `ProgressStore`, reader route, known filtering, 5-second undo.

- [ ] **Step 1: Write failing reader interaction tests**

Create `tests/web/reader.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LanguageCard } from "../../src/web/components/LanguageCard";
import { createKnownStore } from "../../src/web/storage/known";

describe("reader known-item interaction", () => {
  it("stores a vocabulary lemma and suppresses the same canonical item", async () => {
    vi.useFakeTimers();
    const storage = new Map<string, string>();
    const store = createKnownStore({
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
      clear: () => storage.clear(),
      key: () => null,
      length: 0,
    });
    render(
      <LanguageCard
        annotation={{
          id: "vocabulary:regering",
          kind: "vocabulary",
          canonical: "regering",
          targets: ["regeringen"],
          meaningZh: "政府",
          meaningEn: "government",
          exampleSv: "Regeringen presenterar ett förslag.",
          surface: "regeringen",
          lemma: "regering",
          partOfSpeech: "substantiv",
          inflections: ["regeringen", "regeringar"],
          compoundParts: [],
          note: ""
        }}
        knownStore={store}
        onPendingChange={() => undefined}
        onKnownChange={() => undefined}
      />,
    );
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      screen.getByRole("button", { name: /我认识/i }),
    );
    expect(store.isKnown("vocabulary", "regering")).toBe(true);
    expect(screen.getByRole("button", { name: /撤销/i })).toBeVisible();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
pnpm vitest run tests/web/reader.test.tsx
```

Expected: FAIL because storage and reader components are missing.

- [ ] **Step 3: Implement versioned localStorage stores**

Create `src/web/storage/known.ts`:

```ts
import { z } from "zod";
import type { Annotation } from "../../contracts/content";

const KEY = "nyhetsspar.known.v1";
const RecordSchema = z.object({
  kind: z.enum(["vocabulary", "phrase", "grammar"]),
  canonical: z.string(),
  original: z.string(),
  meaningZh: z.string(),
  meaningEn: z.string(),
  markedAt: z.string().datetime(),
  articleId: z.string().optional(),
});
const ExportSchema = z.object({ version: z.literal(1), records: z.array(RecordSchema) });
export type KnownRecord = z.infer<typeof RecordSchema>;

export function createKnownStore(storage: Storage = localStorage) {
  const read = (): KnownRecord[] => {
    const raw = storage.getItem(KEY);
    if (!raw) return [];
    return ExportSchema.parse(JSON.parse(raw)).records;
  };
  const write = (records: KnownRecord[]) =>
    storage.setItem(KEY, JSON.stringify({ version: 1, records }));
  const canonicalKey = (kind: Annotation["kind"], canonical: string) =>
    `${kind}:${canonical.normalize("NFKC").toLocaleLowerCase("sv").trim()}`;

  return {
    list: read,
    isKnown(kind: Annotation["kind"], canonical: string) {
      const key = canonicalKey(kind, canonical);
      return read().some((record) => canonicalKey(record.kind, record.canonical) === key);
    },
    mark(record: KnownRecord) {
      const key = canonicalKey(record.kind, record.canonical);
      write([
        record,
        ...read().filter((current) => canonicalKey(current.kind, current.canonical) !== key),
      ]);
    },
    restore(kind: Annotation["kind"], canonical: string) {
      const key = canonicalKey(kind, canonical);
      write(read().filter((record) => canonicalKey(record.kind, record.canonical) !== key));
    },
    clearAll() {
      write([]);
    },
    exportJson() {
      return `${JSON.stringify({ version: 1, records: read() }, null, 2)}\n`;
    },
    importJson(raw: string) {
      const imported = ExportSchema.parse(JSON.parse(raw)).records;
      const merged = new Map(
        [...read(), ...imported].map((record) => [
          canonicalKey(record.kind, record.canonical),
          record,
        ]),
      );
      write([...merged.values()]);
    },
  };
}
```

Create `src/web/storage/progress.ts`:

```ts
import { z } from "zod";

const KEY = "nyhetsspar.progress.v1";
const StateSchema = z.object({
  version: z.literal(1),
  openedIds: z.array(z.string()),
  completedIds: z.array(z.string()),
  positions: z.record(z.string(), z.number().nonnegative()),
  lastOpenedId: z.string().nullable(),
});
const LegacyStateSchema = z.object({
  version: z.literal(1),
  completedIds: z.array(z.string()),
});
type ProgressState = z.infer<typeof StateSchema>;

export function createProgressStore(storage: Storage = localStorage) {
  const empty = (): ProgressState => ({
    version: 1,
    openedIds: [],
    completedIds: [],
    positions: {},
    lastOpenedId: null,
  });
  const read = (): ProgressState => {
    const raw = storage.getItem(KEY);
    if (!raw) return empty();
    const value: unknown = JSON.parse(raw);
    const current = StateSchema.safeParse(value);
    if (current.success) return current.data;
    const legacy = LegacyStateSchema.parse(value);
    return { ...empty(), completedIds: legacy.completedIds };
  };
  const write = (state: ProgressState) =>
    storage.setItem(KEY, JSON.stringify(StateSchema.parse(state)));
  return {
    opened(): Set<string> {
      return new Set(read().openedIds);
    },
    completed(): Set<string> {
      return new Set(read().completedIds);
    },
    markOpened(id: string) {
      const current = read();
      write({
        ...current,
        openedIds: [...new Set([...current.openedIds, id])],
        lastOpenedId: id,
      });
    },
    setCompleted(id: string, completed: boolean) {
      const state = read();
      const completedIds = new Set(state.completedIds);
      if (completed) completedIds.add(id);
      else completedIds.delete(id);
      write({ ...state, completedIds: [...completedIds] });
    },
    savePosition(id: string, y: number) {
      const state = read();
      write({ ...state, positions: { ...state.positions, [id]: Math.max(0, y) } });
    },
    position(id: string): number {
      return read().positions[id] ?? 0;
    },
    lastOpenedId(): string | null {
      return read().lastOpenedId;
    },
  };
}
```

- [ ] **Step 4: Implement inline annotation and language cards**

Create `src/web/components/AnnotationText.tsx`:

```tsx
import type { StudyParagraphSchema } from "../../contracts/content";
import type { z } from "zod";

export function AnnotationText({
  paragraphs,
  hiddenIds,
  onSelect,
}: {
  paragraphs: z.infer<typeof StudyParagraphSchema>[];
  hiddenIds: Set<string>;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="study-text" lang="sv">
      {paragraphs.map((paragraph) => (
        <p key={paragraph.id}>
          {paragraph.segments.map((segment, index) =>
            segment.annotationId && !hiddenIds.has(segment.annotationId) ? (
              <button
                type="button"
                className={`annotation annotation--${segment.annotationId.split(":")[0]}`}
                key={`${paragraph.id}-${index}`}
                onClick={() => onSelect(segment.annotationId as string)}
              >
                {segment.text}
              </button>
            ) : (
              <span key={`${paragraph.id}-${index}`}>{segment.text}</span>
            ),
          )}
        </p>
      ))}
    </div>
  );
}
```

Create `src/web/components/LanguageCard.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { Annotation } from "../../contracts/content";
import type { createKnownStore } from "../storage/known";

export function LanguageCard({
  annotation,
  knownStore,
  onPendingChange,
  onKnownChange,
}: {
  annotation: Annotation;
  knownStore: ReturnType<typeof createKnownStore>;
  onPendingChange: (pending: boolean) => void;
  onKnownChange: () => void;
}) {
  const [undo, setUndo] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  const mark = () => {
    knownStore.mark({
      kind: annotation.kind,
      canonical: annotation.canonical,
      original: annotation.targets[0] ?? annotation.canonical,
      meaningZh: annotation.meaningZh,
      meaningEn: annotation.meaningEn,
      markedAt: new Date().toISOString(),
    });
    setUndo(true);
    onPendingChange(true);
    onKnownChange();
    timer.current = window.setTimeout(() => {
      setUndo(false);
      onPendingChange(false);
    }, 5_000);
  };
  const restore = () => {
    if (timer.current) window.clearTimeout(timer.current);
    knownStore.restore(annotation.kind, annotation.canonical);
    setUndo(false);
    onPendingChange(false);
    onKnownChange();
  };
  return (
    <article className={`language-card language-card--${annotation.kind}`} id={annotation.id}>
      <p className="language-card__kind">{annotation.kind}</p>
      <h3>{annotation.targets[0] ?? annotation.canonical}</h3>
      <p><strong>中文</strong> {annotation.meaningZh}</p>
      <p><strong>English</strong> {annotation.meaningEn}</p>
      <p lang="sv">{annotation.exampleSv}</p>
      {undo ? (
        <button type="button" onClick={restore}>撤销</button>
      ) : (
        <button type="button" onClick={mark}>我认识这个{annotation.kind === "grammar" ? "语法点" : "项目"}</button>
      )}
    </article>
  );
}
```

- [ ] **Step 5: Implement the two-column lesson page**

Create `src/web/pages/LessonPage.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { LessonArticle } from "../../contracts/content";
import { AnnotationText } from "../components/AnnotationText";
import { LanguageCard } from "../components/LanguageCard";
import type { createKnownStore } from "../storage/known";
import type { createProgressStore } from "../storage/progress";

export function LessonPage({
  article,
  date,
  nextArticleId,
  knownStore,
  progressStore,
}: {
  article: LessonArticle;
  date: string;
  nextArticleId: string | null;
  knownStore: ReturnType<typeof createKnownStore>;
  progressStore: ReturnType<typeof createProgressStore>;
}) {
  const [knownVersion, setKnownVersion] = useState(0);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [completed, setCompleted] = useState(() =>
    progressStore.completed().has(article.id),
  );
  useEffect(() => {
    progressStore.markOpened(article.id);
    const saved = progressStore.position(article.id);
    if (saved > 0) requestAnimationFrame(() => window.scrollTo({ top: saved }));
    let timer: number | undefined;
    const remember = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(
        () => progressStore.savePosition(article.id, window.scrollY),
        250,
      );
    };
    window.addEventListener("scroll", remember, { passive: true });
    return () => {
      window.removeEventListener("scroll", remember);
      if (timer) window.clearTimeout(timer);
      progressStore.savePosition(article.id, window.scrollY);
    };
  }, [article.id, progressStore]);
  const hiddenIds = useMemo(
    () =>
      new Set(
        article.annotations
          .filter((annotation) => knownStore.isKnown(annotation.kind, annotation.canonical))
          .map((annotation) => annotation.id),
      ),
    [article, knownStore, knownVersion],
  );
  const visible = article.annotations.filter(
    (annotation) => !hiddenIds.has(annotation.id) || pendingIds.has(annotation.id),
  );
  const select = (id: string) => {
    setSelectedId(id);
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "center" }));
  };
  return (
    <article className="lesson-page">
      <div className="lesson-reader">
        <section>
          <p className="eyebrow">
            {article.source.toUpperCase()} · {article.topic}
            {article.isFollowUp ? " · 后续报道" : ""}
          </p>
          <h1>{article.studyTitle}</h1>
          <p>{article.difficulty.level} · {article.difficulty.readingMinutes} min</p>
          <details className="summary-panel" open>
            <summary>60 秒读懂</summary>
            <p lang="sv">{article.summaries.sv}</p>
            <p lang="zh-CN">{article.summaries.zh}</p>
            <p lang="en">{article.summaries.en}</p>
          </details>
          <AnnotationText paragraphs={article.studyParagraphs} hiddenIds={hiddenIds} onSelect={select} />
          <section>
            <h2>原句解析</h2>
            {article.originalSentenceNotes.map((note) => (
              <figure className="source-note" key={note.quote}>
                <blockquote lang="sv">{note.quote}</blockquote>
                <figcaption>
                  <p>媒体实际用法 · Usage in this news sentence</p>
                  <ul>
                    {note.annotationIds.map((id) => {
                      const annotation = article.annotations.find((item) => item.id === id);
                      if (
                        !annotation ||
                        knownStore.isKnown(annotation.kind, annotation.canonical)
                      ) {
                        return null;
                      }
                      const usage =
                        annotation.kind === "phrase"
                          ? annotation.usage
                          : annotation.kind === "grammar"
                            ? `${annotation.explanationZh} / ${annotation.explanationEn}`
                            : annotation.note;
                      return (
                        <li key={id}>
                          <strong lang="sv">
                            {annotation.targets[0] ?? annotation.canonical}
                          </strong>
                          <span>{annotation.meaningZh} / {annotation.meaningEn}</span>
                          {usage ? <span>{usage}</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                </figcaption>
              </figure>
            ))}
          </section>
          {article.relatedCoverage.length > 0 ? (
            <section>
              <h2>相关报道</h2>
              <ul>
                {article.relatedCoverage.map((item) => (
                  <li key={item.url}>
                    <a href={item.url} target="_blank" rel="noreferrer noopener">
                      {item.source.toUpperCase()} · {item.title}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <a href={article.sourceUrl} target="_blank" rel="noreferrer noopener">
            阅读完整原文
          </a>
          <p className="ai-caution">
            AI 辅助学习内容，请以原文为准。 · AI-assisted learning material; verify
            details against the original article.
          </p>
          <button
            type="button"
            onClick={() => {
              progressStore.setCompleted(article.id, true);
              setCompleted(true);
            }}
          >
            {completed ? "已完成" : "标记为已完成"}
          </button>
          <nav className="lesson-actions" aria-label="课程导航">
            <Link to="/">返回今日课程</Link>
            {nextArticleId ? (
              <Link to={`/lesson/${date}/${nextArticleId}`}>下一篇</Link>
            ) : null}
          </nav>
        </section>
        <aside aria-label="语言提示">
          <h2>Språknycklar</h2>
          {visible.map((annotation) => (
            <div className={selectedId === annotation.id ? "language-card-focus" : ""} key={annotation.id}>
              <LanguageCard
                annotation={annotation}
                knownStore={knownStore}
                onPendingChange={(pending) =>
                  setPendingIds((current) => {
                    const next = new Set(current);
                    if (pending) next.add(annotation.id);
                    else next.delete(annotation.id);
                    return next;
                  })
                }
                onKnownChange={() => setKnownVersion((value) => value + 1)}
              />
            </div>
          ))}
        </aside>
      </div>
    </article>
  );
}
```

- [ ] **Step 6: Add the lesson route to `App.tsx`**

In `App.tsx`, import `createKnownStore` and `createProgressStore`, then create exactly
one browser store instance for each key beside the repository:

```ts
const repository = new LessonRepository();
const knownStore = createKnownStore();
const progressStore = createProgressStore();
```

Add the lesson route:

```tsx
<Route
  path="/lesson/:date/:id"
  element={
    <LessonRoute
      repository={repository}
      knownStore={knownStore}
      progressStore={progressStore}
    />
  }
/>
```

The complete `LessonRoute` implementation:

```tsx
function LessonRoute({
  repository,
  knownStore,
  progressStore,
}: {
  repository: LessonRepository;
  knownStore: ReturnType<typeof createKnownStore>;
  progressStore: ReturnType<typeof createProgressStore>;
}) {
  const { date, id } = useParams();
  const [article, setArticle] = useState<LessonArticle | null>(null);
  const [nextArticleId, setNextArticleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!date || !id) {
      setError("课程地址不完整");
      return;
    }
    repository
      .loadLesson(date)
      .then((lesson) => {
        const index = lesson.articles.findIndex((item) => item.id === id);
        const match = lesson.articles[index];
        if (!match) throw new Error("找不到这篇课程");
        setArticle(match);
        setNextArticleId(lesson.articles[index + 1]?.id ?? null);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [date, id, repository]);
  if (error) return <div role="alert">{error}</div>;
  return article ? (
    <LessonPage
      key={article.id}
      article={article}
      date={date as string}
      nextArticleId={nextArticleId}
      knownStore={knownStore}
      progressStore={progressStore}
    />
  ) : (
    <div>正在加载文章…</div>
  );
}
```

Import `useParams`, `LessonArticle`, `LessonPage`, `createKnownStore`,
`createProgressStore`, and their return types in `App.tsx`.

- [ ] **Step 7: Run reader tests**

Run:

```bash
pnpm vitest run tests/web/reader.test.tsx tests/web/today.test.tsx
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit reader and local learning state**

```bash
git add src/web tests/web
git commit -m "feat: add annotated reader and known-item memory"
```

---

### Task 10: Known-Items Management, Import/Export, and Restorable Progress

**Files:**
- Create: `src/web/pages/KnownPage.tsx`
- Create: `tests/web/known.test.tsx`
- Modify: `src/web/App.tsx`
- Modify: `src/web/pages/TodayPage.tsx`

**Interfaces:**
- Consumes: `KnownStore`, `ProgressStore`.
- Produces: route `#/known`, merge-only JSON import, export download, restore action, current completion count.

- [ ] **Step 1: Write a failing known-page test**

Create `tests/web/known.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { KnownPage } from "../../src/web/pages/KnownPage";
import { createKnownStore } from "../../src/web/storage/known";

describe("KnownPage", () => {
  it("searches and restores a known lemma", async () => {
    const storage = localStorage;
    storage.clear();
    const store = createKnownStore(storage);
    store.mark({
      kind: "vocabulary",
      canonical: "regering",
      original: "regeringen",
      meaningZh: "政府",
      meaningEn: "government",
      markedAt: "2026-07-23T05:00:00.000Z",
    });
    render(<KnownPage store={store} />);
    await userEvent.type(screen.getByRole("searchbox"), "reger");
    expect(screen.getByText("regering")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: /恢复/u }));
    expect(store.isKnown("vocabulary", "regering")).toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
pnpm vitest run tests/web/known.test.tsx
```

Expected: FAIL because `KnownPage` is missing.

- [ ] **Step 3: Implement known-item management**

Create `src/web/pages/KnownPage.tsx`:

```tsx
import { useMemo, useRef, useState } from "react";
import type { createKnownStore } from "../storage/known";

export function KnownPage({ store }: { store: ReturnType<typeof createKnownStore> }) {
  const [query, setQuery] = useState("");
  const [version, render] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const records = useMemo(
    () =>
      store
        .list()
        .filter((record) =>
          `${record.canonical} ${record.original}`.toLocaleLowerCase("sv").includes(
            query.toLocaleLowerCase("sv"),
          ),
        ),
    [query, store, version],
  );
  const download = () => {
    const blob = new Blob([store.exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "nyhetsspar-known-v1.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="page">
      <p className="eyebrow">MINA ORD</p>
      <h1>我的已掌握内容</h1>
      <label>
        搜索瑞典语
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="known-actions">
        <button type="button" onClick={download}>导出 JSON</button>
        <button type="button" onClick={() => fileInput.current?.click()}>导入 JSON</button>
        <button
          type="button"
          onClick={() => {
            if (!window.confirm("确认清空全部已掌握项目？此操作不能撤销。")) return;
            store.clearAll();
            render((value) => value + 1);
          }}
        >
          清空全部
        </button>
        <input
          ref={fileInput}
          hidden
          type="file"
          accept="application/json"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
              store.importJson(await file.text());
              setImportError(null);
              render((value) => value + 1);
            } catch {
              setImportError("导入失败：请选择由 Nyhetsspår 导出的 JSON 文件。");
            }
          }}
        />
      </div>
      {importError ? <p role="alert">{importError}</p> : null}
      {([
        ["vocabulary", "词汇"],
        ["phrase", "词组与固定搭配"],
        ["grammar", "语法"],
      ] as const).map(([kind, label]) => (
        <section key={kind}>
          <h2>{label}</h2>
          <ul className="known-list">
            {records.filter((record) => record.kind === kind).map((record) => (
              <li key={`${record.kind}:${record.canonical}`}>
                <span>
                  <strong>{record.canonical}</strong> · <span lang="sv">{record.original}</span>
                  <small>{record.meaningZh} / {record.meaningEn}</small>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    store.restore(record.kind, record.canonical);
                    render((value) => value + 1);
                  }}
                >
                  恢复提示
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
```

- [ ] **Step 4: Wire the known route, navigation, and real completion counts**

The single `knownStore` and `progressStore` instances were created in Task 9. Add
`KnownPage` to the imports and add this route:

```tsx
<Route path="/known" element={<KnownPage store={knownStore} />} />
```

In `Shell.tsx`, add the known-items link after history:

```tsx
<NavLink to="/known">已掌握</NavLink>
```

In `App`, add completion state:

```ts
const [completedIds, setCompletedIds] = useState(() => progressStore.completed());
```

Add this effect so returning through hash navigation or returning to the browser tab
re-reads the one progress key:

```ts
useEffect(() => {
  const refresh = () => setCompletedIds(progressStore.completed());
  const refreshWhenVisible = () => {
    if (document.visibilityState === "visible") refresh();
  };
  window.addEventListener("hashchange", refresh);
  document.addEventListener("visibilitychange", refreshWhenVisible);
  return () => {
    window.removeEventListener("hashchange", refresh);
    document.removeEventListener("visibilitychange", refreshWhenVisible);
  };
}, []);
```

Replace the temporary `new Set()` on the Today route with:

```tsx
<TodayPage lesson={today} completedIds={completedIds} />
```

Do not create stores inside pages or introduce another storage key.

- [ ] **Step 5: Run known, reader, and Today tests**

Run:

```bash
pnpm vitest run tests/web/known.test.tsx tests/web/reader.test.tsx tests/web/today.test.tsx
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit known-item management**

```bash
git add src/web tests/web
git commit -m "feat: manage and back up learned language items"
```

---

### Task 11: Distinctive Responsive Visual System and Accessibility

**Files:**
- Modify: `src/web/styles.css`
- Create: `playwright.config.ts`
- Create: `tests/e2e/accessibility.spec.ts`
- Modify: all web components only where semantic labels or focus targets are required.

**Interfaces:**
- Consumes: existing React pages and class names.
- Produces: responsive A-layout, keyboard-visible annotation states, no horizontal scrolling, desktop right rail and mobile stacked cards.

- [ ] **Step 1: Invoke the UI design skills**

Before editing CSS, read and apply `frontend-design` and `ui-ux-pro-max`. Preserve the approved concept:

- product: Nyhetsspår;
- audience: a post-SFI D independent learner;
- homepage job: present one daily issue of 2–3 articles;
- signature: language markings that resemble a careful learner’s annotated newspaper, not a generic dashboard;
- desktop reader: quiet text column with a sticky right annotation rail;
- mobile reader: the annotation rail becomes a normal section below the text.

- [ ] **Step 2: Write a failing responsive Playwright test**

Create `playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  webServer: {
    command: "pnpm dev --host 127.0.0.1",
    port: 5173,
    reuseExistingServer: true,
  },
  projects: [
    { name: "mobile-375", use: { browserName: "chromium", viewport: { width: 375, height: 812 } } },
    { name: "tablet-768", use: { browserName: "chromium", viewport: { width: 768, height: 1024 } } },
    { name: "laptop-1024", use: { browserName: "chromium", viewport: { width: 1024, height: 768 } } },
    { name: "wide-1440", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
  ],
});
```

Create `tests/e2e/accessibility.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("homepage has no horizontal overflow and exposes navigation labels", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test("approved visual tokens are active", async ({ page }) => {
  await page.goto("/");
  const green = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--green").trim(),
  );
  expect(green).toBe("#1f6247");
});

test("annotation controls are keyboard reachable", async ({ page }) => {
  await page.goto("/");
  const lessonLink = page.getByRole("link", { name: /开始阅读|复习/u }).first();
  if (await lessonLink.count()) {
    await lessonLink.click();
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
  }
});
```

- [ ] **Step 3: Run Playwright and confirm visual/overflow failures**

Run:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

Expected before CSS completion: FAIL because the minimal Task 8 stylesheet does not
define the approved `--green` token.

- [ ] **Step 4: Implement the visual token system and approved A layout**

Replace `src/web/styles.css` with:

```css
:root {
  color-scheme: light;
  --ink: #17382e;
  --ink-soft: #4e6258;
  --paper: #fbfcf9;
  --field: #edf3ee;
  --rule: #d3ddd6;
  --green: #1f6247;
  --green-deep: #153e31;
  --word: #f2d66e;
  --phrase: #6399aa;
  --grammar: #a66d91;
  --danger: #9b3f43;
  --radius-s: 8px;
  --radius-m: 14px;
  --radius-l: 22px;
  --shadow: 0 18px 60px rgba(24, 55, 43, 0.1);
  font-family: "Avenir Next", Avenir, "Segoe UI", sans-serif;
  background: var(--paper);
  color: var(--ink);
}

* { box-sizing: border-box; }
html { min-width: 320px; background: var(--paper); }
body { margin: 0; min-height: 100dvh; }
button, input { font: inherit; }
button, a { touch-action: manipulation; }
button:focus-visible, a:focus-visible, input:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--green) 55%, white);
  outline-offset: 3px;
}
a { color: var(--green); }

.app-shell { min-height: 100dvh; }
.site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 16px clamp(20px, 5vw, 72px);
  border-bottom: 1px solid color-mix(in srgb, var(--rule) 75%, transparent);
  background: color-mix(in srgb, var(--paper) 92%, transparent);
  backdrop-filter: blur(12px);
}
.brand {
  color: var(--ink);
  font: 700 24px/1 Georgia, serif;
  text-decoration: none;
  letter-spacing: -0.03em;
}
.site-header nav { display: flex; gap: 18px; }
.site-header nav a { color: var(--ink-soft); font-size: 14px; text-decoration: none; }
.site-header nav a.active { color: var(--green); font-weight: 700; }

.page {
  width: min(1180px, calc(100% - 40px));
  margin: 0 auto;
  padding: 64px 0 88px;
}
.eyebrow {
  margin: 0 0 12px;
  color: var(--green);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
h1, h2, h3 { text-wrap: balance; }
h1 {
  max-width: 850px;
  margin: 0;
  font: 700 clamp(40px, 7vw, 82px)/0.98 Georgia, serif;
  letter-spacing: -0.045em;
}
.lead {
  max-width: 650px;
  margin: 24px 0 42px;
  color: var(--ink-soft);
  font-size: 18px;
  line-height: 1.6;
}
.source-health { color: var(--ink-soft); font-size: 13px; }

.article-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.article-card {
  display: flex;
  min-height: 330px;
  flex-direction: column;
  padding: 24px;
  border: 1px solid var(--rule);
  border-radius: var(--radius-m);
  background: white;
  transition: transform 180ms ease, box-shadow 180ms ease;
}
.article-card:hover { transform: translateY(-3px); box-shadow: var(--shadow); }
.article-card__meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--green); font-size: 11px; font-weight: 800; }
.article-card h2 { margin: 24px 0 12px; font: 700 27px/1.12 Georgia, serif; }
.article-card p { color: var(--ink-soft); line-height: 1.6; }
.article-card__footer { display: flex; justify-content: space-between; gap: 12px; margin-top: auto; align-items: center; }

.lesson-page { width: min(1160px, calc(100% - 40px)); margin: 0 auto; padding: 50px 0 90px; }
.lesson-reader { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(280px, 0.7fr); gap: 54px; }
.lesson-reader > section { min-width: 0; }
.lesson-reader h1 { font-size: clamp(38px, 5vw, 66px); }
.summary-panel { margin: 30px 0; padding: 18px; border: 1px solid var(--rule); border-radius: var(--radius-m); background: var(--field); }
.summary-panel summary { cursor: pointer; font-weight: 800; }
.study-text { max-width: 68ch; font: 18px/1.82 Georgia, serif; }
.study-text p { margin: 0 0 1.35em; }
.annotation { display: inline; margin: 0; padding: 0 1px; border: 0; color: inherit; background: transparent; cursor: pointer; font: inherit; }
.annotation--vocabulary { background: linear-gradient(transparent 67%, var(--word) 67%); }
.annotation--phrase { border-bottom: 2px solid var(--phrase); }
.annotation--grammar { border-bottom: 2px dashed var(--grammar); }
.source-note { margin: 22px 0; padding: 20px; border-left: 4px solid var(--green); background: var(--field); }
.source-note blockquote { margin: 0 0 14px; font: 18px/1.6 Georgia, serif; }
.source-note figcaption p { color: var(--green); font-weight: 800; }
.source-note figcaption li { display: grid; gap: 4px; margin: 10px 0; color: var(--ink-soft); }
.ai-caution { max-width: 68ch; color: var(--ink-soft); font-size: 13px; line-height: 1.5; }
.lesson-actions { display: flex; gap: 18px; margin-top: 24px; }
.lesson-reader aside { position: sticky; top: 88px; align-self: start; max-height: calc(100dvh - 110px); overflow: auto; }
.language-card { margin-bottom: 12px; padding: 18px; border: 1px solid var(--rule); border-radius: var(--radius-m); background: white; }
.language-card-focus .language-card { border-color: var(--green); box-shadow: 0 0 0 4px rgba(31, 98, 71, 0.11); }
.language-card__kind { color: var(--green); font-size: 11px; font-weight: 800; text-transform: uppercase; }
.language-card button, .known-actions button, .known-list button {
  min-height: 44px;
  padding: 9px 13px;
  border: 1px solid #9eb5a8;
  border-radius: var(--radius-s);
  background: var(--field);
  color: var(--green);
  cursor: pointer;
  font-weight: 750;
}
.history-list, .known-list { display: grid; gap: 16px; margin-top: 32px; }
.history-list section, .known-list li, .empty-state, .error-state {
  padding: 22px;
  border: 1px solid var(--rule);
  border-radius: var(--radius-m);
  background: white;
}
.history-list a { display: block; padding: 8px 0; }
.history-filters { display: flex; flex-wrap: wrap; gap: 14px; margin: 28px 0; }
.history-filters label { display: grid; gap: 6px; color: var(--ink-soft); }
.history-filters select { min-height: 42px; padding: 7px 32px 7px 10px; border: 1px solid var(--rule); border-radius: var(--radius-s); background: white; }
.known-list { padding: 0; list-style: none; }
.known-list li { display: flex; justify-content: space-between; align-items: center; gap: 20px; }
.known-list small { display: block; margin-top: 5px; color: var(--ink-soft); }
.known-actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 20px 0; }
input[type="search"] { display: block; width: min(100%, 520px); min-height: 46px; margin-top: 8px; padding: 10px 12px; border: 1px solid var(--rule); border-radius: var(--radius-s); }

@media (max-width: 900px) {
  .article-grid { grid-template-columns: 1fr; }
  .article-card { min-height: 0; }
  .lesson-reader { grid-template-columns: 1fr; }
  .lesson-reader aside { position: static; max-height: none; overflow: visible; border-top: 1px solid var(--rule); padding-top: 30px; }
}

@media (max-width: 620px) {
  .site-header { align-items: flex-start; flex-direction: column; gap: 10px; padding: 14px 18px; }
  .site-header nav { flex-wrap: wrap; gap: 10px 16px; }
  .site-header nav { gap: 10px; overflow-x: auto; }
  .site-header nav a { white-space: nowrap; }
  .page, .lesson-page { width: min(100% - 28px, 1180px); padding-top: 42px; }
  h1 { font-size: 42px; }
  .study-text { font-size: 17px; line-height: 1.74; }
  .known-list li { align-items: flex-start; flex-direction: column; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
}
```

- [ ] **Step 5: Run unit, build, and Playwright checks**

Run:

```bash
pnpm test
pnpm build
pnpm test:e2e
```

Expected: all commands exit 0; desktop and mobile tests pass.

- [ ] **Step 6: Commit the visual system**

```bash
git add src/web playwright.config.ts tests/e2e
git commit -m "feat: add responsive annotated-news design"
```

---

### Task 12: CI, Stockholm-Aware Generation, and GitHub Pages Deployment

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/pages.yml`
- Create: `.env.example`
- Create: `scripts/check-build-secrets.ts`
- Create: `scripts/smoke-deployment.ts`
- Create: `tests/pipeline/secret-scan.test.ts`

**Interfaces:**
- Consumes: `pnpm test`, `pnpm build`, `pnpm pipeline`, `dist`.
- Produces: pull-request CI, two UTC cron triggers, data commit, Pages artifact and deployment.

- [ ] **Step 1: Write a failing build-secret scanner test**

Create `tests/pipeline/secret-scan.test.ts`:

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanDirectoryForSecrets } from "../../scripts/check-build-secrets";

describe("build secret scanner", () => {
  it("rejects an OpenAI-style key in a build directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "nyhetsspar-secret-"));
    await writeFile(join(root, "asset.js"), 'const key = "sk-test-secret-value";', "utf8");
    await expect(scanDirectoryForSecrets(root)).rejects.toThrow(/secret-pattern/u);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run:

```bash
pnpm vitest run tests/pipeline/secret-scan.test.ts
```

Expected: FAIL because the scanner is missing.

- [ ] **Step 3: Implement the scanner without printing secret values**

Create `scripts/check-build-secrets.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const patterns = [/sk-[A-Za-z0-9_-]{12,}/u, /OPENAI_API_KEY\s*[:=]\s*["'][^"']+/u];

export async function scanDirectoryForSecrets(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await scanDirectoryForSecrets(path);
      continue;
    }
    const text = await readFile(path, "utf8").catch(() => "");
    if (patterns.some((pattern) => pattern.test(text))) {
      throw new Error(`secret-pattern:${path}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await scanDirectoryForSecrets(process.argv[2] ?? "dist");
  process.stdout.write("secret-scan:clean\n");
}
```

Create `.env.example`:

```dotenv
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini
```

Create `scripts/smoke-deployment.ts`:

```ts
import { DailyLessonSchema, LessonIndexSchema } from "../src/contracts/content";

async function requireOk(url: URL): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`smoke-http-${response.status}:${url}`);
  return response;
}

export async function smokeDeployment(rawBaseUrl: string): Promise<void> {
  const base = new URL(rawBaseUrl.endsWith("/") ? rawBaseUrl : `${rawBaseUrl}/`);
  const homepage = await (await requireOk(base)).text();
  const assets = [...homepage.matchAll(/(?:src|href)="([^"]+)"/gu)]
    .map((match) => new URL(match[1] as string, base))
    .filter((url) => url.origin === base.origin && url.pathname.includes("/assets/"));
  await Promise.all(assets.map(requireOk));

  const index = LessonIndexSchema.parse(
    await (await requireOk(new URL("data/index.json", base))).json(),
  );
  const latest = index.dates[0];
  if (!latest) return;
  const lesson = DailyLessonSchema.parse(
    await (await requireOk(new URL(`data/lessons/${latest.date}.json`, base))).json(),
  );
  if (lesson.status === "ready" && (lesson.articles.length < 2 || lesson.articles.length > 3)) {
    throw new Error(`smoke-article-count:${lesson.articles.length}`);
  }
  for (const article of lesson.articles) {
    new URL(article.sourceUrl);
  }
}

const target = process.argv[2];
if (target) {
  await smokeDeployment(target);
  process.stdout.write("deployment-smoke:ok\n");
}
```

- [ ] **Step 4: Add pull-request CI**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches-ignore:
      - main

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm build
      - run: pnpm check:secrets
```

- [ ] **Step 5: Add a single Pages workflow for code pushes and daily data**

Create `.github/workflows/pages.yml`:

```yaml
name: Generate lessons and deploy Pages

on:
  push:
    branches:
      - main
  schedule:
    - cron: "0 5 * * *"
    - cron: "0 6 * * *"
  workflow_dispatch:
    inputs:
      lesson_date:
        description: "Optional current Stockholm date in YYYY-MM-DD"
        required: false
        type: string

permissions:
  contents: write
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Sync the latest lesson data
        if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
        run: git pull --ff-only origin main
      - name: Generate daily lessons
        if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          OPENAI_MODEL: ${{ vars.OPENAI_MODEL || 'gpt-5.4-mini' }}
          LESSON_DATE: ${{ inputs.lesson_date }}
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            if [ -n "$LESSON_DATE" ]; then
              pnpm pipeline -- --force=true --date="$LESSON_DATE"
            else
              pnpm pipeline -- --force=true
            fi
          else
            pnpm pipeline
          fi
      - run: pnpm test
      - run: pnpm build
      - run: pnpm check:secrets
      - name: Commit validated derived lesson data
        if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add public/data data/editorial-ledger.json data/cache/index.json
          if git diff --cached --quiet; then
            echo "No lesson data changes"
          else
            git commit -m "content: publish daily Swedish lesson"
            git push
          fi
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v4
        with:
          path: dist

  deploy:
    runs-on: ubuntu-latest
    needs: build
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Deploy GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
      - name: Smoke-check deployed homepage
        run: |
          for attempt in 1 2 3 4 5; do
            pnpm smoke -- "${{ steps.deployment.outputs.page_url }}" && exit 0
            sleep 5
          done
          exit 1
```

The deploy job has the officially required `pages: write` and `id-token: write` permissions at workflow scope, uses `configure-pages@v5`, `upload-pages-artifact@v4`, and `deploy-pages@v4`, and declares the `github-pages` environment.

- [ ] **Step 6: Run local workflow-equivalent checks**

Run:

```bash
pnpm vitest run tests/pipeline/secret-scan.test.ts
pnpm test
pnpm build
pnpm check:secrets
```

Expected: all commands exit 0 and secret scan prints `secret-scan:clean`.

- [ ] **Step 7: Commit automation**

```bash
git add .github .env.example scripts/check-build-secrets.ts scripts/smoke-deployment.ts tests/pipeline/secret-scan.test.ts
git commit -m "ci: automate lesson generation and Pages deployment"
```

---

### Task 13: Production Readiness, Documentation, and End-to-End Verification

**Files:**
- Create: `README.md`
- Create: `tests/e2e/navigation.spec.ts`
- Modify: `public/data/index.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: all application commands and deployment requirements.
- Produces: a documented, clean, testable repository ready to push to a public GitHub repository.

- [ ] **Step 1: Write end-to-end navigation and fallback tests**

Create `tests/e2e/navigation.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("history and known pages remain reachable from primary navigation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "历史" }).click();
  await expect(page.getByRole("heading", { name: "历史课程" })).toBeVisible();
  await page.getByRole("link", { name: "已掌握" }).click();
  await expect(page.getByRole("heading", { name: "我的已掌握内容" })).toBeVisible();
});

test("external source links use a safe new browsing context", async ({ page }) => {
  await page.goto("/");
  const articleLink = page.getByRole("link", { name: /开始阅读|复习/u }).first();
  if (await articleLink.count()) {
    await articleLink.click();
    const sourceLink = page.getByRole("link", { name: "阅读完整原文" });
    await expect(sourceLink).toHaveAttribute("target", "_blank");
    await expect(sourceLink).toHaveAttribute("rel", /noopener/u);
  }
});
```

- [ ] **Step 2: Add deployment and operational documentation**

Create `README.md` with these exact sections and commands:

~~~~markdown
# Nyhetsspår

Nyhetsspår creates 2–3 Swedish news-learning lessons per day from publicly readable SVT, Aftonbladet, and DN articles. It does not bypass paywalls and does not republish full source articles.

## Local development

Requirements: Node.js 22 and pnpm 10.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Do not commit `.env.local`.

## Tests

```bash
pnpm test
pnpm build
pnpm test:e2e
pnpm check:secrets
```

## Generate a lesson manually

```bash
OPENAI_API_KEY="your-key" pnpm pipeline -- --force=true
```

Use `--date=YYYY-MM-DD` to retry the current Stockholm date explicitly. Historical
backfills are rejected so current articles can never be published under an old date.

## GitHub setup

1. Push the repository to a public GitHub repository.
2. Open Settings → Pages and select GitHub Actions as the source.
3. Open Settings → Actions → General and give workflow permissions read/write access.
4. Add repository secret `OPENAI_API_KEY`.
5. Add repository variable `OPENAI_MODEL` with value `gpt-5.4-mini`.
6. In Actions, run “Generate lessons and deploy Pages” manually once.
7. Confirm the workflow deploys a `github-pages` environment and publishes the URL.

The workflow runs at 05:00 and 06:00 UTC. The pipeline checks Europe/Stockholm local time, so only the trigger at or after 07:00 local time creates the lesson.

## Content and privacy

- Full source article bodies are used only during one workflow run.
- Full bodies are not committed, uploaded as artifacts, or logged.
- Lessons include derived Swedish study text and short attributed source extracts.
- Known vocabulary and completion progress remain in the current browser.
- Export known items from the “已掌握” page before clearing browser storage.

## Failure recovery

- If one source fails, the other sources continue.
- If fewer than two validated lessons are available, the day is published with `delayed` status and no stale news is presented as current.
- Use workflow dispatch with an explicit date to retry.
- Review GitHub Actions logs for source health categories; logs intentionally omit source bodies and API credentials.

## Cost control

The default model is `gpt-5.4-mini`. Set a USD 5 monthly budget or prepaid limit in the OpenAI API account. The pipeline limits daily output to three lessons, batches duplicate review, caches content hashes, and performs at most one format repair.
~~~~

- [ ] **Step 3: Verify the production index starts empty**

Set `public/data/index.json` to:

```json
{
  "schemaVersion": 1,
  "dates": []
}
```

Run:

```bash
test ! -e public/data/lessons/2026-07-23.json
```

Expected: exit 0. The website renders the no-lessons empty state until the first
manual workflow run creates real derived data.

- [ ] **Step 4: Extend `.gitignore` for local test output**

Append:

```gitignore
.env.local
.tmp-*
coverage/
playwright-report/
test-results/
```

- [ ] **Step 5: Run the complete local verification matrix**

Run:

```bash
pnpm test
pnpm build
pnpm check:secrets
pnpm test:e2e
git diff --check
git status --short
```

Expected:

- unit and component tests pass;
- TypeScript/Vite build succeeds;
- secret scan prints `secret-scan:clean`;
- all 375, 768, 1024, and 1440 pixel Playwright projects pass;
- `git diff --check` prints no errors;
- `git status --short` lists only the Task 13 files before commit.

- [ ] **Step 6: Perform a no-network privacy audit**

Run:

```bash
rg -n "OPENAI_API_KEY|sk-[A-Za-z0-9_-]{12,}" dist public src
rg -n "\"body\"\\s*:" public/data data
```

Expected:

- first command returns no matches;
- second command returns no matches, confirming raw article bodies are not persisted.

- [ ] **Step 7: Commit production readiness**

```bash
git add README.md .gitignore public/data tests/e2e
git commit -m "docs: prepare Nyhetsspår for public deployment"
```

- [ ] **Step 8: Apply completion verification**

Invoke `superpowers:verification-before-completion`, rerun every command it requires, and do not claim success from earlier cached output.

---

## Spec Coverage Map

| Spec requirement | Implemented by |
| --- | --- |
| Public-source discovery and access filtering | Tasks 2–3 |
| robots, paywall, login, video/text insufficiency boundaries | Task 2 |
| SVT, Aftonbladet, DN adapters | Task 3 |
| Cross-source and seven-day event deduplication | Task 4 |
| Material-update/follow-up labels and related coverage | Tasks 4, 6, 8–9 |
| Domestic/international and topic/source balancing | Task 5 |
| 300–500 natural Swedish words, difficulty label only | Tasks 1 and 6 |
| Chinese/English summaries and annotation meanings | Tasks 1 and 6 |
| Short source quotations and source validation | Task 6 |
| No raw article bodies in public storage | Tasks 2, 7, 12, 13 |
| Daily Stockholm 07:00 behavior | Tasks 7 and 12 |
| GitHub Pages deployment | Task 12 |
| Daily-issue homepage and selected A reader layout | Tasks 8, 9, 11 |
| Lemma/phrase/grammar known-state suppression | Tasks 9–10 |
| Undo, restore, import, export, opened/completed state, and reading position | Tasks 9–10 |
| Searchable/grouped known items and filtered history | Tasks 8 and 10 |
| Responsive and accessible UI | Task 11 |
| Failure recovery and delayed state | Tasks 7, 12, 13 |
| USD 5 cost controls and secret handling | Tasks 4, 6, 7, 12, 13 |
| Full automated and post-deployment verification | Tasks 11–13 |

## Primary Documentation Used During Implementation

- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI model catalog: https://developers.openai.com/api/docs/models
- Aftonbladet official RSS list: https://www.aftonbladet.se/omaftonbladet/a/qny8vz/sa-latt-anvander-du-aftonbladets-rss
- GitHub Pages custom workflows: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
