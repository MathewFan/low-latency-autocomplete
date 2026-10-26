# Search design and tradeoffs

## 1. Retrieve a bounded candidate set, then rank

A MongoDB multikey index maps normalized phrase/word prefixes to documents ordered by popularity. Retrieval takes the first 200 candidates. If that truncation excludes an exact phrase match, a separate equality lookup on `normalized` recovers it. This fixes a real failure mode: a rare exact answer should not disappear behind hundreds of popular extensions of the same prefix.

Ranking uses strict tiers: exact, phrase prefix, word prefix, typo. A popularity contribution is bounded below 25 while tiers are separated by 100. Thus popularity cannot override match quality, even for extreme numeric values. Rounded scores and alphabetical/ID tie-breaks make results deterministic. This is intentionally explainable; the curated corpus does not justify training a ranking model.

The candidate cap bounds work but trades recall for latency: a rare word-prefix match or typo can still fall beyond its retrieval budget. Exact recovery fixes one important case, not globally optimal top-k search. A large catalog could use per-tier retrieval, precomputed top-k postings, or a dedicated search engine.

## 2. Pay for typo tolerance only when needed

When prefix retrieval is empty, queries of 3–24 UTF-16 code units use symmetric deletion signatures. Each stored prefix has its original spelling and strings with one character removed. A query generates the same keys. A shared key cheaply retrieves potential one-edit neighbors through a **separate** MongoDB multikey index; keeping the two array fields in separate indexes avoids compound-array indexing constraints.

Sharing a key is insufficient evidence. Up to 100 candidates undergo an explicit single-edit check for insertion, deletion, substitution, or adjacent transposition. This removes signature collisions. Phrase and word starts are eligible. Prefix matches always win by preventing fallback entirely.

Building all signatures increases index storage: a word of length L contributes up to O(L²) keys before deduplication, with additional string-storage cost. Prefix lengths are capped. The benchmark's synthetic names share many prefixes; it does not represent the diversity of a multilingual or natural-language corpus. Unicode normalization is NFKC, but edit operations and prefix lengths use UTF-16 code units rather than grapheme clusters. Linguistic tokenization and transliteration are outside this implementation.

## 3. Bound memory and duplicate work

The cache has 1,000 resident entries and a 30-second TTL. Keys include normalized query, result limit, and typo mode so strict/fuzzy requests cannot contaminate one another. Concurrent identical misses share a promise. A failed operation is removed in `finally`, allowing retries; 200 distinct in-flight queries trigger backpressure through 503 responses.

This coalescing is visible in metrics and benchmark reports. It improves hot-query throughput even when caching is disabled, so request throughput must not be reported as database-query throughput. Disabling cache isolates cached reuse; it does not disable coalescing.

Cache state and metrics are per process. TTL limits staleness but is not coordinated invalidation. A multi-replica deployment would need shared cache decisions or accept independent caches. Client cancellation suppresses stale UI updates; it intentionally does not cancel shared database work that other requests may await. Sequential strict/fuzzy retrieval can consume two MongoDB operation timeouts; there is no global request deadline or distributed circuit breaker.

## 4. Explain behavior without collecting search histories

Each response includes the retrieval strategy, bounded candidate count, and ranking explanations. Cached timing fields describe the original computation; the UI separately shows the current server duration and HTTP round trip. Browser timings exclude the input debounce and rendering. The trace holds only eight successful requests in tab memory and is cleared on reload.

Prometheus exposition uses fixed labels for request outcomes, cache decisions, and repository operations. It includes latency buckets, in-flight work, resident entries, rejected work, and backend failures. It never labels metrics with query strings, client IPs, or user IDs. Repository counters count retrieval method calls, not wire commands; rare exact recovery and cursor getMore may add MongoDB commands.

## 5. Evidence before claims

Unit tests exercise the edit predicate over all single-edit mutations of representative words. Real MongoDB tests verify persistence, index plans, idempotent seeding, and rare exact-match recovery past the candidate cap. Frontend tests cover races, keyboard navigation, strict/fuzzy switching, retries, explanation rendering, and bounded traces.

The scale harness uses a disposable MongoDB, a separate Node load-generator process, deterministic synthetic records, staggered client query sequences, validated response bodies, and a bounded-memory high-resolution latency histogram. It records hot cached prefixes, varied uncached prefixes, and uncached typo fallback separately. Generator, API, and database still share one physical machine and network loopback.

The relevance fixture is a small hand-labelled regression set, including explicit no-match queries. Full recall there protects expected behavior; it does not predict production relevance or a percentage improvement in user satisfaction. CI runs a smaller scale smoke test and gates correctness; optional `BENCH_ENFORCE_SLO=true` enforces the local 150 ms p99 goal. Shared CI runner speed is not a production SLA.

## Further production work

A production rollout would need realistic catalog/query distributions, cold-cache and multi-machine trials, sustained-load/soak tests, index-size measurements, an overall deadline, admission controls by client, health readiness checks, TLS, and a measured deployment plan. None is implied by a successful local benchmark.

Reference: [MongoDB multikey indexes](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-multikey/).
