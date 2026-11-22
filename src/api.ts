import type { ProjectData, ProjectSummary, Task, User, Worker } from "./types";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  me: () => call<{ user: User | null; allowedLogins: string[] }>("GET", "/me"),
  listProjects: () => call<{ projects: ProjectSummary[] }>("GET", "/projects"),
  createProject: (name: string) => call<ProjectSummary>("POST", "/projects", { name }),
  getProject: (pid: string) => call<ProjectData>("GET", `/projects/${pid}`),
  version: (pid: string) => call<{ version: number }>("GET", `/projects/${pid}/version`),
  renameProject: (pid: string, name: string) => call("PATCH", `/projects/${pid}`, { name }),
  deleteProject: (pid: string) => call("DELETE", `/projects/${pid}`),
  putTask: (pid: string, t: Task) => call("PUT", `/projects/${pid}/tasks/${t.id}`, t),
  deleteTask: (pid: string, id: string) => call("DELETE", `/projects/${pid}/tasks/${id}`),
  putWorker: (pid: string, w: Worker) => call("PUT", `/projects/${pid}/workers/${w.id}`, w),
  deleteWorker: (pid: string, id: string) => call("DELETE", `/projects/${pid}/workers/${id}`),
  addMember: (pid: string, login: string) => call("POST", `/projects/${pid}/members`, { login }),
  removeMember: (pid: string, login: string) => call("DELETE", `/projects/${pid}/members/${encodeURIComponent(login)}`),
  importData: (pid: string, data: { workers: Worker[]; tasks: Task[] }) => call("POST", `/projects/${pid}/import`, data),
};

export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
