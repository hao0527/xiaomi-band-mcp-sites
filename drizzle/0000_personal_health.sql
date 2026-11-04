CREATE TABLE raw_records (record_id TEXT PRIMARY KEY, metric TEXT NOT NULL, recorded_at INTEGER NOT NULL, date_cn TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'mi-fitness-cn', source_hash TEXT NOT NULL, raw_json TEXT NOT NULL, clean_json TEXT, parse_status TEXT NOT NULL, synced_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_records_metric_date ON raw_records(metric,date_cn,recorded_at);
--> statement-breakpoint
CREATE TABLE raw_versions (record_id TEXT NOT NULL, payload_hash TEXT NOT NULL, raw_json TEXT NOT NULL, synced_at INTEGER NOT NULL, PRIMARY KEY(record_id,payload_hash));
--> statement-breakpoint
CREATE TABLE daily_summary (date_cn TEXT PRIMARY KEY, steps INTEGER, steps_sample_sum INTEGER, steps_record_count INTEGER NOT NULL DEFAULT 0, step_semantics TEXT NOT NULL DEFAULT 'unverified', resting_hr REAL, sleep_minutes INTEGER, active_kcal REAL, exercise_minutes INTEGER, synced_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE sync_jobs (id INTEGER PRIMARY KEY CHECK(id=1), start_date TEXT NOT NULL, end_date TEXT NOT NULL, metric_index INTEGER NOT NULL, current_date TEXT NOT NULL, cursor TEXT, seen_json TEXT NOT NULL DEFAULT '[]', complete INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE sync_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, status TEXT NOT NULL, metric TEXT, date_cn TEXT, record_count INTEGER NOT NULL DEFAULT 0, error_code TEXT);
--> statement-breakpoint
CREATE INDEX idx_sync_logs_at ON sync_logs(at);
--> statement-breakpoint
CREATE VIEW sleep_records AS SELECT record_id,date_cn,recorded_at,clean_json,synced_at FROM raw_records WHERE metric='sleep';
--> statement-breakpoint
CREATE VIEW heart_rate_records AS SELECT record_id,date_cn,recorded_at,metric,clean_json,synced_at FROM raw_records WHERE metric IN ('heart_rate','resting_heart_rate');
--> statement-breakpoint
CREATE VIEW activity_records AS SELECT record_id,date_cn,recorded_at,clean_json,synced_at FROM raw_records WHERE metric='sport';
--> statement-breakpoint
CREATE TABLE hrv_records (record_id TEXT PRIMARY KEY,date_cn TEXT NOT NULL,recorded_at INTEGER NOT NULL,hrv_ms REAL NOT NULL CHECK(hrv_ms>0),source TEXT NOT NULL,algorithm TEXT NOT NULL,synced_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_hrv_date ON hrv_records(date_cn);
