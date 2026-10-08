CREATE TABLE progress_replicas (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  store_json TEXT NOT NULL CHECK(json_valid(store_json)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id)
);
