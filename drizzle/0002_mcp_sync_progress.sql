ALTER TABLE sync_jobs ADD COLUMN run_id TEXT;
--> statement-breakpoint
ALTER TABLE sync_jobs ADD COLUMN run_started_at INTEGER;
--> statement-breakpoint
ALTER TABLE sync_jobs ADD COLUMN run_error_code TEXT;
