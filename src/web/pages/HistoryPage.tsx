import { useState } from "react";
import { Link } from "react-router-dom";
import type { LessonIndex } from "../../contracts/content";

export function HistoryPage({ index }: { index: LessonIndex }) {
  const [source, setSource] = useState("all");
  const [scope, setScope] = useState("all");
  const [topic, setTopic] = useState("all");

  const visibleDays = index.dates
    .map((day) => ({
      day,
      articles: day.articles.filter(
        (article) =>
          (source === "all" || article.source === source) &&
          (scope === "all" || article.scope === scope) &&
          (topic === "all" || article.topic === topic),
      ),
    }))
    .filter(({ articles }) => articles.length > 0);

  return (
    <section className="page">
      <p className="eyebrow">ARKIV</p>
      <h1>历史课程</h1>
      <div className="history-filters" role="group" aria-label="历史筛选">
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
        {visibleDays.length === 0 ? (
          <p className="empty-state">没有符合筛选条件的课程。</p>
        ) : (
          visibleDays.map(({ day, articles }) => (
            <section key={day.date}>
              <h2>{day.date}</h2>
              {articles.map((article) => (
                <Link key={article.id} to={`/lesson/${day.date}/${article.id}`}>
                  {article.title} · {article.source.toUpperCase()} · {article.difficulty}
                  {article.isFollowUp ? " · 后续报道" : ""}
                </Link>
              ))}
            </section>
          ))
        )}
      </div>
    </section>
  );
}
