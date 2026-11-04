CREATE TABLE raw_records (record_id TEXT PRIMARY KEY, metric TEXT NOT NULL, recorded_at INTEGER NOT NULL, date_cn TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'mi-fitness-cn', source_hash TEXT NOT NULL, raw_json TEXT NOT NULL, clean_json TEXT, parse_status TEXT NOT NULL, synced_at INTEGER NOT NULL);
CREATE INDEX idx_records_metric_date ON raw_records(metric,date_cn,recorded_at);
CREATE TABLE raw_versions (record_id TEXT NOT NULL, payload_hash TEXT NOT NULL, raw_json TEXT NOT NULL, synced_at INTEGER NOT NULL, PRIMARY KEY(record_id,payload_hash));
CREATE TABLE daily_summary (date_cn TEXT PRIMARY KEY, steps INTEGER, steps_sample_sum INTEGER, steps_record_count INTEGER NOT NULL DEFAULT 0, step_semantics TEXT NOT NULL DEFAULT 'unverified', resting_hr REAL, sleep_minutes INTEGER, active_kcal REAL, exercise_minutes INTEGER, synced_at INTEGER NOT NULL);
CREATE TABLE sync_jobs (id INTEGER PRIMARY KEY CHECK(id=1), start_date TEXT NOT NULL, end_date TEXT NOT NULL, metric_index INTEGER NOT NULL, current_date TEXT NOT NULL, cursor TEXT, seen_json TEXT NOT NULL DEFAULT '[]', complete INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
CREATE TABLE sync_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, status TEXT NOT NULL, metric TEXT, date_cn TEXT, record_count INTEGER NOT NULL DEFAULT 0, error_code TEXT);
CREATE INDEX idx_sync_logs_at ON sync_logs(at);
CREATE VIEW sleep_records AS SELECT record_id,date_cn,recorded_at,clean_json,synced_at FROM raw_records WHERE metric='sleep';
CREATE VIEW heart_rate_records AS SELECT record_id,date_cn,recorded_at,metric,clean_json,synced_at FROM raw_records WHERE metric IN ('heart_rate','resting_heart_rate');
CREATE VIEW activity_records AS SELECT record_id,date_cn,recorded_at,clean_json,synced_at FROM raw_records WHERE metric='sport';
CREATE TABLE hrv_records (record_id TEXT PRIMARY KEY,date_cn TEXT NOT NULL,recorded_at INTEGER NOT NULL,hrv_ms REAL NOT NULL CHECK(hrv_ms>0),source TEXT NOT NULL,algorithm TEXT NOT NULL,synced_at INTEGER NOT NULL);
CREATE INDEX idx_hrv_date ON hrv_records(date_cn);
CREATE TABLE sync_history (id INTEGER PRIMARY KEY CHECK(id=1),start_date TEXT NOT NULL,end_date TEXT NOT NULL,metric_index INTEGER NOT NULL,current_date TEXT NOT NULL,cursor TEXT,seen_json TEXT NOT NULL DEFAULT '[]',complete INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);
CREATE TABLE metric_capabilities (metric TEXT PRIMARY KEY,last_checked INTEGER NOT NULL,status TEXT NOT NULL,last_count INTEGER NOT NULL DEFAULT 0,error_code TEXT);
CREATE INDEX idx_records_date_metric ON raw_records(date_cn,metric,recorded_at);
CREATE TABLE step_references (date_cn TEXT PRIMARY KEY,app_steps INTEGER NOT NULL CHECK(app_steps>=0),saved_at INTEGER NOT NULL);
CREATE TABLE aggregation_policies (metric TEXT PRIMARY KEY,policy_json TEXT NOT NULL,verified_at INTEGER NOT NULL);
CREATE TABLE activity_details (record_ref TEXT PRIMARY KEY,status TEXT NOT NULL,raw_json TEXT,clean_json TEXT,error_code TEXT,fetched_at INTEGER);

ALTER TABLE sync_jobs ADD COLUMN run_id TEXT;
ALTER TABLE sync_jobs ADD COLUMN run_started_at INTEGER;
ALTER TABLE sync_jobs ADD COLUMN run_error_code TEXT;
CREATE TABLE IF NOT EXISTS workout_native_cache (
 record_ref TEXT PRIMARY KEY,
 status TEXT NOT NULL,
 evidence_json TEXT NOT NULL DEFAULT '{}',
 payload_base64 TEXT,
 checked_at INTEGER NOT NULL
);
