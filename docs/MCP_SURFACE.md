# Compact MCP discovery with compatible reads

The default tools/list now advertises ten tools: trigger_sync, get_sync_progress, get_sync_status, list_available_metrics, get_metric_records, get_raw_record, get_daily_summary, get_hrv_trend, get_activity_detail and get_activity_heart_rate_samples. Only trigger_sync is a write tool. This stage changes cache reads and discovery, not collection, storage, decoding, P0 arithmetic, private access or sync checkpoints. It performs no new Xiaomi request and needs no migration.

The existing twenty names remain in a separate compatibility registry. Removing a name from discovery does not delete its dispatcher or redirect old clients to a different response. Existing detail aliases, get_weekly_report, get_steps_audit and get_activity_heart_rate_analysis keep their prior validation, response and access gate. Their old summary/statistical behavior is retained only for compatibility; no new health interpretation is added. Clients that cache an old catalog may keep displaying it until their connection/session refreshes.

## Multi-metric records

Prefer get_metric_records with metrics=[...], start_date and end_date. One to twenty-one unique configured metrics are accepted. Include both heart_rate and resting_heart_rate to replace the old combined heart reader. New metrics calls default to 200 records and compact=true. A range containing either heart metric is at most 31 days; other new metric ranges are at most 90 days. limit remains 1 through 2000. All records share the existing stable (recorded_at, record_id) pagination. Follow next_cursor with the same metric set/date range/options; a page is not the whole requested interval.

The old metric=... selector remains mutually exclusive with metrics. Its default stays 2000 records, compact=false and the former generic-reader 90-day range. Explicit compact=false on a new multi-metric call returns the original full record shape; explicit compact=true also works with an old single metric. Invalid/empty/duplicate/mixed selectors are rejected before query execution.

Compact records keep their data, raw references, source references, status, timestamps, sleep HRV bundles and sport source fields. Repeated field_metadata and optional source_field_metadata move to page-local metadata_sets. Every record has metadata_ref; resolve it in the same page and apply that metadata only to that record. Sets are deduplicated by the complete metadata content plus metric, not metric alone: two sleep records with different quality/confidence stay distinct. raw_record_tool is shared at page level. Metadata references must not be carried to a subsequent page. Source values/units are not changed, and compact mode is not a raw-data export; use get_raw_record for original preserved fields.

Synthetic example (dates/values are not private measurements):

```json
{"metrics":["heart_rate","resting_heart_rate"],"start_date":"2026-01-01","end_date":"2026-01-02","limit":200}
```

## Daily facts over a date range

get_daily_summary with date preserves the former complete single-day response. Alternatively supply start_date and end_date, without date, for at most seven inclusive Shanghai dates. The range response has days containing existing summary, step-source/reconciliation metadata, field metadata, cache quality, sync freshness and sleep HRV. Large observation/session details remain available through the detail readers.

Each day is rebuilt through the existing daily read path from the current raw cache. It does not use potentially stale daily_summary rows, rewrite that table, manufacture missing values, change App-verified step selection or generate a weekly narrative. The old get_weekly_report remains callable and retains its old stored-summary semantics for compatibility. Empty data remains null/unknown, not zero; cloud upload completeness remains unknown. No health scoring, recommendations or training evaluation is added.

```json
{"start_date":"2026-01-01","end_date":"2026-01-07"}
```

## Validation boundaries

Synthetic regressions check the exact discovery set, all ten hidden legacy names, old default shapes, heart/resting replacement, multi-metric pagination, metadata reconstruction including differing confidence, unknown raw fields, P0 step/HRV metadata, seven-day bounds, no writes and no outbound access. Worker HTTP tests preserve the platform identity gate and no-store reads. Native MCP and private deployed checks are recorded separately; a successful local RPC call is not substituted for a real native call or a new Xiaomi cloud test.

## Deployed/native verification, 2026-11-04

- Private and deployment-neutral public checkouts both passed typecheck and the full 128-test synthetic suite. All runtime source files and the built Worker match. The exact ten-name discovery set is verified through the real local Worker HTTP route; all old dispatchers retain their prior behavior.
- Published v25 to the existing owner-private Site without migration or permission changes. Actual native calls accepted metrics, compact output, pagination and three-day/seven-day daily ranges. Compact sleep and combined-heart records reconstructed to the same returned records as old native aliases; the cursor was preserved, and the next compact page had no repeated references.
- Sampled daily range facts, step policy and HRV metadata matched the unchanged single-date native reader. The five previously verified HRV summary units remained ms. A compact reference successfully read its preserved raw source. These are private cache reads, not new Xiaomi cloud validation.
- Native cache counts, source-version count, exposed live/history checkpoint state and quarantine status matched before/after. No new cloud sync, login, bulk repair, simulated production record or health interpretation was introduced.
- This host session still advertises its cached old twenty-name catalog. A fresh hosted tools/list was not independently retrieved: ordinary Site service-bearer access to /mcp returned 401. That bearer was not used to impersonate a native MCP identity, and the access gate was not weakened. Production code provenance and new native call behavior are verified; the host's refreshed ten-name display remains a connection/session refresh check. Existing cached names continue to work in this session.
- Public commits contain only code, synthetic fixtures and technical documentation. Private source values, raw responses, references and credentials were not copied into Git or test fixtures.
