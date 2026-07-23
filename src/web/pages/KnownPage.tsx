import { useMemo, useState } from "react";
import {
  KnownStoreError,
  type createKnownStore,
} from "../storage/known";

type KnownStore = ReturnType<typeof createKnownStore>;
type KnownKind = ReturnType<KnownStore["list"]>[number]["kind"];

const categories = [
  ["vocabulary", "词汇"],
  ["phrase", "词组与固定搭配"],
  ["grammar", "语法"],
] as const satisfies ReadonlyArray<readonly [KnownKind, string]>;

export function KnownPage({ store }: { store: KnownStore }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<KnownKind | "all">("all");
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const normalizedQuery = query.toLocaleLowerCase("sv").trim();
  const records = useMemo(
    () =>
      store
        .list()
        .filter((record) => category === "all" || record.kind === category)
        .filter((record) =>
          `${record.canonical} ${record.original} ${record.meaningZh} ${record.meaningEn}`
            .normalize("NFKC")
            .toLocaleLowerCase("sv")
            .includes(normalizedQuery),
        ),
    [category, normalizedQuery, revision, store],
  );

  const explainStoreError = (reason: unknown, action: "导入" | "导出") => {
    if (
      reason instanceof KnownStoreError &&
      reason.code === "incompatible-storage"
    ) {
      return `${action}失败：现有本地数据无法安全合并。请先保留原始数据，或明确选择“清空全部”。`;
    }
    if (
      reason instanceof KnownStoreError &&
      (reason.code === "storage-unavailable" ||
        reason.code === "storage-write-failed")
    ) {
      return `${action}失败：浏览器目前无法安全访问本地存储。`;
    }
    return `${action}失败：请选择由 Nyhetsspår 导出的 JSON 文件。`;
  };

  const download = () => {
    setError(null);
    setMessage(null);
    let url: string | null = null;
    let anchor: HTMLAnchorElement | null = null;
    try {
      const blob = new Blob([store.exportJson()], {
        type: "application/json",
      });
      url = URL.createObjectURL(blob);
      anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "nyhetsspar-known-v1.json";
      document.body.append(anchor);
      anchor.click();
      setMessage("备份已导出。");
    } catch (reason) {
      setError(explainStoreError(reason, "导出"));
    } finally {
      anchor?.remove();
      if (url) {
        URL.revokeObjectURL(url);
      }
    }
  };

  return (
    <section className="page">
      <p className="eyebrow">MINA ORD</p>
      <h1>我的已掌握内容</h1>
      <div className="known-filters">
        <label>
          搜索瑞典语或释义
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          类别
          <select
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as KnownKind | "all")
            }
          >
            <option value="all">全部</option>
            {categories.map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="known-actions">
        <button type="button" onClick={download}>
          导出 JSON
        </button>
        <label>
          选择 JSON 备份文件
          <input
            aria-describedby="known-import-help"
            type="file"
            accept="application/json,.json"
            onChange={async (event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              if (!file) {
                return;
              }
              setError(null);
              setMessage(null);
              try {
                const result = store.importJson(await file.text());
                setMessage(
                  `导入完成：新增 ${result.added} 项，共 ${result.total} 项。`,
                );
                setRevision((current) => current + 1);
              } catch (reason) {
                setError(explainStoreError(reason, "导入"));
              } finally {
                input.value = "";
              }
            }}
          />
        </label>
        <small id="known-import-help">导入只会合并，不会删除现有项目。</small>
        <button
          type="button"
          onClick={() => {
            if (!window.confirm("确认清空全部已掌握项目？此操作不能撤销。")) {
              return;
            }
            store.clearAll();
            setError(null);
            setMessage("已清空全部已掌握项目。");
            setRevision((current) => current + 1);
          }}
        >
          清空全部
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}

      {records.length === 0 ? (
        <p className="empty-state">当前没有已掌握项目。</p>
      ) : null}
      {categories
        .filter(([kind]) => category === "all" || category === kind)
        .map(([kind, label]) => {
          const categoryRecords = records.filter(
            (record) => record.kind === kind,
          );
          return (
            <section key={kind}>
              <h2>{label}</h2>
              <p>{categoryRecords.length} 项</p>
              <ul className="known-list">
                {categoryRecords.map((record) => (
                  <li key={`${record.kind}:${record.canonical}`}>
                    <span>
                      <strong>{record.canonical}</strong>
                      <span lang="sv"> · {record.original}</span>
                      <small>
                        {record.meaningZh} / {record.meaningEn}
                      </small>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        store.restore(record.kind, record.canonical);
                        setError(null);
                        setMessage(null);
                        setRevision((current) => current + 1);
                      }}
                    >
                      恢复提示
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
    </section>
  );
}
