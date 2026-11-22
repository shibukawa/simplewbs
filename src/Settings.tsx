import { useRef, useState } from "react";
import { newId } from "./api";
import type { ProjectData, Task, User, Worker } from "./types";

const PALETTE = ["#4f7cff", "#22a06b", "#e5793a", "#c2459c", "#8a63d2", "#1f9bb5", "#c9a227", "#d64545"];

interface Props {
  data: ProjectData;
  me: User;
  allowedLogins: string[];
  onClose: () => void;
  onRename: (name: string) => void;
  onPutWorker: (w: Worker) => void;
  onDeleteWorker: (id: string) => void;
  onAddMember: (login: string) => void;
  onRemoveMember: (login: string) => void;
  onImport: (d: { workers: Worker[]; tasks: Task[] }) => void;
  onDeleteProject: () => void;
}

export function Settings(p: Props) {
  const { data } = p;
  const [name, setName] = useState(data.project.name);
  const [member, setMember] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const isOwner = data.project.ownerLogin === p.me.login.toLowerCase();
  const invitable = p.allowedLogins.filter((l) => !data.members.includes(l));

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ name: data.project.name, workers: data.workers, tasks: data.tasks }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${data.project.name}.wbs.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="modal-back" onClick={p.onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <h2>プロジェクト設定</h2>
          <button className="icon" onClick={p.onClose}>
            ×
          </button>
        </div>

        <label>プロジェクト名</label>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== data.project.name && p.onRename(name)} />

        <label>ワーカー</label>
        <ul className="worker-edit">
          {data.workers.map((w, i) => (
            <li key={w.id}>
              <input type="color" value={w.color} onChange={(e) => p.onPutWorker({ ...w, color: e.target.value })} />
              <input defaultValue={w.name} onBlur={(e) => e.target.value !== w.name && p.onPutWorker({ ...w, name: e.target.value })} />
              <button className="icon" disabled={i === 0} title="上へ" onClick={() => {
                const arr = [...data.workers];
                [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
                arr.forEach((x, j) => x.sort !== j && p.onPutWorker({ ...x, sort: j }));
              }}>↑</button>
              <button
                className="icon"
                title="削除"
                onClick={() => confirm(`ワーカー「${w.name}」を削除しますか？（担当タスクは未割当になります）`) && p.onDeleteWorker(w.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <button
          onClick={() => {
            const maxSort = Math.max(0, ...data.workers.map((w) => w.sort));
            p.onPutWorker({ id: newId(), name: `ワーカー${data.workers.length + 1}`, color: PALETTE[data.workers.length % PALETTE.length], sort: maxSort + 1 });
          }}
        >
          ＋ ワーカーを追加
        </button>

        <label>共有メンバー（GitHub ユーザー名）</label>
        <ul className="members">
          {data.members.map((m) => (
            <li key={m}>
              @{m} {m === data.project.ownerLogin && <small>(オーナー)</small>}
              {m !== data.project.ownerLogin && (isOwner || m === p.me.login.toLowerCase()) && (
                <button className="icon" onClick={() => confirm(`@${m} を外しますか？`) && p.onRemoveMember(m)}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
        {invitable.length > 0 ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (member) p.onAddMember(member);
              setMember("");
            }}
          >
            <select value={member} onChange={(e) => setMember(e.target.value)}>
              <option value="">追加するユーザーを選択…</option>
              {invitable.map((l) => (
                <option key={l} value={l}>
                  @{l}
                </option>
              ))}
            </select>
            <button type="submit" disabled={!member}>追加</button>
          </form>
        ) : (
          <p className="hint">追加できるのはサーバーの ALLOWED_LOGINS に登録されたユーザーだけです。</p>
        )}

        <label>データ</label>
        <div className="row">
          <button onClick={exportJson}>JSON エクスポート</button>
          <button onClick={() => fileRef.current?.click()}>JSON インポート（全置換）</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              try {
                const d = JSON.parse(await f.text());
                if (confirm("現在のタスクとワーカーをすべて置き換えます。よろしいですか？")) p.onImport({ workers: d.workers ?? [], tasks: d.tasks ?? [] });
              } catch {
                alert("JSON を読み込めませんでした");
              }
            }}
          />
        </div>

        {isOwner && (
          <div className="panel-foot">
            <button className="danger" onClick={() => confirm(`プロジェクト「${data.project.name}」を完全に削除しますか？`) && p.onDeleteProject()}>
              プロジェクトを削除
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
