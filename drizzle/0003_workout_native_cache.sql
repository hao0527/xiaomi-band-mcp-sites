CREATE TABLE IF NOT EXISTS workout_native_cache (
 record_ref TEXT PRIMARY KEY,
 status TEXT NOT NULL,
 evidence_json TEXT NOT NULL DEFAULT '{}',
 payload_base64 TEXT,
 checked_at INTEGER NOT NULL
);
