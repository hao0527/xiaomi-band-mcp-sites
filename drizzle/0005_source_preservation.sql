ALTER TABLE activity_details ADD COLUMN raw_meta_json TEXT;
CREATE TABLE IF NOT EXISTS activity_detail_versions (
 record_ref TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 raw_json TEXT NOT NULL,
 raw_meta_json TEXT NOT NULL,
 fetched_at INTEGER NOT NULL,
 PRIMARY KEY(record_ref,payload_hash)
);
CREATE TABLE IF NOT EXISTS ingestion_quarantine (
 quarantine_id TEXT PRIMARY KEY,
 metric TEXT NOT NULL,
 requested_start TEXT NOT NULL,
 requested_end TEXT NOT NULL,
 reason_code TEXT NOT NULL,
 index_in_page INTEGER NOT NULL,
 raw_json TEXT NOT NULL,
 redactions_json TEXT NOT NULL,
 first_seen_at INTEGER NOT NULL,
 last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quarantine_metric_window ON ingestion_quarantine(metric,requested_start,requested_end);
