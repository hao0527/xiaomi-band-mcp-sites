# Explicit single-record operational raw repair

Legacy projected caches with raw_json=NULL are a known preservation boundary. They do not prove that the current collector drops new operational responses. Ordinary new responses already use the full redacted storage/version path. A later refetch stores the current cloud response; it cannot reconstruct the exact historical response that the old collector discarded.

This patch adds an operator-only, bounded repair for one explicitly selected cached legacy sport reference. It does not add an MCP tool, alter tools/list, reset caches, download native files or move live/history checkpoints. Ordinary new fetch and manual repair share the existing payload construction and complete source/version persistence. The existing display projection remains separate.

## Routes and access

- GET /api/activity-raw-repair?ref=... reads eligibility or the saved attempt; no login or writes.
- POST /api/activity-raw-repair accepts exactly {record_ref}. It requires the existing owner-private platform service boundary, explicit X-Site-Sync-Intent: refresh and no Origin. Ordinary visitor identity alone does not authorize this write. Do not substitute a Site service bearer for native MCP identity.
- Read repaired source through the unchanged get_raw_record(component=activity_operational) chunk/snapshot contract. Until a successful fetch actually supplies raw content, legacy missing-raw reporting stays truthful.

Only the selected sport reference with an old fetched/no-raw cache is eligible. A cache already containing raw is reused before any credential check or login. Other pending/unavailable workouts are left to their existing behavior. Source sid/key/time information is validated in the backend and never returned or logged.

## Request budget and stop conditions

One explicit invocation may perform one login, at most two authentication HTTP requests and one /app/v1/operate/get_sport_operational_data request; zero retries. No sport-list/fitness/aggregate request or FDS download is permitted. A 45-second budget is checked before each request. The normal persistence-enabled and hosting-cost review gates apply.

Repair shares the live/history lease and checks ownership before requests and source persistence. The additive activity_raw_repairs table records checking before login, then completed/completed_empty_response/failed. Failed, uncertain or interrupted checking state prevents automatic re-login on subsequent calls. There is no retry flag, background repair or all-workout queue in this patch. Active sync or missing initialized sync state prevents a new attempt.

Authentication failure, unexpected non-200, 429, network uncertainty, malformed response or preservation failure stops immediately. A failed attempt leaves the old operational cache, sport raw/version rows and native file cache untouched. Full successful redacted content and its version are written through the same path as future operational fetches. Unknown strings, long arrays and zeros survive; credential/identity/location/URL redactions remain explicit.

A successful source containing only nulls, empty strings/arrays/objects is preserved unchanged and marked completed_empty_response; zero and false remain source content. Empty responses are never called recovered historical fields. An empty new projection does not overwrite an existing useful legacy projection during repair. Metadata identifies that retained projection and its original fetch time; get_activity_detail adds operational_projection provenance. Raw fetch time and retained projection time must not be conflated.

## Validation contract

The synthetic suite covers selected-only writes, protected-table and checkpoint preservation, complete long source reconstruction, versions, cache reuse, the shared ordinary-new-response path, failed/interrupted claim reuse, auth/HTTP/network stopping, empty response/projection provenance, source validation, no extra MCP tools, Worker authorization and additive migration from the preceding schema. No production synthetic health record is used.

For the initial private verification, the owner-authorized target is the cached 2026-11-03 workout. The same one-login/one-detail budget applies. Actual Worker/native/cloud results are recorded separately after execution. New-record automatic ingestion remains a separate real verification until a genuinely new workout exists; a historical refetch must not be presented as that end-to-end proof.


## Structural empty-content classification

A real response exposed a distinction between raw JSON being present and containing nonempty source values. Readers recompute source_response_empty using rule no_nonempty_leaf_v1 after privacy redaction. Nulls and empty strings/containers are empty under this structural rule; numbers including zero, false and nonempty strings are not. This is not a health assessment or a device-support inference. Raw bytes/values, snapshot hashes, source timestamps and versions are not rewritten to correct older root-key-only metadata. get_activity_detail adds operational_response_empty; cache-first repair reads expose the same flag without network.
