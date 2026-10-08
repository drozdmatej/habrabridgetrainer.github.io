PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','editor','admin')),
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE auth_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE content_versions (
  version INTEGER PRIMARY KEY,
  draft_json TEXT NOT NULL CHECK(json_valid(draft_json)),
  published_json TEXT NOT NULL CHECK(json_valid(published_json)),
  action TEXT NOT NULL CHECK(action IN ('seed','save','publish','restore')),
  author_id TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE TABLE role_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL REFERENCES users(id),
  target_id TEXT NOT NULL REFERENCES users(id),
  old_role TEXT NOT NULL,
  new_role TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TRIGGER preserve_last_admin BEFORE UPDATE OF role ON users
WHEN OLD.role = 'admin' AND NEW.role != 'admin'
 AND (SELECT count(*) FROM users WHERE role = 'admin') = 1
BEGIN SELECT RAISE(ABORT, 'last_admin'); END;
