CREATE TABLE system_access (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  system_id TEXT NOT NULL,
  allowed INTEGER NOT NULL CHECK(allowed IN (0,1)),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, system_id)
);
CREATE TABLE system_access_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL REFERENCES users(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  system_id TEXT NOT NULL,
  allowed INTEGER CHECK(allowed IN (0,1)),
  created_at INTEGER NOT NULL
);
