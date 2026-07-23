import { z } from "zod";
import { StudyParagraphSchema } from "../../contracts/content";

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
