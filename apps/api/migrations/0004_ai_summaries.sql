CREATE TABLE IF NOT EXISTS ai_summaries (
  entry_id TEXT NOT NULL REFERENCES feed_entries (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  language TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (entry_id, user_id, language, model, prompt_version)
);

CREATE INDEX IF NOT EXISTS ai_summaries_by_user_created
  ON ai_summaries (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_summary_usage (
  user_id TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  PRIMARY KEY (user_id, window_start)
);
