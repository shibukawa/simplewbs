import { useEffect, useState } from "react";
import { phaseOf, wouldCycle } from "./layout";
import { PHASE_LABEL } from "./Graph";
import type { Status, Task, Worker } from "./types";

/** 入力中はサーバからの更新で上書きしない下書き state */
function useDraft(value: string, onCommit: (v: string) => void) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);
  return {
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      if (draft !== value) onCommit(draft);
    },
  };
}

interface Props {
  task: Task;
  tasks: Task[];
  workers: Worker[];
  onChange: (t: Task) => void;
  onDelete: () => void;
  onSelect: (id: string) => void;
  onAddNext: () => void;
  onClose: () => void;
}

const STATUS: { v: Status; label: string }[] = [
  { v: "todo", label: "未着手" },
  { v: "doing", label: "作業中" },
  { v: "done", label: "完了" },
];

export function TaskPanel({ task, tasks, workers, onChange, onDelete, onSelect, onAddNext, onClose }: Props) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const update = (patch: Partial<Task>) => onChange({ ...task, ...patch });
  const title = useDraft(task.title, (title) => update({ title }));
  const due = useDraft(task.dueMemo, (dueMemo) => update({ dueMemo }));
  const note = useDraft(task.note, (note) => update({ note }));
  const successors = tasks.filter((t) => t.deps.includes(task.id));
  const candidates = tasks.filter((t) => t.id !== task.id && !task.deps.includes(t.id) && !wouldCycle(tasks, t.id, task.id));
  const phase = phaseOf(task, byId);

  const taskLink = (t: Task, onRemove?: () => void) => (
    <li key={t.id}>
      <button className="link" onClick={() => onSelect(t.id)}>
        <span className={`mini-badge badge-${phaseOf(t, byId)}`}>{PHASE_LABEL[phaseOf(t, byId)]}</span>
        {t.title}
      </button>
      {onRemove && (
        <button className="icon" title="依存を外す" onClick={onRemove}>
          ×
        </button>
      )}
    </li>
  );

  return (
    <aside className="panel" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="panel-head">
        <span className={`badge badge-${phase}`}>{PHASE_LABEL[phase]}</span>
        <button className="icon" onClick={onClose} title="閉じる">
          ×
        </button>
      </div>
      <input
        className="title-input"
        {...title}
        onKeyDown={(e) => {
          // IME の変換確定の Enter では確定しない（Safari は isComposing が false になるので keyCode 229 も見る）
          if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) (e.target as HTMLInputElement).blur();
        }}
        placeholder="タスク名"
        autoFocus={task.title === "新しいタスク"}
      />

      <label>担当ワーカー</label>
      <select value={task.workerId ?? ""} onChange={(e) => update({ workerId: e.target.value || null })}>
        <option value="">（未割当）</option>
        {workers.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>

      <label>状態</label>
      <div className="segmented">
        {STATUS.map((s) => (
          <button key={s.v} className={task.status === s.v ? "on" : ""} onClick={() => update({ status: s.v })}>
            {s.label}
          </button>
        ))}
      </div>

      <label>終了目安（任意メモ）</label>
      <input {...due} placeholder="例: 12/5, 来週中, 2日くらい" />

      <label>先行タスク（これが終わったら着手）</label>
      <ul className="dep-list">
        {task.deps.map((d) => byId.get(d)).filter((t): t is Task => !!t).map((t) => taskLink(t, () => update({ deps: task.deps.filter((x) => x !== t.id) })))}
      </ul>
      {candidates.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) update({ deps: [...task.deps, e.target.value] });
          }}
        >
          <option value="">＋ 先行タスクを追加…</option>
          {candidates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      )}

      <label>後続タスク（このあとやること）</label>
      <ul className="dep-list">{successors.map((t) => taskLink(t, () => onChange({ ...t, deps: t.deps.filter((x) => x !== task.id) })))}</ul>
      <button onClick={onAddNext}>＋ 後続タスクを作成</button>

      <label>メモ</label>
      <textarea {...note} rows={6} placeholder="自由にメモ" />

      <div className="panel-foot">
        <button
          className="danger"
          onClick={() => {
            if (confirm(`「${task.title}」を削除しますか？`)) onDelete();
          }}
        >
          削除
        </button>
      </div>
    </aside>
  );
}
