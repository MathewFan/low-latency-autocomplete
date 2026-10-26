# Measured results

## Current scale workload

Recorded 2026-10-26T01:48:04.867Z, after the typo-recovery and inspector changes with metrics instrumentation. One local run on Apple M5 / darwin arm64 / Node v26.8.1.

**10,101 records** (10,000 deterministic synthetic service names plus 101 curated terms), **20 connections**, **5 seconds per scenario**. The load generator runs in a separate Node process. API, generator, and real MongoDB still share a machine and loopback network. Client sequences are staggered to reduce artificial synchronization.

| Workload      | Requests/sec | Mean ms | p95 ms | p99 ms | Cache misses* | Coalesced requests* |
| ------------- | -----------: | ------: | -----: | -----: | ------------: | ------------------: |
| hot-prefix    |       64,317 |   0.305 |  0.536 |  0.627 |             5 |                   0 |
| varied-prefix |       37,032 |   0.535 |  0.854 |  1.226 |        60,450 |             124,757 |
| typo-fallback |       41,853 |   0.472 |  0.701 |  1.020 |        15,858 |             193,419 |

All scenarios had **zero errors, timeouts, non-2xx responses, or invalid response bodies**, and p99 below the local 150 ms goal. Only the hot-prefix scenario enables cache. The varied-prefix scenario rotates 250 service queries; typo fallback rotates three misspelled vocabulary queries. These are different workloads, so their numbers do not isolate a cache speedup.

\* Metrics include a few warmup requests and requests completed while connections drained, so counters may exceed the load generator's timed response count. Coalescing remains enabled in every scenario. A coalesced HTTP request does **not** perform an independent database lookup: HTTP throughput is not database QPS. Short repeated-query trials do not establish production capacity, cold-cache behavior, sustained stability, or large-catalog relevance.

Both prefix and fuzzy query plans use an index scan; full winning plans, key/document counts, fixed-label server metrics, and validated request totals are in [the raw scale snapshot](docs/scale-results.json).

Reproduce with:

```sh
npm ci
npm run benchmark:scale
# Enforce the local latency goal as well as correctness:
BENCH_ENFORCE_SLO=true npm run benchmark:scale
```

The harness always uses a disposable database. `BENCH_RECORDS`, `BENCH_SECONDS`, and `BENCH_CONNECTIONS` control fixture size and load. Timing uses Node's bounded-memory high-resolution histogram rather than rounding sub-millisecond samples to zero.

## Ranking regression set

The fixed fixture has 20 positive queries across prefix, word, exact, and typo cohorts, plus three no-match controls. Match-aware ranking achieved MRR **1.000**, recall@5 **100%**, and no-match accuracy **100%** on this set. Popularity-only strict retrieval achieved MRR **0.525**; it has no typo recovery. Comparing these combines retrieval and ranking changes, not a pure reranker improvement.

See [every query and returned result](docs/relevance-results.json) and [the fixture](tests/fixtures/relevance.json). These labels are hand-chosen on a tiny synthetic corpus. Perfect regression scores are not evidence of general production relevance or a user satisfaction improvement. CI gates fixture recall, exact first-place matches, and no-match controls.

## Verification

**59 tests passed**, including real MongoDB index plans, exact recovery beyond the candidate budget, one-edit mutations, cache coalescing/backpressure, safe metrics, stale response suppression, retries, and inspector interactions. Production build passed.

| Coverage (application modules) | Measured |
| ------------------------------ | -------: |
| Lines                          |   98.85% |
| Statements                     |   98.85% |
| Branches                       |   93.23% |
| Functions                      |   95.65% |

Startup/bootstrap scripts are excluded; these figures are not coverage for the entire repository. See [coverage snapshot](docs/coverage-summary.json). CI additionally runs a 1,000-record scale smoke test without enforcing shared-runner timing.

## Initial baseline, retained for comparison

The original `ce07ae1` implementation used a 101-record corpus and a same-process generator. Its cache-disabled/cached means were 0.725 / 0.771 ms, so it did **not** demonstrate a 40% latency reduction. Its 12-query ranking set showed a 14.29% relative MRR improvement. Those figures describe that earlier code and fixture, not the current workload. [Original raw results](docs/benchmark-results.json) are retained rather than overwritten.

No claim of a 40% latency reduction or a 20% real-user relevance improvement is made. See [design decisions and limits](docs/DESIGN.md).
