# Network failure diagnosis and explicit recovery

`NETWORK_FAILURE` remains the compatible error code. It is a transport/read failure, not proof of a missing device upload or expired credentials. Data and auxiliary URL requests now attach a private diagnostic with fixed operation/stage labels, a bounded elapsed time, HTTP status only if observed, and one of `timeout`, `aborted`, `transport_error` or `response_read_error`.

Timeout is identified from the actual abort signal, not inferred from an exception message or a long elapsed time. `elapsed_ms` starts immediately before transport and includes waiting for headers and any subsequent body read. `timeout_cap_ms` records the configured ceiling: 30000 for fitness heart-rate requests and 20000 for other requests; a native-reference caller may supply a shorter remaining-budget signal. Authentication and FDS download failures retain their existing separately scoped diagnostics. No arbitrary exception message, stack, URL, header, cookie, signature, cursor or source response is saved here.

The additive `0008_sync_failure_details` migration adds only a diagnostic table and index. Health records, versions, live/history checkpoints and existing cache states are preserved. At most the latest 1000 diagnostics are retained. Old migrations are immutable. New Worker code is deployed after the hosted migration.

`get_sync_progress.last_request_failure` reads the latest saved diagnostic for that task. `is_current_failure` distinguishes the active failure from retained evidence after a later successful continuation. Legacy failures without a saved diagnostic remain unknown: they are not retrospectively labeled as timeouts. `failure_diagnostics_available` only claims a diagnostic for the current failure.

Failure still stops the entire batch, releases its lease and preserves its cursor. A user who explicitly asks to restore a failed sync can use the returned `failure_recovery` parameters: `trigger_sync` with the same `sync_id` and `retry_failed:true`. This clears only that task's error latch and attempts one bounded continuation. An ordinary repeated call without the flag performs no new login. If the explicit attempt fails again, stop; never loop `retry_failed` or automatically retry login. Successful partial batches can continue with the same ID and without the retry flag under the original budget.

The diagnostic milestone preserves request windows, step aggregation, metric order, sample decoding, and tool count. The subsequent [cache availability repair](CACHE_READ_AVAILABILITY.md) decouples cached reads from refresh completion and adjusts only the heart-rate timeout ceiling. It adds no health scoring. Diagnostic reads remain cache-only. Synthetic tests cover safe timeout/read classification, one-login failure stopping, same-ID explicit recovery through workout ingestion, cache-only Worker reads, legacy unknown errors and additive migration. Real cloud recovery, if performed, is reported separately with its dates and budget.


## Web and MCP failure consistency

The default web `/api/sync` path and the MCP live-only path now latch live-run failures identically. The failed run keeps its ID, date/metric cursor and saved diagnostic; `get_sync_progress` reports `failed`, the current error and explicit recovery parameters. The web error response includes that same progress when it belongs to the failed live run. Repeating ordinary sync performs no new login and does not replace the original diagnostic timestamp.

The dashboard labels its button “恢复失败同步” for a failed run. Clicking it calls the existing `/api/mcp-trigger-sync` endpoint once with the same ID and `retry_failed:true`. A successful partial batch can be continued normally; a second failure stops again. History backfill errors stay in sync logs and do not overwrite a completed live task's status or attach a history diagnostic to its live run ID. No timeout, automatic retry, credential storage, database schema or health-data behavior changes.

## Request transfer diagnostics v2

New data and native-reference requests emit fixed, structured `xiaomi_cloud_request` events for `started`, `headers_received` and one terminal transfer phase (`body_received`, `network_failure`, `http_error` or `body_error`). Failure phases use error-level Worker logs even when the outer MCP request returns HTTP 200. Successful transfers use info-level logs for comparison; `body_received` means the response stream was received, not that decryption, the business result or the data schema succeeded.

Each request has a locally generated UUID `request_id`, reused by its events and durable failure details. A `xiaomi_sync_request_failed` error event links the diagnostic request ID with the live `sync_id`, metric, date and failure timestamp. Worker logs also retain their own invocation IDs. Log retention follows the hosting platform; failed live-request evidence continues to use the existing D1 diagnostic table, retaining its most recent 1000 entries independently of Worker log retention. No new table or migration is needed.

| Field | Meaning |
| --- | --- |
| `diagnostic_version` | `2` on newly instrumented requests; absent on legacy records. |
| `headers_elapsed_ms` | Time from request start until response headers became available; null if none were observed. |
| `body_elapsed_ms` | Time since headers became available; null before headers. |
| `first_byte_elapsed_ms` | Time since request start when the reader first observed a nonempty chunk; null if none. |
| `last_chunk_elapsed_ms` | Time since request start of the last observed nonempty chunk; null if none. |
| `body_idle_ms` | Time since the last chunk, or since headers when no chunk arrived; null before headers. |
| `body_bytes_received` | Bytes observed in the Fetch response stream, including partial data before failure. These are not a wire-byte or Content-Length measurement. |
| `body_chunks_received` | Nonempty reader chunks, not TCP packet counts. |
| `body_complete` | True only after the stream ended; empty completed streams still have zero bytes and null first/last chunk times. |

All timing values refer to local observations. `elapsed_ms` remains total request elapsed time, including both header and body phases. `timeout_cap_ms` retains its original configured ceiling; native-reference calls may use a shorter remaining-budget signal. Unknown legacy phase timings remain absent rather than being filled with invented zeros.

Diagnostics only inspect trusted abort state, fixed operation/metric labels, HTTP status, elapsed times and byte counts. They never log credentials, signatures, cookies, raw headers, full URLs, request/response contents, cursor values or exception messages. Readers reapply the allowlist before exposing persisted details. Logging failures are swallowed so diagnostics cannot alter network results. Request windows, timeouts, retries, authentication and checkpoint semantics remain unchanged.

Tests simulate pre-header timeout, a body with no first byte, a partially received body that stalls, successful multi-chunk and empty responses, native-reference failures, malformed diagnostic fields, non-disclosure sentinels and logger failure. Integration tests verify that extended evidence persists and is read unchanged through the actual Worker MCP route without performing new cloud requests.

## One retry for recent step pages

Recent web and MCP syncs retry a daily step page once if the first request reaches its 8-second response-header limit. The first request is canceled locally. After 500 ms, the worker signs the same date and cursor with a fresh nonce and sends it using the same session. Both transfers and the delay share one 20-second deadline. Receiving headers clears the first attempt's 8-second timer so the body can still use the remaining time.

Other metrics, step aggregates, history backfill and operator verification use their existing request policies. There is no retry after receiving headers, an authentication or rate-limit response, or a transport failure that did not exhaust the first header timer. A second failure uses the existing explicit recovery path and preserves the page checkpoint. Only a successfully returned page can advance the cursor and be committed.

For an eligible request, the existing transfer logs include `retry.attempt`. The first attempt includes `retry.headers_timeout_ms` and the second includes `retry.retry_of_request_id`, linking it to the initial failure. If the second transfer fails at the network layer, that link is also retained in the durable failure diagnostic. `timeout_cap_ms` remains the total configured budget and `elapsed_ms` measures the individual transfer attempt.
