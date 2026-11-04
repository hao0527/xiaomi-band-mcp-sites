CREATE TABLE IF NOT EXISTS collection_window_audits (
 audit_id TEXT PRIMARY KEY,
 status TEXT NOT NULL,
 audit_json TEXT NOT NULL,
 raw_json TEXT NOT NULL,
 checked_at INTEGER NOT NULL
);
