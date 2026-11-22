import { phaseOf, topoOrder } from "./layout";
import type { Phase, Task, Worker } from "./types";

interface Props {
  tasks: Task[];
  workers: Worker[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const SECTIONS: { phase: Phase; label: string }[] = [
  { phase: "doing", label: "作業中" },
  { phase: "ready", label: "次にやれる（着手可）" },
  { phase: "blocked", label: "待ち（先行タスク未完了）" },
];

export function WorkerView({ tasks, workers, selectedId, onSelect }: Props) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ordered = topoOrder(tasks);
  const ids = new Set(workers.map((w) => w.id));
  const columns: { key: string; worker: Worker | null }[] = [
    ...workers.map((w) => ({ key: w.id, worker: w })),
    ...(tasks.some((t) => !t.workerId || !ids.has(t.workerId)) ? [{ key: "__none", worker: null }] : []),
  ];

  return (
    <div className="worker-view">
      {columns.map(({ key, worker }) => {
        const mine = ordered.filter((t) => (worker ? t.workerId === worker.id : !t.workerId || !ids.has(t.workerId)));
        const done = mine.filter((t) => t.status === "done").length;
        return (
          <section key={key} className="worker-col" style={{ ["--w" as string]: worker?.color ?? "var(--muted)" }}>
            <h3>
              <span className="dot" />
              {worker?.name ?? "未割当"}
              <small>
                完了 {done}/{mine.length}
              </small>
            </h3>
            {SECTIONS.map((s) => {
              const list = mine.filter((t) => phaseOf(t, byId) === s.phase);
              return (
                <div key={s.phase} className="wsec">
                  <h4>{s.label}</h4>
                  {list.length === 0 ? (
                    <p className="none">{s.phase === "doing" ? "（手すき）" : "なし"}</p>
                  ) : (
                    <ul>
                      {list.map((t) => {
                        const waiting = t.deps.map((d) => byId.get(d)).filter((d): d is Task => !!d && d.status !== "done");
                        return (
                          <li key={t.id} className={t.id === selectedId ? "selected" : ""} onClick={() => onSelect(t.id)}>
                            <div className="wt">{t.title}</div>
                            <div className="wm">
                              {t.dueMemo && <span>⏱ {t.dueMemo}</span>}
                              {s.phase === "blocked" && <span>← {waiting.map((d) => d.title).join(", ")}</span>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
      {columns.length === 0 && <p className="empty-static">ワーカーがいません。設定から追加してください。</p>}
    </div>
  );
}
