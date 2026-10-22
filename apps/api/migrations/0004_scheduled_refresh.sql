ALTER TABLE feeds ADD COLUMN last_attempt_at INTEGER;

CREATE INDEX IF NOT EXISTS feeds_by_refresh_due
  ON feeds (last_attempt_at, last_fetched_at, created_at);
