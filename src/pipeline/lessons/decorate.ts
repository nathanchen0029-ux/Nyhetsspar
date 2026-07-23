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

interface Match {
  start: number;
  end: number;
  id: string;
  priority: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Decorate only complete Unicode words, without changing the source text. */
export function decorateParagraphs(paragraphs: string[], annotations: TargetOnly[]) {
  return paragraphs.map((paragraph, paragraphIndex) => {
    const matches: Match[] = [];
    for (const annotation of annotations) {
      for (const target of annotation.targets) {
        if (!target) continue;
        const expression = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(target)})(?![\\p{L}\\p{N}])`, "giu");
        for (const match of paragraph.matchAll(expression)) {
          const prefix = match[1] ?? "";
          const text = match[2];
          if (match.index === undefined || text === undefined) continue;
          const start = match.index + prefix.length;
          matches.push({
            start,
            end: start + text.length,
            id: annotation.id,
            priority: priority[annotation.kind] * 10_000 + text.length,
          });
        }
      }
    }

    const accepted = matches
      .sort((left, right) => right.priority - left.priority || left.start - right.start || left.id.localeCompare(right.id, "sv"))
      .filter((match, index, all) => !all.slice(0, index).some((other) => match.start < other.end && match.end > other.start))
      .sort((left, right) => left.start - right.start);

    const segments: Array<{ text: string; annotationId?: string }> = [];
    let cursor = 0;
    for (const match of accepted) {
      if (cursor < match.start) segments.push({ text: paragraph.slice(cursor, match.start) });
      segments.push({ text: paragraph.slice(match.start, match.end), annotationId: match.id });
      cursor = match.end;
    }
    if (cursor < paragraph.length) segments.push({ text: paragraph.slice(cursor) });
    if (segments.length === 0) segments.push({ text: paragraph });
    return { id: `p${paragraphIndex + 1}`, segments };
  });
}
