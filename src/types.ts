export type Status = "todo" | "doing" | "done";

export interface Worker {
  id: string;
  name: string;
  color: string;
  sort: number;
}

export interface Task {
  id: string;
  title: string;
  workerId: string | null;
  status: Status;
  /** 終了目安（自由記述、任意） */
  dueMemo: string;
  note: string;
  /** 先行タスク ID */
  deps: string[];
  sort: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  ownerLogin: string;
}

export interface ProjectData {
  project: ProjectSummary & { version: number };
  workers: Worker[];
  tasks: Task[];
  members: string[];
}

export interface User {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

/** 表示用の状態: 作業中 / 完了 / 着手可（先行が全部完了）/ 待ち */
export type Phase = "doing" | "done" | "ready" | "blocked";
