CREATE TABLE users (
  id INTEGER PRIMARY KEY,          -- GitHub user id
  login TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_login TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- GitHub ログイン名（小文字）でメンバー管理。オーナーも含む
CREATE TABLE members (
  project_id TEXT NOT NULL,
  login TEXT NOT NULL,
  PRIMARY KEY (project_id, login)
);
CREATE INDEX members_login ON members(login);

CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  sort REAL NOT NULL DEFAULT 0
);
CREATE INDEX workers_project ON workers(project_id);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  worker_id TEXT,
  status TEXT NOT NULL DEFAULT 'todo',  -- todo | doing | done
  due_memo TEXT NOT NULL DEFAULT '',     -- 終了目安（自由記述・任意）
  note TEXT NOT NULL DEFAULT '',
  deps TEXT NOT NULL DEFAULT '[]',       -- 先行タスク ID の JSON 配列
  sort REAL NOT NULL DEFAULT 0
);
CREATE INDEX tasks_project ON tasks(project_id);
