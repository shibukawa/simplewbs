import { useMemo, useRef, useState } from "react";
import { LABEL_W, NODE_H, NODE_W, layout, phaseOf, related } from "./layout";
import type { Phase, Task, Worker } from "./types";

export const PHASE_LABEL: Record<Phase, string> = { doing: "作業中", done: "完了", ready: "着手可", blocked: "待ち" };

interface Props {
  tasks: Task[];
  allTasks: Task[];
  workers: Worker[];
  groupByWorker: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onLink: (from: string, to: string) => void;
  onUnlink: (from: string, to: string) => void;
  onCycleStatus: (id: string) => void;
  onAddInLane: (workerId: string | null) => void;
}

export function Graph(props: Props) {
  const { tasks, allTasks, workers, groupByWorker, selectedId } = props;
  const L = useMemo(() => layout(tasks, workers, groupByWorker), [tasks, workers, groupByWorker]);
  const byId = useMemo(() => new Map(allTasks.map((t) => [t.id, t])), [allTasks]);
  const workerById = useMemo(() => new Map(workers.map((w) => [w.id, w])), [workers]);
  const rel = useMemo(() => (selectedId ? related(tasks, selectedId) : null), [tasks, selectedId]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: string; x: number; y: number } | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left + wrapRef.current!.scrollLeft, y: e.clientY - r.top + wrapRef.current!.scrollTop };
  };

  const startLink = (e: React.PointerEvent, from: string) => {
    e.stopPropagation();
    e.preventDefault();
    setDrag({ from, ...toLocal(e) });
    const move = (ev: PointerEvent) => setDrag((d) => (d ? { ...d, ...toLocal(ev) } : d));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-task-id]");
      const to = el?.getAttribute("data-task-id");
      if (to && to !== from) props.onLink(from, to);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const isDim = (id: string) => rel !== null && id !== selectedId && !rel.up.has(id) && !rel.down.has(id);

  const edges: { from: string; to: string; d: string; key: string; active: boolean; done: boolean }[] = [];
  for (const t of tasks) {
    const b = L.nodes.get(t.id);
    if (!b) continue;
    for (const dep of t.deps) {
      const a = L.nodes.get(dep);
      if (!a) continue;
      const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
      const dx = Math.max(30, (x2 - x1) / 2);
      // 列を飛ばす水平に近い線は途中のノードを貫通しないよう、行の上の隙間を通す
      const skips = x2 - x1 > NODE_W + 80 && Math.abs(y2 - y1) < NODE_H;
      const ym = Math.min(a.y, b.y) - 7;
      const d = skips
        ? `M${x1},${y1} C${x1 + 30},${y1} ${x1 + 30},${ym} ${x1 + 60},${ym} L${x2 - 60},${ym} C${x2 - 30},${ym} ${x2 - 30},${y2} ${x2},${y2}`
        : `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
      const active =
        rel !== null &&
        ((dep === selectedId || rel.up.has(dep)) && (t.id === selectedId || rel.up.has(t.id)) ||
          (dep === selectedId || rel.down.has(dep)) && (t.id === selectedId || rel.down.has(t.id)));
      edges.push({
        from: dep,
        to: t.id,
        key: `${dep}>${t.id}`,
        d,
        active,
        done: byId.get(dep)?.status === "done",
      });
    }
  }

  const dragFrom = drag ? L.nodes.get(drag.from) : null;

  return (
    <div className="graph" ref={wrapRef} onClick={() => props.onSelect(null)}>
      <div className="graph-canvas" style={{ width: L.width, height: L.height }}>
        {L.lanes.map((lane, i) => (
          <div
            key={lane.key}
            className={`lane ${i % 2 ? "odd" : ""}`}
            style={{ top: lane.y, height: lane.height, ["--lane" as string]: lane.worker?.color ?? "var(--muted)" }}
          >
            <div className="lane-label" style={{ width: LABEL_W }}>
              {groupByWorker ? (
                <>
                  <span className="dot" />
                  <span className="lane-name">{lane.worker?.name ?? "未割当"}</span>
                  <span className="lane-count">
                    {(() => {
                      const ts = allTasks.filter((t) => (lane.worker ? t.workerId === lane.worker.id : !t.workerId || !workerById.has(t.workerId)));
                      const doing = ts.filter((t) => t.status === "doing").length;
                      const rest = ts.filter((t) => t.status !== "done").length;
                      return doing ? `作業中 ${doing} / 残 ${rest}` : rest ? `手すき / 残 ${rest}` : "手すき";
                    })()}
                  </span>
                </>
              ) : (
                <span className="lane-name">すべて</span>
              )}
              <button
                className="lane-add"
                title="このレーンにタスクを追加"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onAddInLane(lane.worker?.id ?? null);
                }}
              >
                ＋
              </button>
            </div>
          </div>
        ))}

        <svg className="edges" width={L.width} height={L.height}>
          <defs>
            {["normal", "active", "done", "hover"].map((k) => (
              <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className={`arrow-${k}`} />
              </marker>
            ))}
          </defs>
          {edges.map((e) => {
            const kind = hoverEdge === e.key ? "hover" : e.active ? "active" : e.done ? "done" : "normal";
            const dim = rel !== null && !e.active;
            return (
              <g key={e.key}>
                <path d={e.d} className={`edge edge-${kind} ${dim ? "dim" : ""}`} markerEnd={`url(#arrow-${kind})`} />
                <path
                  d={e.d}
                  className="edge-hit"
                  onMouseEnter={() => setHoverEdge(e.key)}
                  onMouseLeave={() => setHoverEdge(null)}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    const a = byId.get(e.from)?.title, b = byId.get(e.to)?.title;
                    if (confirm(`依存「${a} → ${b}」を削除しますか？`)) props.onUnlink(e.from, e.to);
                  }}
                >
                  <title>クリックで依存を削除</title>
                </path>
              </g>
            );
          })}
          {drag && dragFrom && (
            <path
              className="edge edge-active"
              d={`M${dragFrom.x + NODE_W},${dragFrom.y + NODE_H / 2} L${drag.x},${drag.y}`}
              markerEnd="url(#arrow-active)"
            />
          )}
        </svg>

        {tasks.map((t) => {
          const p = L.nodes.get(t.id);
          if (!p) return null;
          const phase = phaseOf(t, byId);
          const w = t.workerId ? workerById.get(t.workerId) : undefined;
          return (
            <div
              key={t.id}
              data-task-id={t.id}
              className={`node phase-${phase} ${t.id === selectedId ? "selected" : ""} ${isDim(t.id) ? "dim" : ""} ${drag ? "linking" : ""}`}
              style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H, ["--w" as string]: w?.color ?? "var(--muted)" }}
              onClick={(e) => {
                e.stopPropagation();
                if ((e.shiftKey || e.metaKey || e.ctrlKey) && selectedId && selectedId !== t.id) props.onLink(selectedId, t.id);
                else props.onSelect(t.id);
              }}
            >
              <div className="node-title" title={t.title}>
                {t.title}
              </div>
              <div className="node-meta">
                <button
                  className={`badge badge-${phase}`}
                  title="クリックで状態を切り替え（未着手→作業中→完了）"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onCycleStatus(t.id);
                  }}
                >
                  {PHASE_LABEL[phase]}
                </button>
                {!groupByWorker && w && <span className="who">{w.name}</span>}
                {t.dueMemo && <span className="due" title="終了目安">⏱ {t.dueMemo}</span>}
              </div>
              <div className="handle" title="ドラッグして後続タスクにつなぐ" onPointerDown={(e) => startLink(e, t.id)} onClick={(e) => e.stopPropagation()} />
            </div>
          );
        })}

        {tasks.length === 0 && <div className="empty">タスクがありません。「＋ タスク」から追加してください。</div>}
      </div>
    </div>
  );
}
