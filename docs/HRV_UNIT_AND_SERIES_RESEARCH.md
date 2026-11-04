# HRV mapping and time-series investigation (draft)
Date: 2026-11-04. This branch is not deployed. No actual personal measurements, source record references, Site identifiers, or private URLs are included here.

## Mapping evidence and scope
The owner supplied an App-to-MCP comparison for one sleep date, and the existing native MCP cache read was consistent with that private comparison. Only five mappings are covered:

| Source field | App item | Unit |
|---|---|---|
| avg_hrv | 睡眠平均HRV | ms |
| max_hrv | 睡眠最高HRV | ms |
| min_hrv | 睡眠最低HRV | ms |
| hrv_base_min | 个人基准下限 | ms |
| hrv_base_max | 个人基准上限 | ms |

Mapping/unit verification and algorithm verification are separate. The source values are untouched; field confidence is source_reported, mapping_verified/unit_verified=true, algorithm_verified=false. The evidence is owner-reported App reconciliation, not an independently inspected App capture or vendor specification. It is limited to one owner/date and is not universal cross-device/account validation. Consumers of this public implementation must revalidate against their own App.

The comparison values stay out of public source/tests. The owner message is the present comparison evidence; a private D1 evidence record with per-record matching remains pending execution access. record_app_reconciled remains null so this field-mapping evidence cannot falsely reconcile every returned record.

hrv_median, hrv_std, quantiles, analysis timestamps and unknown fields retain unit=null and unverified semantics. Bundle-level unit remains null because the bundle mixes measurements and an unverified timestamp; use field_metadata for each field. No RMSSD/SDNN assertion is made. All-zero source placeholders stay intact and flagged; verified mapping does not prove that a zero is a measurement.

## What was actually checked in this phase
| Source/interface | Actual action | Result/limit |
|---|---|---|
| Existing native get_hrv_trend | Read one cached sleep date | Scalar source fields returned; no samples exposed by this reader |
| Existing native get_sleep_records | Read that cached sleep date | Normalized stages and HRV summary returned; not complete raw JSON |
| Sites D1 overview/raw_records viewer | Read schema and one bounded first page | No sleep record in that page; cannot claim complete nested JSON inspection |
| /app/v1/data/get_fitness_data_by_time key=sleep | Reviewed current Adapter and public reference implementation | Used by existing sleep sync; no new upstream call in this phase |
| /app/v1/data/get_aggregated_fitness_data_by_time tag=daily_report key=sleep | Reviewed Jenwein/mifit sleep domain implementation | Reference has segment_details; not queried for this owner in this phase |
| /app/v1/data/get_latest_fitness_data | Reviewed Jenwein/mifit catalog | Discovery candidate only; not called |
| /healthapp/service/gen_download_url and Xiaomi FDS | Reviewed existing workout-native.ts | Current implementation uses sport references, not validated sleep/HRV references; not called for HRV |

The current extractor inspects top-level HRV-named fields; nested HRV inside a differently named container can be omitted from the returned projection, while original D1 raw records remain preserved. No claim is made that the full raw sleep JSON lacks a curve.

Reference code reviewed (not copied):
- https://github.com/Jenwein/mifit/blob/00b8e15711b027057d82c436c230da55849ee34d/src/mifit/domains/sleep.py
- https://github.com/Jenwein/mifit/blob/00b8e15711b027057d82c436c230da55849ee34d/notes/domain-catalog.md
- https://github.com/LilZeeCN/mi-health-exporter/blob/1dc9274a90ccc83f02cbb3706aae2a4d55c8e90a/sync_cloud.py

No native HRV series decoder/source was verified from these reviewed files. This is not proof that Xiaomi cloud does not store the curve.

## Next bounded execution steps
1. Read cached raw sleep records by exact private record reference; inventory nested objects, arrays and encoded fields without logging identifiers or credentials.
2. Check for explicit per-point timestamp/value fields and preserve exact source paths/types/units. Do not substitute sleep stages, heart rate, analysis timestamp or a fabricated fixed cadence.
3. Inspect the sleep daily aggregate if the cache has no curve. Probe an HRV-specific key only after source/API evidence, with bounded calls and stop-on-auth/rate-limit/network-uncertainty rules.
4. If a sleep/HRV file pointer exists, validate its binding to that sleep record before downloading; do not reuse guessed sport suffix/protocol layouts. Retain raw bytes plus decoded structure and decoder version.
5. Add get_hrv_samples only after real sample shape is established: readonly cache, stable cursor, source paths, exact timestamps/values and explicit missing/placeholder status. No interpolation, smoothing, scoring or health conclusions.
6. Compare real points/time axis with the App curve where feasible. Preserve unparsed contents if only part of the structure decodes.

## Verification status
- Pure JS smoke: 29 assertions executed against the modified extractor after removal of this file's known TypeScript annotations. This checks logic only.
- Four additional Node regression tests are supplied with synthetic data only.
- TypeScript build/full Node/Miniflare suite: NOT RUN (execution environment unavailable).
- Private deployment and updated-unit native MCP regression: NOT RUN; existing private version remains unchanged.
- New Xiaomi login/cloud probes, native HRV samples and binary decoding: NOT PERFORMED.
Do not merge/deploy this draft until the full checks and scoped private evidence storage are complete.
