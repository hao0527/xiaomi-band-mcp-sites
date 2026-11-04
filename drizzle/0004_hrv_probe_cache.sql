CREATE TABLE IF NOT EXISTS hrv_probe_cache (
 date_cn TEXT PRIMARY KEY,
 status TEXT NOT NULL,
 audit_json TEXT NOT NULL,
 raw_json TEXT NOT NULL,
 checked_at INTEGER NOT NULL
);
