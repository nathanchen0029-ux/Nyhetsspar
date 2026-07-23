import { useCallback, useEffect, useState } from "react";
import {
  HashRouter,
  Route,
  Routes,
  useParams,
} from "react-router-dom";
import type {
  DailyLesson,
  LessonArticle,
  LessonIndex,
} from "../contracts/content";
import { Shell } from "./components/Shell";
import { LessonRepository } from "./data/repository";
import { HistoryPage } from "./pages/HistoryPage";
import { KnownPage } from "./pages/KnownPage";
import { LessonPage } from "./pages/LessonPage";
import { TodayPage } from "./pages/TodayPage";
import { createKnownStore } from "./storage/known";
import { createProgressStore } from "./storage/progress";

const repository = new LessonRepository();
const knownStore = createKnownStore();
const progressStore = createProgressStore();

export function App() {
  const [index, setIndex] = useState<LessonIndex | null>(null);
  const [today, setToday] = useState<DailyLesson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completedIds, setCompletedIds] = useState(() =>
    progressStore.completed(),
  );
  const refreshProgress = useCallback(
    () => setCompletedIds(progressStore.completed()),
    [],
  );

  useEffect(() => {
    repository
      .loadIndex()
      .then(async (loadedIndex) => {
        const latest = loadedIndex.dates[0];
        if (latest) {
          const loadedToday = await repository.loadLesson(latest);
          setToday(loadedToday);
        }
        setIndex(loadedIndex);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, []);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refreshProgress();
      }
    };
    window.addEventListener("hashchange", refreshProgress);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("hashchange", refreshProgress);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshProgress]);

  return (
    <HashRouter>
      <Shell>
        {error ? (
          <div role="alert" className="error-state">
            课程加载失败：{error}
          </div>
        ) : !index ? (
          <div className="loading-state">正在加载课程…</div>
        ) : (
          <Routes>
            <Route
              path="/"
              element={
                today ? (
                  <TodayPage lesson={today} completedIds={completedIds} />
                ) : (
                  <div className="empty-state">还没有课程。</div>
                )
              }
            />
            <Route path="/history" element={<HistoryPage index={index} />} />
            <Route path="/known" element={<KnownPage store={knownStore} />} />
            <Route
              path="/lesson/:date/:id"
              element={
                <LessonRoute
                  repository={repository}
                  knownStore={knownStore}
                  progressStore={progressStore}
                  onProgressChange={refreshProgress}
                />
              }
            />
          </Routes>
        )}
      </Shell>
    </HashRouter>
  );
}

function LessonRoute({
  repository: lessonRepository,
  knownStore: lessonKnownStore,
  progressStore: lessonProgressStore,
  onProgressChange,
}: {
  repository: LessonRepository;
  knownStore: ReturnType<typeof createKnownStore>;
  progressStore: ReturnType<typeof createProgressStore>;
  onProgressChange: () => void;
}) {
  const { date, id } = useParams();
  const [article, setArticle] = useState<LessonArticle | null>(null);
  const [nextArticleId, setNextArticleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setArticle(null);
    setNextArticleId(null);
    setError(null);
    if (!date || !id) {
      setError("课程地址不完整");
      return;
    }

    let active = true;
    lessonRepository
      .loadIndex()
      .then((loadedIndex) => {
        const entry = loadedIndex.dates.find((item) => item.date === date);
        if (!entry) {
          throw new Error("找不到当天课程");
        }
        return lessonRepository.loadLesson(entry);
      })
      .then((lesson) => {
        if (!active) {
          return;
        }
        const articleIndex = lesson.articles.findIndex(
          (item) => item.id === id,
        );
        const match = lesson.articles[articleIndex];
        if (!match) {
          throw new Error("找不到这篇课程");
        }
        setArticle(match);
        setNextArticleId(lesson.articles[articleIndex + 1]?.id ?? null);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    return () => {
      active = false;
    };
  }, [date, id, lessonRepository]);

  if (error) {
    return <div role="alert">{error}</div>;
  }
  if (!article || !date) {
    return <div>正在加载文章…</div>;
  }
  return (
    <LessonPage
      key={article.id}
      article={article}
      date={date}
      nextArticleId={nextArticleId}
      knownStore={lessonKnownStore}
      progressStore={lessonProgressStore}
      onProgressChange={onProgressChange}
    />
  );
}
