# Native workout files in ordinary sync

## Confirmed gap and bounded repair

Ordinary sync previously collected sport records and operational responses, but never called the native-file downloader. Cache-only readers consequently reported `not_checked` and used explicitly labeled daily heart-rate samples. This was a collector workflow gap, not evidence that a device had failed to upload a file.

Ordinary sync now uses the existing login session to check at most one missing native file per batch in its live Shanghai date window (today and yesterday). It processes committed metric pages first, then calls the existing `/healthapp/service/gen_download_url` protocol once and, if a stored object is returned, performs one credential-free GET to an allowed Xiaomi FDS host. It does not fetch GPS, repeat operational requests for this purpose, start another login, or sweep historical workouts.

The native phase uses the remaining batch time budget: 18 seconds for `trigger_sync`, 45 seconds for the ordinary operator sync, after the batch login. Each outbound native request also has a maximum 20-second timeout. An exhausted budget leaves the file pending for a later explicit continuation. Existing metric page caps and live/history checkpoints remain in force.

## Resumption and state

- The existing D1 sync lease covers file lookup, download and persistence. The selected-record operator action now acquires that same lease rather than merely observing whether it was occupied.
- Existing `workout_native_cache` rows are reused without network access. Stored, failed, empty and interrupted `checking` attempts are not reset or automatically retried.
- Missing reference metadata is recorded as `schema_unverified`; no timestamp, device reference or file suffix is invented.
- `get_sync_progress.native_files` and `get_sync_status.native_files` report pending, stored, `not_stored_at_check`, failed, checking and unverified counts for the live window. Metric coverage can be 100% while native files remain pending; `complete` remains false and the same `sync_id` resumes only the missing file phase.
- A metric-complete task with pending native files is not reset by the ordinary refresh timer. A new calendar-day window retains the existing rollover behavior.
- `get_activity_detail.native_curve.error_code` exposes a fixed saved reason when available. All read tools remain cache-only, and discovery still contains ten tools.
- Detail responses retain both arrays: legacy `series_source` describes `heart_rate_samples`, now explicit in `series_source_scope`. `native_curve.series_source` identifies the verified native format for `native_heart_rate_samples`, or is null for unchecked/failed/unsupported formats. This does not relabel minute samples or alter native-first selection in `get_activity_heart_rate_samples`. A recognized file with zero valid heart-rate points can have a native format source while the sample reader still correctly returns its minute fallback.

Authentication failure, 429, unexpected non-200, invalid response or uncertain network stops the batch. The native failure is durable; neither continuation nor `retry_failed` clears it or silently retries the login. A future late-upload recheck needs its own explicit, bounded design. `not_stored_at_check` only describes that response and does not establish a hardware limitation or complete cloud upload.

## File preservation and decoding

The full validated, decrypted file remains base64 in the owner's D1. Lookup URLs, object keys and account cookies are never written to evidence or logs. FDS requests omit cookies/authorization and reject redirects or unapproved hosts. Existing 2 MiB transport bounds, header checks and narrow format-8/version-4/storage-mode-0 decoder are retained.

Unknown decoder versions are preserved without guessed samples. Readers still return the explicitly labeled minute fallback when no supported native samples can be decoded. Nominal one-second file points do not prove that the optical sensor independently measured every second. No health analysis or HRV sample generation is introduced.

## Validation levels

Synthetic regressions cover same-batch sport ingestion and file download with one login, one-file budgets, live-window selection, native-only continuation, cache reuse, unsupported-file retention, missing metadata, timeout deferral, shared-lease loss, credential isolation, and immediate stopping without retry. A Miniflare Worker route test uses synthetic upstream responses only; no production health data is injected.

Deployment, actual native MCP reads and any real Xiaomi cloud request are verified separately. Real private measurements, file bytes and record references must remain outside this repository.
