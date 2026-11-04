# HRV field verification and native-series investigation

Release investigation: 2026-11-04. This report intentionally excludes personal measurement values, account identifiers, record references and private Site URLs.

## Implemented and verified

Five sleep-summary fields have owner-reported App mapping/unit evidence:

| Source field | App item | Unit |
|---|---|---|
| avg_hrv | 睡眠平均HRV | ms |
| max_hrv | 睡眠最高HRV | ms |
| min_hrv | 睡眠最低HRV | ms |
| hrv_base_min | 个人基准下限 | ms |
| hrv_base_max | 个人基准上限 | ms |

The evidence is limited to one owner and comparison date (2026-11-04), not a vendor specification or cross-account validation. Per-field metadata distinguishes mapping_verified, unit_verified, algorithm_verified, and record_app_reconciled. Original values are unchanged. Confidence stays source_reported; no clinical accuracy is asserted.

Other fields, including hrv_median, hrv_std, quantiles and hrv_analysis_timestamp, retain unknown units and unverified meanings. Bundle unit=null is intentional: the bundle mixes fields with different verification states and an unverified timestamp. Consult field_metadata. No RMSSD/SDNN inference is made. Zero placeholders remain flagged rather than being converted into measurements.

The private comparison is stored in the existing aggregation_policies D1 table under hrv_app_reference:<date>. The owner-only POST /api/hrv-verification accepts date plus exactly five app_values, checks them against the actual cached sleep record, and refuses a mismatch before writing. It does not rewrite raw_records, raw_versions or sleep arithmetic. Subsequent reads validate both the exact record reference and current source values; other dates are not marked App-reconciled. Comparison values and record references are not included in this repository.

## Actual native-series investigation

| Interface/source | Performed action | Actual result and boundary |
|---|---|---|
| Cached sleep raw JSON | Recursive inspection of selected cached nights, nested arrays and JSON strings | Only scalar HRV summary fields and sleep-stage items found in that window; scan not truncated. This is not a claim about all historical records. |
| /app/v1/data/get_fitness_data_by_time, key=hrv | One real bounded request | HTTP 200, empty data_list, has_more=false. Empty results do not establish that the key is recognized or device HRV is unsupported. |
| /app/v1/data/get_aggregated_fitness_data_by_time, tag=daily_report, key=sleep | One real request under legacy camel-case window parameters | HTTP 200, default-sized first page with has_more=true; time filtering was not established. Inspected first-page JSON had sleep segment details but no HRV fields. The target night and remaining pages are not established as covered. |
| /healthapp/service/gen_download_url + Xiaomi FDS | Existing workout implementation reviewed | No sleep/HRV file-reference protocol verified; no HRV file download attempted. |

The real probe used one login and two health requests, with no retry. It stopped at HRV_PROBE_PAGE_LIMIT instead of continuing historical pagination. Full sanitized upstream result objects are preserved in the separate hrv_probe_cache D1 table; unknown fields and strings remain in that raw cache. Existing health records, versions and sync/history checkpoints were unchanged. Cached diagnostic rereads do not log in or call Xiaomi again.

A later code correction uses snake-case start_time/end_time (Unix seconds) and an explicit limit=50 for future sleep-aggregate probes, following the reviewed reference implementation. This request format is tagged snake_case_seconds_v2 and is covered by synthetic tests, **not yet by a further real cloud call**. Existing legacy cached evidence is retained and not overwritten or reinterpreted as v2. No automatic re-login was performed to repeat the experiment.

No native HRV sample sequence or binary HRV object was obtained. A base64-shaped pagination next_key is a cursor, not evidence of a sensor file; the inventory excludes pagination tokens. No get_hrv_samples tool was added, and no timestamps, sample cadence, RR intervals or curve points were generated from summaries or heart rate.

## Operator-only diagnostics

These routes are not MCP tools and do not run during readonly MCP queries:

- GET /api/hrv-source-evidence?start=...&end=... : up to seven days of cached sleep structure, no cloud call. Traversal bounds and truncation are explicit; sensitive identifier/credential keys and string contents are excluded from the returned inventory.
- POST /api/hrv-cloud-probe with {date}: explicit owner-platform service intent, maximum two health requests, one login, no request retry, separate D1 cache and shared sync lease. Authentication failure, non-200 health response, rate limit, uncertain network and page limits stop the probe. A saved result prevents repeated login, including after a failed probe.

The migration 0004_hrv_probe_cache is additive and idempotent. It does not alter existing raw or normalized tables. Source authentication remains backend-only; no Secrets, cookies or signed URLs enter diagnostic responses or logs.

## Verification

- TypeScript check and full synthetic regression suite: 78 tests passed before actual deployment; repeated after final request-format and cursor-classification corrections.
- Synthetic tests cover exact-record private evidence, mismatch rejection, nested JSON traversal, unknown units, zero placeholders, one-login bounds, cache reuse, rate-limit/network stopping and unchanged sync/history checkpoints. Miniflare real outbound access is disabled.
- Actual private native MCP reads verified unit metadata, exact-record reconciliation, unchanged sleep arithmetic and correct non-reconciled state for dates without App references. Updated average HRV is also present in get_daily_summary.
- Public source/tests contain only synthetic measurements; raw evidence remains exclusively in the owner's private D1.

## Remaining work

The App curve source remains unverified. Next steps are to identify the current App's actual HRV request key/schema or a validated sleep-file reference, then make a separately bounded request with correct time semantics. Only after obtaining real timestamp/value pairs should a readonly paginated sample tool and a matching decoder be implemented. Preserve undecoded data and failure evidence; do not infer a format from workout binaries.

Reference implementations reviewed, not copied:
- https://github.com/Jenwein/mifit/blob/00b8e15711b027057d82c436c230da55849ee34d/src/mifit/domains/sleep.py
- https://github.com/Jenwein/mifit/blob/00b8e15711b027057d82c436c230da55849ee34d/notes/domain-catalog.md
- https://github.com/LilZeeCN/mi-health-exporter/blob/1dc9274a90ccc83f02cbb3706aae2a4d55c8e90a/sync_cloud.py
