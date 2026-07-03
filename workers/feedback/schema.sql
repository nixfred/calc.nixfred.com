CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  calculator TEXT NOT NULL,
  useful INTEGER,
  message TEXT,
  contact TEXT,
  ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_feedback_iphash_time ON feedback (ip_hash, created_at);
