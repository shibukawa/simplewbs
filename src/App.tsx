import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, newId } from "./api";
import { Graph } from "./Graph";
import { wouldCycle } from "./layout";
import { Settings } from "./Settings";
import { TaskPanel } from "./TaskPanel";
import { WorkerView } from "./WorkerView";
import type { ProjectData, ProjectSummary, Status, Task, User, Worker } from "./types";

const POLL_MS = 5000;
const NEXT_STATUS: Record<Status, Status> = { todo: "doing", doing: "done", done: "todo" };

const readHash = () => location.hash.match(/^#\/p\/([0-9a-f]+)/)?.[1] ?? null;

function usePref<T>(key: string, init: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s ? (JSON.parse(s) as T) : init;
    } catch {
      return init;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  }, [key, v]);
  return [v, setV] as const;
}

export default function App() {
  const [me, setMe] = useState<User | null | undefined>(undefined);
  const [allowedLogins, setAllowedLogins] = useState<string[]>([]);
  useEffect(() => {
    api
      .me()
      .then((r) => {
        setMe(r.user);
        setAllowedLogins(r.allowedLogins);
      })
      .catch(() => setMe(null));
  }, []);

  if (me === undefined) return <div className="center">読み込み中…</div>;
  if (me === null)
    return (
      <div className="center login">
        <h1>Simple WBS</h1>
        <p>タスクの前後関係と、誰が何をしているかを見るためのシンプルな WBS</p>
        <a className="btn primary" href="/auth/login">
          GitHub でログイン
        </a>
        <p className="hint">招待されたユーザーのみ利用できます</p>
      </div>
    );
  return <Main me={me} allowedLogins={allowedLogins} />;
}

function Main({ me, allowedLogins }: { me: User; allowedLogins: string[] }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [pid, setPid] = useState<string | null>(readHash());
  const [data, setData] = useState<ProjectData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = usePref<"graph" | "workers">("wbs.view", "graph");
  const [groupByWorker, setGroupByWorker] = usePref("wbs.group", true);
  const [hideDone, setHideDone] = usePref("wbs.hideDone", false);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(0);
  const dirty = useRef(false);

  const refreshProjects = useCallback(async () => {
    const { projects } = await api.listProjects();
    setProjects(projects);
    return projects;
  }, []);

  useEffect(() => {
    refreshProjects().then((ps) => {
      setPid((cur) => {
        if (cur && ps.some((p) => p.id === cur)) return cur;
        const last = localStorage.getItem("wbs.last");
        return ps.find((p) => p.id === last)?.id ?? ps[0]?.id ?? null;
      });
    });
  }, [refreshProjects]);

  useEffect(() => {
    const onHash = () => setPid(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (pid) {
      if (location.hash !== `#/p/${pid}`) history.replaceState(null, "", `#/p/${pid}`);
      localStorage.setItem("wbs.last", pid);
    }
  }, [pid]);

  const load = useCallback(async () => {
    if (!pid) return;
    try {
      const d = await api.getProject(pid);
      if (inflight.current === 0) setData(d);
    } catch (e) {
      setError(String((e as Error).message));
      setData(null);
    }
  }, [pid]);

  useEffect(() => {
    setData(null);
    setSelectedId(null);
    load();
  }, [load]);

  // 他のマシン・他のメンバーの変更を取り込むためのポーリング
  useEffect(() => {
    if (!pid) return;
    const tick = async () => {
      if (document.hidden || inflight.current > 0) return;
      try {
        const { version } = await api.version(pid);
        if (dirty.current || (data && version !== data.project.version)) {
          dirty.current = false;
          await load();
        }
      } catch {
        /* オフラインなど。次回再試行 */
      }
    };
    const t = setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", tick);
    };
  }, [pid, data, load]);

  /** 楽観的に更新してからサーバーに送る */
  const mutate = useCallback(
    async (local: (d: ProjectData) => ProjectData, remote: () => Promise<unknown>) => {
      setData((d) => (d ? local(d) : d));
      inflight.current++;
      try {
        await remote();
      } catch (e) {
        setError((e as Error).message);
        dirty.current = true;
      } finally {
        inflight.current--;
        if (inflight.current === 0) load();
      }
    },
    [load],
  );

  const putTask = (t: Task) =>
    pid &&
    mutate(
      (d) => ({ ...d, tasks: d.tasks.some((x) => x.id === t.id) ? d.tasks.map((x) => (x.id === t.id ? t : x)) : [...d.tasks, t] }),
      () => api.putTask(pid, t),
    );

  const addTask = (workerId: string | null, deps: string[] = []) => {
    if (!data) return;
    const t: Task = {
      id: newId(),
      title: "新しいタスク",
      workerId,
      status: "todo",
      dueMemo: "",
      note: "",
      deps,
      sort: Math.max(0, ...data.tasks.map((x) => x.sort)) + 1,
    };
    putTask(t);
    setSelectedId(t.id);
  };

  const link = (from: string, to: string) => {
    if (!data) return;
    const target = data.tasks.find((t) => t.id === to);
    if (!target) return;
    if (target.deps.includes(from)) {
      putTask({ ...target, deps: target.deps.filter((d) => d !== from) });
      return;
    }
    if (wouldCycle(data.tasks, from, to)) {
      setError("依存関係が循環するため追加できません");
      return;
    }
    putTask({ ...target, deps: [...target.deps, from] });
  };

  const visibleTasks = useMemo(() => (data ? (hideDone ? data.tasks.filter((t) => t.status !== "done") : data.tasks) : []), [data, hideDone]);
  const selected = data?.tasks.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  const createProject = async () => {
    const name = prompt("プロジェクト名", "新しいプロジェクト");
    if (!name) return;
    try {
      const p = await api.createProject(name);
      await refreshProjects();
      setPid(p.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doneCount = data?.tasks.filter((t) => t.status === "done").length ?? 0;

  return (
    <div className="app">
      <header>
        <strong className="logo">Simple WBS</strong>
        <select value={pid ?? ""} onChange={(e) => setPid(e.target.value || null)}>
          {projects.length === 0 && <option value="">（プロジェクトなし）</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button onClick={createProject} title="新しいプロジェクト">
          ＋
        </button>
        {data && (
          <>
            <div className="segmented">
              <button className={view === "graph" ? "on" : ""} onClick={() => setView("graph")}>
                依存グラフ
              </button>
              <button className={view === "workers" ? "on" : ""} onClick={() => setView("workers")}>
                ワーカー別
              </button>
            </div>
            {view === "graph" && (
              <label className="check">
                <input type="checkbox" checked={groupByWorker} onChange={(e) => setGroupByWorker(e.target.checked)} />
                ワーカーでレーン分け
              </label>
            )}
            <label className="check">
              <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
              完了を隠す
            </label>
            <span className="progress">
              完了 {doneCount}/{data.tasks.length}
            </span>
            <button className="primary" onClick={() => addTask(null)}>
              ＋ タスク
            </button>
            <button onClick={() => setShowSettings(true)}>設定</button>
          </>
        )}
        <span className="spacer" />
        <span className="me">
          {me.avatar_url && <img src={me.avatar_url} alt="" />}@{me.login}
        </span>
        <a className="btn" href="/auth/logout">
          ログアウト
        </a>
      </header>

      <main>
        {!pid && (
          <div className="center">
            <p>プロジェクトがありません</p>
            <button className="primary" onClick={createProject}>
              ＋ プロジェクトを作成
            </button>
          </div>
        )}
        {pid && !data && <div className="center">読み込み中…</div>}
        {data && view === "graph" && (
          <Graph
            tasks={visibleTasks}
            allTasks={data.tasks}
            workers={data.workers}
            groupByWorker={groupByWorker}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onLink={link}
            onUnlink={(from, to) => {
              const t = data.tasks.find((x) => x.id === to);
              if (t) putTask({ ...t, deps: t.deps.filter((d) => d !== from) });
            }}
            onCycleStatus={(id) => {
              const t = data.tasks.find((x) => x.id === id);
              if (t) putTask({ ...t, status: NEXT_STATUS[t.status] });
            }}
            onAddInLane={(wid) => addTask(groupByWorker ? wid : null)}
          />
        )}
        {data && view === "workers" && <WorkerView tasks={visibleTasks} workers={data.workers} selectedId={selectedId} onSelect={setSelectedId} />}
        {data && selected && (
          <TaskPanel
            key={selected.id}
            task={selected}
            tasks={data.tasks}
            workers={data.workers}
            onChange={putTask}
            onSelect={setSelectedId}
            onClose={() => setSelectedId(null)}
            onAddNext={() => addTask(selected.workerId, [selected.id])}
            onDelete={() => {
              setSelectedId(null);
              mutate(
                (d) => ({
                  ...d,
                  tasks: d.tasks.filter((t) => t.id !== selected.id).map((t) => ({ ...t, deps: t.deps.filter((x) => x !== selected.id) })),
                }),
                () => api.deleteTask(pid!, selected.id),
              );
            }}
          />
        )}
      </main>

      {view === "graph" && data && data.tasks.length > 0 && (
        <footer className="help">
          クリック: 選択（前後のつながりを強調）／ 右端の ● をドラッグ: 後続タスクへ依存を追加 ／ 選択中に Shift+クリック: 依存を追加・解除 ／ 矢印クリック: 依存を削除 ／ バッジクリック: 状態切替
        </footer>
      )}

      {showSettings && data && (
        <Settings
          data={data}
          me={me}
          allowedLogins={allowedLogins}
          onClose={() => setShowSettings(false)}
          onRename={(name) =>
            mutate(
              (d) => ({ ...d, project: { ...d.project, name } }),
              async () => {
                await api.renameProject(pid!, name);
                await refreshProjects();
              },
            )
          }
          onPutWorker={(w: Worker) =>
            mutate(
              (d) => ({
                ...d,
                workers: (d.workers.some((x) => x.id === w.id) ? d.workers.map((x) => (x.id === w.id ? w : x)) : [...d.workers, w]).sort((a, b) => a.sort - b.sort),
              }),
              () => api.putWorker(pid!, w),
            )
          }
          onDeleteWorker={(id) =>
            mutate(
              (d) => ({ ...d, workers: d.workers.filter((w) => w.id !== id), tasks: d.tasks.map((t) => (t.workerId === id ? { ...t, workerId: null } : t)) }),
              () => api.deleteWorker(pid!, id),
            )
          }
          onAddMember={(login) => mutate((d) => ({ ...d, members: [...d.members, login.toLowerCase()].sort() }), () => api.addMember(pid!, login))}
          onRemoveMember={(login) =>
            mutate(
              (d) => ({ ...d, members: d.members.filter((m) => m !== login) }),
              async () => {
                await api.removeMember(pid!, login);
                if (login === me.login.toLowerCase()) location.reload();
              },
            )
          }
          onImport={(d) => mutate((x) => x, () => api.importData(pid!, d))}
          onDeleteProject={async () => {
            await api.deleteProject(pid!);
            setShowSettings(false);
            const ps = await refreshProjects();
            setPid(ps[0]?.id ?? null);
            if (!ps.length) history.replaceState(null, "", "#");
          }}
        />
      )}

      {error && <div className="toast">{error}</div>}
    </div>
  );
}
