ALTER TABLE feeds ADD COLUMN last_fetched_at INTEGER;
ALTER TABLE feeds ADD COLUMN last_error TEXT;

CREATE TABLE IF NOT EXISTS feed_entries (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  feed_id TEXT NOT NULL REFERENCES feeds (id) ON DELETE CASCADE,
  guid TEXT NOT NULL,
  title TEXT,
  url TEXT,
  content TEXT,
  summary TEXT,
  author TEXT,
  published_at INTEGER NOT NULL,
  inserted_at INTEGER NOT NULL,
  UNIQUE (feed_id, guid)
);

CREATE INDEX IF NOT EXISTS feed_entries_by_user_published
  ON feed_entries (user_id, published_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS feed_entries_by_feed_published
  ON feed_entries (feed_id, published_at DESC);
