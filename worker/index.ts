/// <reference types="@cloudflare/workers-types" />

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  ALLOWED_LOGINS?: string;
  DEV_LOGIN?: string;
  MAX_PROJECTS_PER_USER?: string;
  MAX_TASKS_PER_PROJECT?: string;
  MAX_WORKERS_PER_PROJECT?: string;
}

interface User {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

const SESSION_COOKIE = "wbs_session";
const STATE_COOKIE = "wbs_oauth_state";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30日
const STATUSES = ["todo", "doing", "done"];

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const randomId = (bytes = 16) => {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
};

function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function cookie(name: string, value: string, maxAge: number, secure: boolean) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

const isLocal = (url: URL) => url.hostname === "localhost" || url.hostname === "127.0.0.1";

/** 利用を許可する GitHub ログイン名（小文字）。空ならだれも使えない（招待制） */
function allowList(env: Env): string[] {
  return (env.ALLOWED_LOGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
}
const allowed = (env: Env, login: string) => allowList(env).includes(login.toLowerCase());

const limit = (v: string | undefined, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
};

async function createSession(env: Env, user: User, url: URL): Promise<Response> {
  await env.DB.prepare(
    `INSERT INTO users (id, login, name, avatar_url) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(id) DO UPDATE SET login = ?2, name = ?3, avatar_url = ?4`,
  )
    .bind(user.id, user.login, user.name, user.avatar_url)
    .run();
  const sid = randomId(32);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").bind(sid, user.id, now + SESSION_TTL),
  ]);
  const headers = new Headers({ location: "/" });
  const secure = url.protocol === "https:";
  headers.append("set-cookie", cookie(SESSION_COOKIE, sid, SESSION_TTL, secure));
  headers.append("set-cookie", cookie(STATE_COOKIE, "", 0, secure));
  return new Response(null, { status: 302, headers });
}

async function handleAuth(req: Request, env: Env, url: URL): Promise<Response> {
  const secure = url.protocol === "https:";

  if (url.pathname === "/auth/login") {
    // ローカル開発用: GitHub を使わずにログイン
    if (env.DEV_LOGIN && isLocal(url)) {
      const login = url.searchParams.get("as") || env.DEV_LOGIN;
      if (!allowed(env, login)) return new Response(`${login} は ALLOWED_LOGINS に含まれていません`, { status: 403 });
      const id = 900000000 + [...login].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1000000, 7);
      return createSession(env, { id, login, name: login, avatar_url: null }, url);
    }
    if (!env.GITHUB_CLIENT_ID) return new Response("GITHUB_CLIENT_ID is not configured", { status: 500 });
    const state = randomId();
    const gh = new URL("https://github.com/login/oauth/authorize");
    gh.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
    gh.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
    gh.searchParams.set("scope", "read:user");
    gh.searchParams.set("state", state);
    return new Response(null, {
      status: 302,
      headers: { location: gh.toString(), "set-cookie": cookie(STATE_COOKIE, state, 600, secure) },
    });
  }

  if (url.pathname === "/auth/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state || state !== getCookie(req, STATE_COOKIE)) {
      return new Response("Invalid OAuth state. もう一度ログインしてください。", { status: 400 });
    }
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${url.origin}/auth/callback`,
      }),
    });
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) return new Response("GitHub token exchange failed", { status: 400 });
    const userRes = await fetch("https://api.github.com/user", {
      headers: { authorization: `Bearer ${token.access_token}`, "user-agent": "simplewbs", accept: "application/vnd.github+json" },
    });
    if (!userRes.ok) return new Response("Failed to fetch GitHub user", { status: 400 });
    const gh = (await userRes.json()) as User;
    if (!allowed(env, gh.login)) return new Response(`${gh.login} はこの WBS へのログインが許可されていません`, { status: 403 });
    return createSession(env, { id: gh.id, login: gh.login, name: gh.name, avatar_url: gh.avatar_url }, url);
  }

  if (url.pathname === "/auth/logout") {
    const sid = getCookie(req, SESSION_COOKIE);
    if (sid) await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
    return new Response(null, { status: 302, headers: { location: "/", "set-cookie": cookie(SESSION_COOKIE, "", 0, secure) } });
  }

  return new Response("Not found", { status: 404 });
}

async function currentUser(req: Request, env: Env): Promise<User | null> {
  const sid = getCookie(req, SESSION_COOKIE);
  if (!sid) return null;
  const user = await env.DB.prepare(
    `SELECT u.id, u.login, u.name, u.avatar_url FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(sid, Math.floor(Date.now() / 1000))
    .first<User>();
  // ALLOWED_LOGINS から外された人は既存セッションでも使えなくする
  return user && allowed(env, user.login) ? user : null;
}

async function requireMember(env: Env, pid: string, user: User) {
  const project = await env.DB.prepare(
    `SELECT p.id, p.name, p.owner_login, p.version FROM projects p
     JOIN members m ON m.project_id = p.id WHERE p.id = ? AND m.login = ?`,
  )
    .bind(pid, user.login.toLowerCase())
    .first<{ id: string; name: string; owner_login: string; version: number }>();
  if (!project) throw new HttpError(404, "project not found");
  return project;
}

const bump = (env: Env, pid: string) => env.DB.prepare("UPDATE projects SET version = version + 1 WHERE id = ?").bind(pid);

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");

interface TaskRow {
  id: string;
  title: string;
  worker_id: string | null;
  status: string;
  due_memo: string;
  note: string;
  deps: string;
  sort: number;
}

const taskOut = (t: TaskRow) => ({
  id: t.id,
  title: t.title,
  workerId: t.worker_id,
  status: t.status,
  dueMemo: t.due_memo,
  note: t.note,
  deps: JSON.parse(t.deps) as string[],
  sort: t.sort,
});

function hasCycle(deps: Map<string, string[]>): boolean {
  const state = new Map<string, number>();
  const visit = (id: string): boolean => {
    const s = state.get(id);
    if (s === 1) return true;
    if (s === 2) return false;
    state.set(id, 1);
    for (const d of deps.get(id) ?? []) if (visit(d)) return true;
    state.set(id, 2);
    return false;
  };
  for (const id of deps.keys()) if (visit(id)) return true;
  return false;
}

async function loadProject(env: Env, pid: string) {
  const [p, workers, tasks, members] = await env.DB.batch([
    env.DB.prepare("SELECT id, name, owner_login AS ownerLogin, version FROM projects WHERE id = ?").bind(pid),
    env.DB.prepare("SELECT id, name, color, sort FROM workers WHERE project_id = ? ORDER BY sort, rowid").bind(pid),
    env.DB.prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY sort, rowid").bind(pid),
    env.DB.prepare("SELECT login FROM members WHERE project_id = ? ORDER BY login").bind(pid),
  ]);
  return {
    project: p.results[0],
    workers: workers.results,
    tasks: (tasks.results as unknown as TaskRow[]).map(taskOut),
    members: (members.results as { login: string }[]).map((m) => m.login),
  };
}

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const user = await currentUser(req, env);
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // drop "api"
  const method = req.method;

  if (parts[0] === "me") return json({ user, allowedLogins: user ? allowList(env) : [] });
  if (!user) throw new HttpError(401, "login required");

  // CSRF 対策: 状態を変更するリクエストは同一オリジンのみ
  if (method !== "GET") {
    const origin = req.headers.get("origin");
    if (origin && origin !== url.origin && !isLocal(url)) throw new HttpError(403, "bad origin");
  }
  const body = method === "GET" || method === "DELETE" ? {} : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
  const login = user.login.toLowerCase();

  if (parts[0] !== "projects") throw new HttpError(404, "not found");

  // /api/projects
  if (parts.length === 1) {
    if (method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT p.id, p.name, p.owner_login AS ownerLogin FROM projects p
         JOIN members m ON m.project_id = p.id WHERE m.login = ? ORDER BY p.created_at`,
      )
        .bind(login)
        .all();
      return json({ projects: results });
    }
    if (method === "POST") {
      const max = limit(env.MAX_PROJECTS_PER_USER, 20);
      const owned = await env.DB.prepare("SELECT COUNT(*) AS n FROM projects WHERE owner_login = ?").bind(login).first<{ n: number }>();
      if ((owned?.n ?? 0) >= max) throw new HttpError(400, `作成できるプロジェクトは ${max} 個までです`);
      const id = randomId(8);
      const name = str(body.name, 200) || "新しいプロジェクト";
      await env.DB.batch([
        env.DB.prepare("INSERT INTO projects (id, name, owner_login, created_at) VALUES (?, ?, ?, ?)").bind(id, name, login, Date.now()),
        env.DB.prepare("INSERT INTO members (project_id, login) VALUES (?, ?)").bind(id, login),
      ]);
      return json({ id, name, ownerLogin: login }, 201);
    }
  }

  const pid = parts[1];
  const project = await requireMember(env, pid, user);
  const isOwner = project.owner_login === login;

  // /api/projects/:pid
  if (parts.length === 2) {
    if (method === "GET") return json(await loadProject(env, pid));
    if (method === "PATCH") {
      await env.DB.batch([env.DB.prepare("UPDATE projects SET name = ? WHERE id = ?").bind(str(body.name, 200) || project.name, pid), bump(env, pid)]);
      return json({ ok: true });
    }
    if (method === "DELETE") {
      if (!isOwner) throw new HttpError(403, "オーナーのみ削除できます");
      await env.DB.batch(
        ["tasks", "workers", "members"].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE project_id = ?`).bind(pid)).concat(
          env.DB.prepare("DELETE FROM projects WHERE id = ?").bind(pid),
        ),
      );
      return json({ ok: true });
    }
  }

  const sub = parts[2];
  const sid = parts[3];

  if (sub === "version" && method === "GET") return json({ version: project.version });

  if (sub === "tasks" && sid) {
    if (method === "PUT") {
      const status = STATUSES.includes(body.status as string) ? (body.status as string) : "todo";
      const deps = Array.isArray(body.deps) ? [...new Set(body.deps.filter((d): d is string => typeof d === "string" && d !== sid))] : [];
      // 循環チェック
      const { results } = await env.DB.prepare("SELECT id, deps FROM tasks WHERE project_id = ?").bind(pid).all<{ id: string; deps: string }>();
      const graph = new Map(results.map((r) => [r.id, JSON.parse(r.deps) as string[]]));
      const known = new Set(graph.keys());
      const isNew = !known.has(sid);
      const validDeps = deps.filter((d) => known.has(d));
      graph.set(sid, validDeps);
      if (hasCycle(graph)) throw new HttpError(400, "依存関係が循環しています");
      const maxTasks = limit(env.MAX_TASKS_PER_PROJECT, 1000);
      if (isNew && known.size >= maxTasks) throw new HttpError(400, `1プロジェクトのタスクは ${maxTasks} 件までです`);
      const workerId = typeof body.workerId === "string" && body.workerId ? body.workerId : null;
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO tasks (id, project_id, title, worker_id, status, due_memo, note, deps, sort)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
           ON CONFLICT(id) DO UPDATE SET title = ?3, worker_id = ?4, status = ?5, due_memo = ?6, note = ?7, deps = ?8, sort = ?9
           WHERE tasks.project_id = ?2`,
        ).bind(
          sid,
          pid,
          str(body.title, 500) || "無題のタスク",
          workerId,
          status,
          str(body.dueMemo, 200),
          str(body.note, 10000),
          JSON.stringify(validDeps),
          typeof body.sort === "number" ? body.sort : 0,
        ),
        bump(env, pid),
      ]);
      return json({ ok: true });
    }
    if (method === "DELETE") {
      const { results } = await env.DB.prepare("SELECT id, deps FROM tasks WHERE project_id = ?").bind(pid).all<{ id: string; deps: string }>();
      const stmts = [env.DB.prepare("DELETE FROM tasks WHERE id = ? AND project_id = ?").bind(sid, pid), bump(env, pid)];
      for (const r of results) {
        const d = JSON.parse(r.deps) as string[];
        if (d.includes(sid)) stmts.push(env.DB.prepare("UPDATE tasks SET deps = ? WHERE id = ?").bind(JSON.stringify(d.filter((x) => x !== sid)), r.id));
      }
      await env.DB.batch(stmts);
      return json({ ok: true });
    }
  }

  if (sub === "workers" && sid) {
    if (method === "PUT") {
      const maxW = limit(env.MAX_WORKERS_PER_PROJECT, 50);
      const cnt = await env.DB.prepare("SELECT COUNT(*) AS n, SUM(id = ?) AS self FROM workers WHERE project_id = ?").bind(sid, pid).first<{ n: number; self: number | null }>();
      if (!cnt?.self && (cnt?.n ?? 0) >= maxW) throw new HttpError(400, `ワーカーは ${maxW} 人までです`);
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO workers (id, project_id, name, color, sort) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(id) DO UPDATE SET name = ?3, color = ?4, sort = ?5 WHERE workers.project_id = ?2`,
        ).bind(sid, pid, str(body.name, 100) || "ワーカー", str(body.color, 20) || "#4f7cff", typeof body.sort === "number" ? body.sort : 0),
        bump(env, pid),
      ]);
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM workers WHERE id = ? AND project_id = ?").bind(sid, pid),
        env.DB.prepare("UPDATE tasks SET worker_id = NULL WHERE worker_id = ? AND project_id = ?").bind(sid, pid),
        bump(env, pid),
      ]);
      return json({ ok: true });
    }
  }

  if (sub === "members") {
    if (method === "POST") {
      const m = str(body.login, 100).trim().replace(/^@/, "").toLowerCase();
      if (!/^[a-z0-9-]+$/.test(m)) throw new HttpError(400, "GitHub のユーザー名を入力してください");
      if (!allowed(env, m)) throw new HttpError(400, `${m} は ALLOWED_LOGINS に含まれていないため追加できません`);
      await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO members (project_id, login) VALUES (?, ?)").bind(pid, m), bump(env, pid)]);
      return json({ ok: true });
    }
    if (method === "DELETE" && sid) {
      const target = sid.toLowerCase();
      if (target === project.owner_login) throw new HttpError(400, "オーナーは外せません");
      if (!isOwner && target !== login) throw new HttpError(403, "他のメンバーを外せるのはオーナーのみです");
      await env.DB.batch([env.DB.prepare("DELETE FROM members WHERE project_id = ? AND login = ?").bind(pid, target), bump(env, pid)]);
      return json({ ok: true });
    }
  }

  // JSON インポート（全置換）
  if (sub === "import" && method === "POST") {
    const workers = Array.isArray(body.workers) ? (body.workers as Record<string, unknown>[]) : [];
    const tasks = Array.isArray(body.tasks) ? (body.tasks as Record<string, unknown>[]) : [];
    if (tasks.length > limit(env.MAX_TASKS_PER_PROJECT, 1000)) throw new HttpError(400, "タスク数が上限を超えています");
    if (workers.length > limit(env.MAX_WORKERS_PER_PROJECT, 50)) throw new HttpError(400, "ワーカー数が上限を超えています");
    const graph = new Map(tasks.map((t) => [str(t.id), (Array.isArray(t.deps) ? t.deps : []).map(String)]));
    if (hasCycle(graph)) throw new HttpError(400, "依存関係が循環しています");
    const stmts = [
      env.DB.prepare("DELETE FROM tasks WHERE project_id = ?").bind(pid),
      env.DB.prepare("DELETE FROM workers WHERE project_id = ?").bind(pid),
      bump(env, pid),
    ];
    const wid = new Map<string, string>();
    workers.forEach((w, i) => {
      const id = randomId(8);
      wid.set(str(w.id), id);
      stmts.push(
        env.DB.prepare("INSERT INTO workers (id, project_id, name, color, sort) VALUES (?, ?, ?, ?, ?)").bind(id, pid, str(w.name, 100) || "ワーカー", str(w.color, 20) || "#4f7cff", i),
      );
    });
    const tid = new Map(tasks.map((t) => [str(t.id), randomId(8)]));
    tasks.forEach((t, i) => {
      const deps = (Array.isArray(t.deps) ? t.deps : []).map((d) => tid.get(String(d))).filter(Boolean);
      stmts.push(
        env.DB.prepare(
          "INSERT INTO tasks (id, project_id, title, worker_id, status, due_memo, note, deps, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          tid.get(str(t.id)),
          pid,
          str(t.title, 500) || "無題のタスク",
          wid.get(str(t.workerId)) ?? null,
          STATUSES.includes(t.status as string) ? t.status : "todo",
          str(t.dueMemo, 200),
          str(t.note, 10000),
          JSON.stringify(deps),
          i,
        ),
      );
    });
    await env.DB.batch(stmts);
    return json({ ok: true });
  }

  throw new HttpError(404, "not found");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/auth/")) return await handleAuth(req, env, url);
      if (url.pathname.startsWith("/api/")) return await handleApi(req, env, url);
      return env.ASSETS.fetch(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "internal error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
