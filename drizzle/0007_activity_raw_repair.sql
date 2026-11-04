CREATE TABLE IF NOT EXISTS activity_raw_repairs (
 record_ref TEXT PRIMARY KEY,
 status TEXT NOT NULL,
 audit_json TEXT NOT NULL,
 checked_at INTEGER NOT NULL
);
