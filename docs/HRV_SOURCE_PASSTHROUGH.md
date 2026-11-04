# Sleep HRV source passthrough milestone

This is a cache-only additive change. It performs no Xiaomi login or network request, no D1 migration, and no data rewrite. Existing step fusion, sleep staging, synchronization and history checkpoints remain unchanged.

## Read contract

`get_hrv_trend(start_date,end_date,cursor?,limit?)` now pages through cached sleep records (90-day maximum, 1–2000 records/page). Follow `next_cursor` until null. Existing arguments and response keys remain valid. `supported=true` means a source-field reader exists, **not** validated HRV physiology or device compatibility.

Each record includes `sleep_record_ref`, source record time, selected sleep boundaries when decodable, ingestion time, `source_fields`, individual `field_metadata`, `source_complete`, warnings and status. `unit=null`, `algorithm=null`, `validated_hrv_metric=false` are intentional. Do not assume milliseconds, RMSSD or SDNN. `recorded_at` is the sleep record timestamp, not an instantaneous HRV measurement; `hrv_analysis_timestamp` is kept raw, with its unit and event semantics unverified.

Source fields currently recognized: `avg_hrv`, `min_hrv`, `max_hrv`, `hrv_median`, `hrv_std`, `hrv_base_min`, `hrv_base_max`, `hrv_lower_quantile`, `hrv_upper_quantile`, `hrv_analysis_timestamp`. Future HRV-prefixed/suffixed fields are retained with unknown semantics. Credential and identifier keys are excluded. Original persisted raw records remain unchanged.

| Status | Meaning |
|---|---|
| source_fields_available | A positive numeric source average is available; unit/algorithm still unverified |
| zero_placeholder_unverified | All ten recognized fields are present and zero; retain zeros, do not interpret as measured HRV 0 |
| source_values_unverified | Fields exist but no positive numeric source average; retain source values |
| missing | No recognized source fields in this record; not proof of hardware non-support |
| raw_decode_failed | Raw envelope could not decode; original record remains stored |

A source `hrv_std=0` is preserved with a warning; it is not evidence of zero physiological variation. An incomplete sleep source remains explicitly incomplete. No missing values are filled, and no beat-to-beat series is generated.

`get_sleep_records` exposes the source bundle alongside normalized sleep and independently alongside the record, so sleep normalization failure does not hide decodable HRV fields. `get_daily_summary.hrv` provides the existing main sleep selection plus **all** same-date source sessions, including placeholders. No unknown-unit values are written to the older `hrv_ms` table.

Dashboard overview and heart/HRV view display source values with unit/algorithm warnings. `GET /api/hrv` is an authenticated read route with the same bounds/cursor contract; it never triggers synchronization. Trends are sleep-summary source values, not a native high-frequency HRV curve.

## Verification boundaries

Synthetic tests cover field preservation, unknown units, zero placeholders, invalid values, incomplete sleep, multiple sessions, pagination, argument validation, and unchanged database contents across read calls. Miniflare outbound access is disabled. Existing P0 tests remain unchanged. Actual private deployment and MCP validation are reported separately; a sanitized public test run does not establish compatibility for every account.
