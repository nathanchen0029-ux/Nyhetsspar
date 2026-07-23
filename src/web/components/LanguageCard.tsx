import { useEffect, useRef, useState } from "react";
import type { Annotation } from "../../contracts/content";
import type { createKnownStore } from "../storage/known";

const kindLabels: Record<Annotation["kind"], string> = {
  vocabulary: "词汇 · Vocabulary",
  phrase: "词组与固定搭配 · Phrase & collocation",
  grammar: "语法 · Grammar",
};

export function LanguageCard({
  annotation,
  articleId,
  knownStore,
  onPendingChange,
  onKnownChange,
}: {
  annotation: Annotation;
  articleId?: string;
  knownStore: ReturnType<typeof createKnownStore>;
  onPendingChange: (pending: boolean) => void;
  onKnownChange: () => void;
}) {
  const [undo, setUndo] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (timer.current !== undefined) {
        window.clearTimeout(timer.current);
      }
    },
    [],
  );

  const mark = () => {
    knownStore.mark({
      kind: annotation.kind,
      canonical: annotation.canonical,
      original: annotation.targets[0] ?? annotation.canonical,
      meaningZh: annotation.meaningZh,
      meaningEn: annotation.meaningEn,
      markedAt: new Date().toISOString(),
      articleId,
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
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
    knownStore.restore(annotation.kind, annotation.canonical);
    setUndo(false);
    onPendingChange(false);
    onKnownChange();
  };

  return (
    <article
      className={`language-card language-card--${annotation.kind}`}
      id={annotation.id}
    >
      <p className="language-card__kind">{kindLabels[annotation.kind]}</p>
      <h3>{annotation.targets[0] ?? annotation.canonical}</h3>
      <p>
        <strong>中文</strong> {annotation.meaningZh}
      </p>
      <p>
        <strong>English</strong> {annotation.meaningEn}
      </p>
      <p lang="sv">{annotation.exampleSv}</p>
      {undo ? (
        <button type="button" onClick={restore}>
          撤销
        </button>
      ) : (
        <button type="button" onClick={mark}>
          我认识这个{annotation.kind === "grammar" ? "语法点" : "项目"}
        </button>
      )}
    </article>
  );
}
