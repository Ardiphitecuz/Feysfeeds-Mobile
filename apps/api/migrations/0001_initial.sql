CREATE TABLE IF NOT EXISTS feeds (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, url)
);

CREATE INDEX IF NOT EXISTS feeds_by_user
  ON feeds (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS entry_states (
  user_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  is_bookmarked INTEGER NOT NULL DEFAULT 0 CHECK (is_bookmarked IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, entry_id)
);

CREATE INDEX IF NOT EXISTS entry_states_by_user_read
  ON entry_states (user_id, is_read, updated_at DESC);

CREATE INDEX IF NOT EXISTS entry_states_by_user_bookmark
  ON entry_states (user_id, is_bookmarked, updated_at DESC);
