CREATE TABLE IF NOT EXISTS live_sport_recheck (
 id INTEGER PRIMARY KEY CHECK(id=1),
 run_id TEXT NOT NULL,
 current_date TEXT NOT NULL,
 metric_index INTEGER NOT NULL,
 cursor TEXT,
 seen_json TEXT NOT NULL DEFAULT '[]',
 complete INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL
);
