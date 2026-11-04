CREATE TABLE sync_history (id INTEGER PRIMARY KEY CHECK(id=1),start_date TEXT NOT NULL,end_date TEXT NOT NULL,metric_index INTEGER NOT NULL,current_date TEXT NOT NULL,cursor TEXT,seen_json TEXT NOT NULL DEFAULT '[]',complete INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);
CREATE TABLE metric_capabilities (metric TEXT PRIMARY KEY,last_checked INTEGER NOT NULL,status TEXT NOT NULL,last_count INTEGER NOT NULL DEFAULT 0,error_code TEXT);
CREATE INDEX idx_records_date_metric ON raw_records(date_cn,metric,recorded_at);
CREATE TABLE step_references (date_cn TEXT PRIMARY KEY,app_steps INTEGER NOT NULL CHECK(app_steps>=0),saved_at INTEGER NOT NULL);
CREATE TABLE aggregation_policies (metric TEXT PRIMARY KEY,policy_json TEXT NOT NULL,verified_at INTEGER NOT NULL);
CREATE TABLE activity_details (record_ref TEXT PRIMARY KEY,status TEXT NOT NULL,raw_json TEXT,clean_json TEXT,error_code TEXT,fetched_at INTEGER);
