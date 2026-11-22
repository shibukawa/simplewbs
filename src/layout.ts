import type { Phase, Task, Worker } from "./types";

export interface Size {
  nodeW: number;
  nodeH: number;
  gapX: number;
  gapY: number;
  lanePad: number;
  labelW: number;
}
export const SIZE_NORMAL: Size = { nodeW: 210, nodeH: 68, gapX: 64, gapY: 12, lanePad: 14, labelW: 150 };
/** スマホ向け */
export const SIZE_COMPACT: Size = { nodeW: 156, nodeH: 64, gapX: 40, gapY: 10, lanePad: 10, labelW: 76 };

export function phaseOf(task: Task, byId: Map<string, Task>): Phase {
  if (task.status === "done") return "done";
  if (task.status === "doing") return "doing";
  return task.deps.every((d) => {
    const p = byId.get(d);
    return !p || p.status === "done";
  })
    ? "ready"
    : "blocked";
}

/** 依存の深さ（最長経路）で列を決める */
export function computeLevels(tasks: Task[]): Map<string, number> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const level = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (id: string): number => {
    const cached = level.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // 念のため循環ガード
    visiting.add(id);
    const t = byId.get(id)!;
    let l = 0;
    for (const d of t.deps) if (byId.has(d)) l = Math.max(l, visit(d) + 1);
    visiting.delete(id);
    level.set(id, l);
    return l;
  };
  tasks.forEach((t) => visit(t.id));
  return level;
}

/** id の全先行・全後続 */
export function related(tasks: Task[], id: string): { up: Set<string>; down: Set<string> } {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const children = new Map<string, string[]>();
  for (const t of tasks) for (const d of t.deps) children.set(d, [...(children.get(d) ?? []), t.id]);
  const walk = (start: string, next: (x: string) => string[]) => {
    const seen = new Set<string>();
    const stack = [...next(start)];
    while (stack.length) {
      const x = stack.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      stack.push(...next(x));
    }
    return seen;
  };
  return { up: walk(id, (x) => byId.get(x)?.deps ?? []), down: walk(id, (x) => children.get(x) ?? []) };
}

/** from → to の依存を追加すると循環するか（to から from に到達可能か） */
export function wouldCycle(tasks: Task[], from: string, to: string): boolean {
  if (from === to) return true;
  return related(tasks, from).up.has(to);
}

export interface Lane {
  key: string;
  worker: Worker | null;
  y: number;
  height: number;
}

export interface Layout {
  nodes: Map<string, { x: number; y: number }>;
  lanes: Lane[];
  width: number;
  height: number;
  columns: number;
  size: Size;
}

export function layout(tasks: Task[], workers: Worker[], groupByWorker: boolean, size: Size = SIZE_NORMAL): Layout {
  const { nodeW: NODE_W, nodeH: NODE_H, gapX: GAP_X, gapY: GAP_Y, lanePad: LANE_PAD, labelW: LABEL_W } = size;
  const left = LABEL_W + (LABEL_W < 100 ? 14 : 24);
  const levels = computeLevels(tasks);
  const columns = Math.max(0, ...levels.values()) + 1;
  const workerIds = new Set(workers.map((w) => w.id));
  const laneKey = (t: Task) => (groupByWorker ? (t.workerId && workerIds.has(t.workerId) ? t.workerId : "__none") : "__all");

  const laneDefs: { key: string; worker: Worker | null }[] = groupByWorker
    ? [...workers.map((w) => ({ key: w.id, worker: w })), { key: "__none", worker: null }]
    : [{ key: "__all", worker: null }];

  const nodes = new Map<string, { x: number; y: number }>();
  const lanes: Lane[] = [];
  let y = 0;
  // 先行タスクの y の平均でソートして交差を減らす（左の列から順に確定させる）
  const grouped = new Map<string, Task[][]>();
  for (const t of tasks) {
    const k = laneKey(t);
    if (!grouped.has(k)) grouped.set(k, Array.from({ length: columns }, () => []));
    grouped.get(k)![levels.get(t.id)!].push(t);
  }

  // 列ごとに全レーンを処理したいので、まずレーンの高さを決める
  const laneRows = new Map<string, number>();
  for (const def of laneDefs) {
    const cols = grouped.get(def.key);
    laneRows.set(def.key, cols ? Math.max(1, ...cols.map((c) => c.length)) : 1);
  }
  for (const def of laneDefs) {
    const rows = laneRows.get(def.key)!;
    const height = rows * NODE_H + (rows - 1) * GAP_Y + LANE_PAD * 2;
    lanes.push({ key: def.key, worker: def.worker, y, height });
    y += height;
  }
  const laneY = new Map(lanes.map((l) => [l.key, l.y]));

  for (let c = 0; c < columns; c++) {
    for (const lane of lanes) {
      const col = grouped.get(lane.key)?.[c] ?? [];
      const score = (t: Task) => {
        const ys = t.deps.map((d) => nodes.get(d)?.y).filter((v): v is number => v !== undefined);
        return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Number.POSITIVE_INFINITY;
      };
      col
        .map((t, i) => ({ t, s: score(t), i }))
        .sort((a, b) => (a.s === b.s ? a.t.sort - b.t.sort || a.i - b.i : a.s - b.s))
        .forEach(({ t }, i) => {
          nodes.set(t.id, {
            x: left + c * (NODE_W + GAP_X),
            y: laneY.get(lane.key)! + LANE_PAD + i * (NODE_H + GAP_Y),
          });
        });
    }
  }

  return { nodes, lanes, width: left + columns * (NODE_W + GAP_X) + 40, height: Math.max(y, 200), columns, size };
}

/** トポロジカル順（列 → sort）。ワーカー別一覧用 */
export function topoOrder(tasks: Task[]): Task[] {
  const levels = computeLevels(tasks);
  return [...tasks].sort((a, b) => levels.get(a.id)! - levels.get(b.id)! || a.sort - b.sort);
}
