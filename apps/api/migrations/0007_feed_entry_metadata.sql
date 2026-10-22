ALTER TABLE feed_entries ADD COLUMN categories_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE feed_entries ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]';
