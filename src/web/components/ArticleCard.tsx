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
        <span>
          {article.difficulty.level} · {article.difficulty.readingMinutes} min
        </span>
        <Link to={`/lesson/${date}/${article.id}`}>
          {completed ? "复习" : "开始阅读"}
        </Link>
      </div>
    </article>
  );
}
