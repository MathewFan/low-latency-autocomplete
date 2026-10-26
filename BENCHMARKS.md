# Measured local results

Recorded 2026-10-26T01:30:51.856Z. One illustrative run, not a production SLA.

## Environment and workload

- Apple M5; darwin arm64; Node v26.8.1.
- 101 original curated vocabulary records, 12 repeated prefix queries.
- 30 HTTP connections, 10 seconds per scenario, HTTP/1.1 without pipelining.
- Client, Express API, and a disposable real MongoDB server on the same machine over loopback.
- Each scenario is warmed up. Cache-disabled baseline retains in-flight coalescing and the MongoDB index.
- Response bodies are checked for valid MongoDB suggestion results; database calls are counted.

| Metric                                       | Indexed, cache disabled | Indexed, warm cache |
| -------------------------------------------- | ----------------------: | ------------------: |
| Requests/sec                                 |               41,174.55 |           38,698.19 |
| HTTP mean, ms                                |                   0.725 |               0.771 |
| HTTP p95, ms                                 |                   0.915 |               0.864 |
| HTTP p99, ms                                 |                   1.206 |               1.018 |
| Database lookups during load                 |                  32,262 |                   0 |
| Errors / timeouts / non-2xx / invalid bodies |           0 / 0 / 0 / 0 |       0 / 0 / 0 / 0 |

Mean latency reduction: **-6.37%** (negative means the cached run was slower). This run does **not** establish a 40% latency improvement. The workload is so small that shared-process load-generator overhead and coalescing dominate; caching demonstrably reduces database traffic. Repeated runs, a separate load generator, a realistic corpus, and a production-like network are needed for broader claims.

Latency values above use high-resolution per-request client timestamps. Autocannon's built-in millisecond histogram quantizes many sub-millisecond requests to zero, so its mean is not used for percentage calculations. Raw results retain both measurements.

## Ranking evaluation

A fixed 12-query hand-labelled set yields MRR **0.875** for popularity-only ranking and **1.000** for match-aware ranking: **14.29% relative improvement**. This is a synthetic vocabulary evaluation, not a user relevance study. It does not establish a 20% improvement in user relevance.

## Verification

32 tests passed, including a real MongoDB index-plan and idempotent-seeding check. Production build passed. Coverage for application modules (excluding server startup and React bootstrap):

| Coverage   | Measured |
| ---------- | -------: |
| Lines      |     100% |
| Statements |     100% |
| Branches   |   93.05% |
| Functions  |   96.29% |

See [raw benchmark results](docs/benchmark-results.json) and [coverage summary](docs/coverage-summary.json). Reproduce with `npm run benchmark`, `npm run evaluate`, and `npm run test:coverage`. First-run integration checks download an official MongoDB binary. Benchmark output is ignored by Git by default; this recorded snapshot is committed explicitly under docs.
