CREATE UNIQUE INDEX IF NOT EXISTS feeds_by_id_user ON feeds(id, user_id);

CREATE TABLE IF NOT EXISTS feed_folders (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (id, user_id)
);
CREATE INDEX IF NOT EXISTS feed_folders_by_user ON feed_folders(user_id, position, created_at);

CREATE TABLE IF NOT EXISTS feed_folder_members (
  folder_id TEXT NOT NULL,
  feed_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(folder_id, feed_id),
  FOREIGN KEY(folder_id, user_id) REFERENCES feed_folders(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY(feed_id, user_id) REFERENCES feeds(id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS feed_folder_members_by_feed ON feed_folder_members(user_id, feed_id);

CREATE TABLE IF NOT EXISTS user_lists (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description TEXT CHECK (description IS NULL OR length(description) <= 500),
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'link')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (id, user_id)
);
CREATE INDEX IF NOT EXISTS user_lists_by_user ON user_lists(user_id, position, created_at);

CREATE TABLE IF NOT EXISTS user_list_feeds (
  list_id TEXT NOT NULL,
  feed_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(list_id, feed_id),
  FOREIGN KEY(list_id, user_id) REFERENCES user_lists(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY(feed_id, user_id) REFERENCES feeds(id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS user_list_feeds_by_feed ON user_list_feeds(user_id, feed_id);

CREATE TABLE IF NOT EXISTS list_share_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  list_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY(list_id, user_id) REFERENCES user_lists(id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS list_share_tokens_active ON list_share_tokens(token_hash, active);

DELETE FROM entry_states
WHERE NOT EXISTS (
  SELECT 1 FROM feed_entries e
  JOIN feeds f ON f.id = e.feed_id AND f.user_id = e.user_id
  WHERE e.id = entry_states.entry_id AND e.user_id = entry_states.user_id
);

CREATE TRIGGER IF NOT EXISTS delete_entry_state_with_entry
AFTER DELETE ON feed_entries
BEGIN
  DELETE FROM entry_states WHERE entry_id = OLD.id AND user_id = OLD.user_id;
END;

CREATE TABLE IF NOT EXISTS public_share_limits (
  token_hash TEXT PRIMARY KEY NOT NULL,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0
);
