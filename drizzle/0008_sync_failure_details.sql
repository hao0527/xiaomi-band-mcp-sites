CREATE TABLE IF NOT EXISTS sync_failure_details (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 run_id TEXT,
 metric TEXT,
 date_cn TEXT,
 error_code TEXT NOT NULL,
 details_json TEXT NOT NULL,
 observed_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sync_failure_run ON sync_failure_details(run_id,id);
