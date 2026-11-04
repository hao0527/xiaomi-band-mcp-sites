# Source preservation and invalid-record isolation

This stage changes storage and ingestion correctness only. Existing P0 step totals, sleep arithmetic, HRV mapping, native workout decoding and health-analysis behavior remain unchanged. No new health conclusions or MCP tools are added.

## Complete operational workout source

fetchActivityDetails now saves a privacy-redacted complete response in activity_details.raw_json before relying on the display projection. Unknown ordinary text, long arrays, encoded content and zero values survive. Existing clean_json remains the compatible limited projectHealth projection. Credential/security, device/account identity, location and URL fields are excluded using the shared raw-reader privacy filter; raw_meta_json records the preservation format, original fetch time and explicit redaction counts.

activity_detail_versions keeps distinct sanitized payload versions, deduplicated by record reference and content hash. Version insertion and current-cache update run in one D1 batch. The original sport raw_records/raw_versions are not rewritten. A projection failure does not require discarding a safely preserved source response.

get_activity_detail adds operational_raw_available, operational_raw_read and operational_raw_missing_reason. The existing readonly get_raw_record accepts component=activity_operational with the same chunk/snapshot contract. An unavailable later request does not silently update the old raw response's fetch timestamp or delete it.

Old fetched caches with raw_json=NULL return legacy_projected_cache_no_raw_response. They are not reconstructed from clean_json, and readonly queries do not log in or refetch them. This stage does not automatically reschedule all legacy caches; bounded authenticated backfill is a separate task requiring request-budget review. Real new-response persistence is verified with HTTP/Adapter mocks in this stage, not a new Xiaomi login.

Known fatal authentication/network/HTTP/retry-exhaustion errors in the detail loop now propagate instead of silently continuing into further requests. There is no retry of the login flow here. Existing request retry behavior inside the shared Adapter is otherwise unchanged and remains a separate review topic.

## Per-record envelope isolation

Adapter.page still rejects invalid response envelopes, invalid pagination, excessive page sizes and upstream failures. Only malformed individual records (invalid outer object, seconds timestamp or sid type) are separated into Page.rejected. Valid rows on the same page continue through the existing pipeline. A valid envelope with an unknown/unparsed metric value still goes to raw_records with schema_unverified, not to quarantine.

The persistence layer saves accepted records and privacy-redacted rejected source content before advancing the cursor. ingestion_quarantine uses content-derived IDs so replay does not create duplicate quarantine rows; requested_start/requested_end are request context, not invented source dates. Original invalid time values remain in the preserved JSON. If preservation fails, the checkpoint does not advance; existing UPSERTs make replay safe. The normal page/record caps and cursor-loop checks remain in force.

An invalid null/negative timestamp cannot falsely signal the end of descending daily-step pagination. Valid daily-step pagination behavior is unchanged.

## State and readonly retrieval

- page_quarantined logs carry counts and fixed SOURCE_RECORDS_QUARANTINED, never the raw source or credentials.
- get_sync_progress distinguishes partial_data from no_records and reports quarantined_observations. Replayed observations can exceed unique stored quarantine records; these are separate quantities. A completed run with quarantine is completed_with_errors.
- get_sync_status.quarantine reports total unique records and up to ten latest opaque references with explicit latest_limit. It is not a complete paginated quarantine listing.
- get_raw_record(component=ingestion_quarantine) reads those preserved records with recorded_at=null and stored_date_cn=null. It exposes the request-window context separately; it never fabricates a valid timestamp.
- Optional cached coverage reports source_records_quarantined separately from successful empty pages. Daily quality flags quarantine for the request window; all-quarantined input is quarantined_source_only, not a claimed empty upstream result.

No new readonly operation triggers collection. Raw component reads preserve the original chunk offsets, Unicode handling and snapshot-change protection. The default metric_record component stays backward compatible. Historical activity_detail_versions are stored, but a general version-reading API and a paginated quarantine catalog remain future work.

## Migration and validation

0005_source_preservation adds raw_meta_json to the existing operational cache and creates activity_detail_versions plus ingestion_quarantine. It is additive; it neither rewrites old health records nor resets sync/history checkpoints. Fresh installs and migration from the preceding schema are covered by synthetic tests.

Eight new regressions exercise mixed and all-invalid pages, quarantine replay, correct state reporting, full operational arrays/text, source-version retention, legacy-cache signaling, authentication-stop behavior, unchanged history and additive migration. The full suite is 94 tests. No real credentials or health fixtures are included in this repository.

Remaining boundaries: unreadably deep/unredactable payloads fail explicitly instead of bypassing privacy; source date/window completeness and upstream parameter semantics are not fixed by this stage. Already projected-away operational fields cannot be recovered from the old local cache. Native HRV time-series source and other workout binary versions remain unverified.


## Explicit legacy repair follow-on

A missing legacy response remains a truthful read boundary, not evidence that current new-response preservation is broken. The operator-only single-record route described in [OPERATIONAL_RAW_REPAIR.md](OPERATIONAL_RAW_REPAIR.md) can refetch the current cloud response for one selected legacy cache, with a durable attempt marker, shared lease, one-detail request budget and no automatic retry. It reuses the same preservation path as ordinary new fetches. This does not recreate a discarded past response, enable all-workout backfill or prove a future new-record automatic flow. MCP discovery remains ten tools.
