# Cached reads are independent of refresh completion

The previous MCP guidance coupled `data_analysis_allowed` and summary reads to completion of the entire two-day refresh. A timeout while rechecking yesterday could consequently make an AI refuse today's already committed sleep or heart-rate records. The data readers themselves did not require that global task to succeed.

The collection status is still truthful: a failed refresh keeps `status=failed`, its error, diagnostic, unadvanced request checkpoint and explicit recovery gate. It does not invalidate committed cache data. Tool guidance now permits cache reads before, during or after refresh, with per-field quality, sampling freshness and missing-data notes. It stops new collection after failure rather than stopping data reads.

`get_sync_progress` returns:

- `cached_reads_allowed`: cache reads are permitted while the database is available; this is not a claim that records exist or are fresh.
- `cached_records_available`: at least one record is cached in the sync window.
- `sync_failure_invalidates_cache=false` and `date_collection_status`: counts of succeeded, failed and pending metric-days for each date, plus cache presence.
- `data_analysis_allowed`: retained as a deprecated boolean alias for cache-read permission, with an explicit scope. It no longer gates medical or training analysis or asserts completeness.
- Failed refresh `next_action=stop_sync_read_committed_cache`; `failure_recovery` still requires an explicit user retry and never starts collection by itself.

`get_sync_status` and daily-summary sync metadata also explicitly allow cache reads. Daily `metric_results_scope=requested_date` distinguishes the requested day's evidence from a failure in another date. `collection_state=checked` means the listed channels were checked; source-empty results, missing data, unknown upload completeness, quarantine and field confidence retain their existing meanings. No values, source records, sleep arithmetic, step fusion or health-analysis logic are changed.

## Bounded heart-rate timeout

Repeated diagnosis identified a 20-second abort before response headers for the full-day heart-rate request. The `heart_rate` fitness request now has a 30-second ceiling, allowing more time for a slow upstream response. Other metrics, step reports, sport lists, authentication and auxiliary operations keep their existing ceilings. This is a bounded mitigation, not a guarantee of upstream availability. Request parameters, pagination, source selection, and no-retry behavior stay unchanged. Diagnostics record the actual configured 20- or 30-second ceiling and still accept saved 20-second evidence.

The trigger's 18-second loop budget remains a soft limit for starting further pages: one in-flight heart-rate request can take up to 30 seconds, after which the batch yields or stops. No uncertain request is retried automatically. Migration and cache reset are unnecessary.

## Verification

Synthetic regressions reproduce a failed yesterday refresh with today's records present; actual Miniflare Worker MCP reads still return those records without writes or outbound calls. A newly attempted heart-rate timeout remains a failed refresh with saved diagnostics, while cached reads remain permitted and no second login occurs. Other tests cover the scoped timeout, unchanged step/report ceilings, empty-cache null values and unavailable-database behavior. Real private MCP checks and any bounded cloud recovery are reported separately; no production mock data is injected.
