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
  onProgressChange,
}: {
  article: LessonArticle;
  date: string;
  nextArticleId: string | null;
  knownStore: ReturnType<typeof createKnownStore>;
  progressStore: ReturnType<typeof createProgressStore>;
  onProgressChange: () => void;
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
    window.requestAnimationFrame(() => window.scrollTo({ top: saved }));

    let timer: number | undefined;
    const remember = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(
        () => progressStore.savePosition(article.id, window.scrollY),
        250,
      );
    };
    window.addEventListener("scroll", remember, { passive: true });
    return () => {
      window.removeEventListener("scroll", remember);
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
      progressStore.savePosition(article.id, window.scrollY);
    };
  }, [article.id, progressStore]);

  const hiddenIds = useMemo(
    () =>
      new Set(
        article.annotations
          .filter((annotation) =>
            knownStore.isKnown(annotation.kind, annotation.canonical),
          )
          .map((annotation) => annotation.id),
      ),
    [article, knownStore, knownVersion],
  );

  const visibleAnnotations = article.annotations.filter(
    (annotation) =>
      !hiddenIds.has(annotation.id) || pendingIds.has(annotation.id),
  );

  const selectAnnotation = (id: string) => {
    setSelectedId(id);
    window.requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: "center" });
    });
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
          <p>
            {article.difficulty.level} · {article.difficulty.readingMinutes} min
          </p>
          <ul className="annotation-legend" aria-label="标注图例">
            <li>
              <span
                aria-hidden="true"
                className="annotation-legend__sample annotation-legend__sample--vocabulary"
              >
                ord
              </span>
              <span>词汇 · Vocabulary</span>
            </li>
            <li>
              <span
                aria-hidden="true"
                className="annotation-legend__sample annotation-legend__sample--phrase"
              >
                uttryck
              </span>
              <span>词组 · Phrase</span>
            </li>
            <li>
              <span
                aria-hidden="true"
                className="annotation-legend__sample annotation-legend__sample--grammar"
              >
                sats
              </span>
              <span>语法 · Grammar</span>
            </li>
          </ul>
          <details className="summary-panel" open>
            <summary>60 秒读懂</summary>
            <p lang="sv">{article.summaries.sv}</p>
            <p lang="zh-CN">{article.summaries.zh}</p>
            <p lang="en">{article.summaries.en}</p>
          </details>

          <AnnotationText
            paragraphs={article.studyParagraphs}
            hiddenIds={hiddenIds}
            onSelect={selectAnnotation}
          />

          <section>
            <h2>原句解析</h2>
            {article.originalSentenceNotes.map((note) => (
              <figure className="source-note" key={note.quote}>
                <blockquote lang="sv">{note.quote}</blockquote>
                <figcaption>
                  <p>媒体实际用法 · Usage in this news sentence</p>
                  <ul>
                    {note.annotationIds.map((id) => {
                      const annotation = article.annotations.find(
                        (item) => item.id === id,
                      );
                      if (
                        !annotation ||
                        knownStore.isKnown(
                          annotation.kind,
                          annotation.canonical,
                        )
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
                          </strong>{" "}
                          <span>
                            {annotation.meaningZh} / {annotation.meaningEn}
                          </span>
                          {usage ? <span> · {usage}</span> : null}
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
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {item.source.toUpperCase()} · {item.title}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <a
            href={article.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            阅读完整原文
          </a>
          <p className="ai-caution">
            AI 辅助学习内容，请以原文为准。 · AI-assisted learning material;
            verify details against the original article.
          </p>
          <button
            type="button"
            disabled={completed}
            onClick={() => {
              progressStore.setCompleted(article.id, true);
              setCompleted(true);
              onProgressChange();
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

        <aside className="annotation-rail" aria-label="语言提示">
          <h2>Språknycklar</h2>
          {visibleAnnotations.map((annotation) => (
            <div
              className={
                selectedId === annotation.id ? "language-card-focus" : ""
              }
              key={annotation.id}
            >
              <LanguageCard
                annotation={annotation}
                articleId={article.id}
                knownStore={knownStore}
                onPendingChange={(pending) =>
                  setPendingIds((current) => {
                    const next = new Set(current);
                    if (pending) {
                      next.add(annotation.id);
                    } else {
                      next.delete(annotation.id);
                    }
                    return next;
                  })
                }
                onKnownChange={() =>
                  setKnownVersion((current) => current + 1)
                }
              />
            </div>
          ))}
        </aside>
      </div>
    </article>
  );
}
