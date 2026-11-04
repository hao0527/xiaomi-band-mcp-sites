# Data collection / read-path audit — milestone A

Date: 2026-11-04. Scope: current TypeScript source and private cached status, no new Xiaomi login or cloud requests. No personal measurements, deployment identity or private record references are included here.

## Confirmed read-path gaps

1. get_metric_records returns a normalized projection; record references are present only for sleep and sport. A caller cannot consistently request an original record for another metric.
2. projectHealth deliberately limits arrays, depth and string fields. This is appropriate for a display projection, but cannot be presented as a complete raw-data export. Unknown string fields may be stored in D1 while absent from the projection.
3. queryRecords paginates by (recorded_at, record_id), preserving stable ties. Existing endpoints have cursors, but a raw-reader must also guard against source updates between chunks of one large record.
4. syncStatus returns metric-wide date ranges plus recent logs. It does not expose date-by-metric cached coverage with empty/failed/not-checked distinctions. A completed task or a closed date cannot establish cloud-upload completeness.
5. Raw versions are retained in D1. Existing readers do not provide a general historical-version reader. This remains a separate future improvement, not a reason to rewrite raw records.

## Collection issues requiring evidence before changes

- The historical backfill is a bounded resumable plan, not proof that the entire target interval has already been fetched. Private status inspection confirmed it is still in progress. Do not reset its checkpoint to expand coverage.
- Ordinary raw requests use exact date windows and locally filter source timestamps. Boundary-bucket completeness needs a controlled overlapping-window comparison; this audit does not claim a proved missing bucket for this account.
- The step daily-report adapter has its existing parameter and pagination convention, with App-verified P0 totals. The prior sleep-report probe showed that a different aggregate request's time filtering was not established. This is a reason to test each channel independently, not to rewrite the verified step adapter by analogy.
- A malformed outer timestamp can reject a page before ingestion. A malformed metric value is retained with unverified parse status by the existing persistence code. A future quarantine design should preserve unindexable source rows rather than inventing timestamps, but this audit does not establish an actual lost row.
- date_cn is the stored query bucket. Sleep/session bounds and daily-bucket timestamps have distinct meanings; cache-date coverage must not claim continuous sampling or business-date correctness for every unknown field.

## Chosen additive milestone B

1. Add a uniform opaque record_ref and source_ref to existing detail pages without changing the existing data projection or pagination.
2. Add one readonly get_raw_record tool. Return credential/identifier/location/URL-redacted source JSON in bounded, lossless text chunks, with a sanitized snapshot hash. Unknown fields, long arrays, zeros and encoded content remain intact unless explicitly redacted for privacy. Changed snapshots require restarting instead of mixing versions.
3. Extend get_sync_status with optional date range / metric parameters for cached coverage. Keep the no-argument response compatible. Report cache presence, last observed sync outcome and upload completeness separately.
4. No new health scoring, training evaluation, source fusion, ingestion reconfiguration, Xiaomi requests or schema migrations in this milestone.

## Acceptance

Synthetic regressions must demonstrate long-array/Unicode reconstruction, nested credential removal, snapshot-change detection, strict arguments, meaningful coverage states and no D1 mutations or outbound requests from all read operations. Existing P0 and sync tests must remain intact. Production checks must distinguish actual Worker/API calls from actual native MCP calls and from mock tests. Public commits must exclude personal source rows and private fixture values.
