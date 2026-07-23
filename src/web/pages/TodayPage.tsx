import type { DailyLesson } from "../../contracts/content";
import { ArticleCard } from "../components/ArticleCard";

export function TodayPage({
  lesson,
  completedIds,
}: {
  lesson: DailyLesson;
  completedIds: Set<string>;
}) {
  const completeCount = lesson.articles.filter((article) =>
    completedIds.has(article.id),
  ).length;

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
