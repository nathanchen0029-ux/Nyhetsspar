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
