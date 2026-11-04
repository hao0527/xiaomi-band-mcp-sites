# Collection windows: independent review and bounded validation

Review date: 2026-11-04. Baseline: source-preservation PR #3, commit 609c5f576d93800dcb610ceaf7ff1656bcd130e4. The PR was open and main was one commit behind. All collector source files in the owner-private deployed checkout matched that PR. The baseline passed 94 synthetic tests. No private measurements, identifiers, record references or Site identity belong in this document.

## Findings before implementation

| Finding | Evidence | Decision |
| --- | --- | --- |
| Ordinary fitness/sport requests use inclusive Unix-second windows and discard valid outer timestamps outside them | Code and a synthetic exact/adjacent/overlap comparison | A risk if the vendor selects buckets differently; not evidence that this account lost records. Keep parameters and filters until real comparison evidence exists. |
| A cross-midnight workout can have an outer date different from its normalized start date; sleep has a separate wake-date rule | Synthetic source example, parser/persistence/read-path review | Expose the distinction in this review; do not reassign existing buckets, rewrite the P0 sleep logic or migrate private App reconciliation. |
| Normal ingestion stores date_cn from outer time, whereas the older quality rebuild can assign normalized sleep/sport dates | Code review; no private mismatch asserted | Existing stored dates cannot be assumed to share one business-date meaning. No bulk rebuild or schema rewrite in this patch. |
| Ordinary pagination follows next_key even if local filtering accepted zero rows; cursor-loop state survives batches | Synthetic out-of-window first page followed by valid second page | Preserve this behavior; an empty locally filtered page must not end ordinary pagination. |
| Fitness default page size/vendor boundary inclusivity are unverified; sport explicitly requests limit=50 | Current payloads and response checks | Do not borrow another project's parameters. A first page with has_more is incomplete evidence. |
| Daily steps use a separately verified camel-case millisecond/reverse/cursor contract and descending-page stop | Existing App evidence and P0 regressions | No changes to its parameters, source fusion or ordering convention. |
| Shared transport retried network failures, 429 and 5xx up to three times; unexpected HTTP failures could advance to another metric | A failing synthetic 429 reproduction and new regressions | Repair: one attempt, explicit rate-limit/HTTP error, stop the sync/detail loop without advancing its checkpoint. Legacy constructor arguments remain accepted. |
| Completed old dates are not automatically a late-upload recheck plan | Sync/history code review | Keep upload completeness unknown. A completed historical sweep does not establish final cloud completeness. |

## A: native MCP component validation

The actual native get_raw_record accepted all three component arguments despite the session's displayed tool signature omitting component. metric_record returned the cached raw envelope. A real legacy workout returned legacy_projected_cache_no_raw_response for activity_operational. The production quarantine table was empty; ingestion_quarantine returned not_found for a deliberately nonexistent reference. Populated quarantine retrieval, null source time and request-window context remain synthetic-only validation. No synthetic row was inserted in production and no health request was triggered.

## B: experiment contract, declared before real requests

Operator-only POST /api/collection-window-audit accepts exactly {date}. GET of the same route only reads a saved audit. Neither is an MCP tool. The three windows are previous day, exact target day, and previous-through-next day; all must be closed Shanghai calendar days. Only sleep and sport list channels are allowed. The implementation calls the existing Adapter.page, including its current payload construction/filter/pagination validation. It does not implement a competing collector or change steps.

For the initial owner-authorized run: target 2026-11-02; adjacent 2026-11-01; overlap 2026-11-01 through 2026-11-03. Endpoints: /app/v1/data/get_fitness_data_by_time with key=sleep and /app/v1/data/get_sport_records_by_time. Maximum one login, two authentication HTTP requests and six health requests, one page per window, zero retries. A 45-second budget is checked before every outgoing request. No operational detail or native file download is included.

A cursor/has_more stops the entire experiment as partial instead of fetching an unbudgeted page. Authentication failure, 429, unexpected non-200, invalid response or uncertain network stops immediately. A shared lease excludes sync/history work; only the lease fields can change. A durable checking claim is written before login. Complete, failed, partial or interrupted claims prevent automatic re-login on repeated calls.

Complete privacy-redacted successful result objects, request payloads and redaction metadata are retained in the separate collection_window_audits D1 table. Only counts/status/metadata are returned. Nothing is inserted into raw_records, raw_versions, activity caches, quarantine, daily summaries or sync logs. Normal sync/history cursors are preserved. The schema migration is additive.

The comparison uses identity sets, keeps same-identity payload changes separate, compares the target subset of the overlap against the exact day, and compares the adjacent/exact union against the same two-day subset. Fresh identities absent from the existing cache are reported as observations. Differences may reflect upload timing or vendor behavior; they are not automatically proof of boundary loss or late upload. Equal sets do not prove completeness. A truncated/quarantined experiment makes no comparison claim.

## C: legacy operational raw backfill and late-upload review

Legacy projection cannot recover discarded text/fields. Refetch is useful only when a caller actually needs the complete operational source. Existing native files, normalized records and valid projections should be reused. Readonly requests must continue to return the truthful missing-raw status until a real successful fetch supplies original source.

Proposed next bounded implementation, not enabled by this patch:

| Operation | Selection and continuation | Budget and stop conditions |
| --- | --- | --- |
| Legacy operational raw repair | A separate durable queue of explicitly selected sport references with raw_json IS NULL; recheck cache before each item; never reset activity_details en masse or touch native files. Store the newly redacted response/version through the existing persistence path. Track independent queued/running/completed/failed states. | Initial batch: at most two selected legacy records, one login and two operational requests; skip already repaired items without network. Stop on the first fatal error or active sync/history lease. Persist attempted/uncertain state before network; no automatic retry of an uncertain item. |
| Late-upload review | A separate queue of explicit closed date/metric pairs outside the today/yesterday window, initially sleep and sport on one selected date. Keep the historical backfill cursor unchanged; merge by existing source identity/version logic only after review. | Initial batch: two metric-day requests and one login, one page per pair. A cursor is a partial result requiring a separately budgeted continuation. Stop on any fatal response/uncertain network; no automatic re-login. |

The requests above are separate future budgets, not permission to append them to this experiment. A cached-versus-fresh difference alone cannot distinguish late upload from an earlier incomplete fetch. Repeated dated observations are needed to attribute lateness. No schedule, background repair, cache reset, all-workout download or paid resource was created.

## Verification record

Implementation and final deployed/real results are recorded after validation. Synthetic, local Worker, private deployed API, native MCP and real Xiaomi cloud evidence must remain distinct. No real abnormal cloud record is assumed merely because an offline failure test passed. Native nightly HRV samples and algorithms remain unverified.
