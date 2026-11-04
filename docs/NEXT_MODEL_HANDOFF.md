# Handoff template for the next higher-reasoning session

Use this as a source checklist. The owner supplies their private Site project ID and URL directly in the new conversation; those identifiers, account credentials and health evidence must not be committed here.

## Project position

Xiaomi Band MCP is a lightweight China-region Mi Fitness data collection/sync/read layer: collect fully, preserve safely and expose reliable raw data to AI. Health interpretation belongs to the consuming AI. Do not add scoring, recovery recommendations or new training-analysis logic.

Repository: https://github.com/hao0527/xiaomi-band-mcp-sites . Check the latest source-preservation PR/branch and deployed private source before assuming main contains the deployed changes. Do not discard unmerged work or recreate deleted mock/diagnostic Sites. Keep the only live data Site owner-private.

## Working behavior to preserve

- P0 App-reconciled step source selection and per-record sleep-stage arithmetic.
- Five sleep HRV summary field units with scoped owner App evidence; unknown other units and HRV algorithm. Never infer RMSSD/SDNN.
- Native workout decoder's explicitly supported format and fallback-source labels.
- trigger_sync/get_sync_progress, live/history checkpoint isolation, bounded requests and the hosting-cost review gate.
- readonly current raw JSON chunks, Unicode-safe offsets, snapshot guards and cached date-metric coverage.
- Complete sanitized future workout operational responses/versions, explicit legacy-no-raw status, and malformed-envelope quarantine.

## Read first

- docs/DATA_COLLECTION_AUDIT.md
- docs/RAW_READ_AND_COVERAGE.md
- docs/HRV_UNIT_AND_SERIES_RESEARCH.md
- docs/SOURCE_PRESERVATION.md
- src/collector/adapter.ts, src/persistence.ts, src/mcp-sync.ts
- src/activity-details.ts, src/raw-record-reader.ts, src/ingestion-quarantine.ts
- drizzle/meta/_journal.json, the actual deployed D1 schema and tests/source-preservation.test.mjs

The preceding stage passes 94 synthetic tests, including eight source-preservation regressions. It did not make a new Xiaomi cloud call. Real legacy operational caches are not retroactively complete merely because the new code is deployed. The real exercise/sleep values and private evidence remain in the owner's D1, not this repo.

## Next bounded tasks

1. Independently review time-window semantics, pagination and date ownership. Do not change verified step aggregation by analogy with another endpoint. Reproduce with HTTP mocks before any real request. An exact-window/overlapping-window comparison is needed to establish a real missing boundary bucket; code suspicion is not proof.
2. Propose a small, explicit request budget and stop conditions for real evidence. Keep Secrets in the backend; no credential reading by the assistant, no chat-pasted passwords/tokens, no browser Cookie harvesting, no auth bypass. No real probing until its scope is clear. On authentication failure, rate limit, unexpected non-200 or uncertain network, stop without automatic login retry.
3. Consider a selective, resumable legacy operational-raw backfill. Reuse caches first. Do not manufacture raw_json from clean_json, reset all cache states to pending, re-download every workout, or interfere with active sync/backfill. No new public access or paid services.
4. If warranted by real evidence, repair only the proved collection gap. Preserve original source content and source versions, maintain interface compatibility, add independent regression cases and validate in the actual Worker. Distinguish mock, deployed API, native MCP and actual Xiaomi tests.
5. Native nightly HRV points require the App's actual request/key or a validated sleep-file reference. An empty generic hrv key is not hardware non-support. Never derive the curve from averages, stages, minute heart rate or guessed cadence. Do not reuse workout binary layouts for sleep without evidence.

## Delivery

Give an audit conclusion and request budget before changing complex collection logic. Deliver small testable patches, privacy-scanned Git commits/PRs, owner-private deployment, actual validation and a concise list of remaining unknowns. Do not merge default-branch changes unless explicitly authorized. Do not present a planned or mock-tested feature as actually verified on Xiaomi cloud.
