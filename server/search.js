import { fuzzyMatch, MIN_FUZZY_LENGTH, MAX_FUZZY_LENGTH } from "./fuzzy.js";
import { performance } from "node:perf_hooks";
export function normalize(value) {
  return value.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}
export function prefixesFor(label) {
  const value = normalize(label);
  // Index both the full phrase and individual words. Prefixes cap at 64 characters.
  return [
    ...new Set(
      [value, ...value.split(" ")].flatMap((word) =>
        Array.from({ length: Math.min(word.length, 64) }, (_, i) =>
          word.slice(0, i + 1),
        ),
      ),
    ),
  ];
}
export function rank(items, query, limit = 8, { fuzzy = false } = {}) {
  return items
    .map((item) => {
      const label = normalize(item.label);
      const matchType =
        label === query
          ? "exact"
          : label.startsWith(query)
            ? "phrase-prefix"
            : label.split(" ").some((word) => word.startsWith(query))
              ? "word-prefix"
              : "typo";
      const matchedPrefix =
        matchType === "typo"
          ? fuzzy
            ? fuzzyMatch(item.label, query)
            : null
          : query;
      if (matchedPrefix === null) return null;
      const tier = { exact: 3, "phrase-prefix": 2, "word-prefix": 1, typo: 0 }[
        matchType
      ];
      const popularity = Math.max(
        0,
        Number.isFinite(item.popularity) ? item.popularity : 0,
      );
      // Bounded popularity contribution can never overturn a match tier.
      const logPopularity = Math.log1p(popularity);
      const popularityBoost = (25 * logPopularity) / (1 + logPopularity);
      return {
        id: item.id,
        label: item.label,
        category: item.category,
        score: +(tier * 100 + popularityBoost).toFixed(3),
        explanation: {
          matchType,
          matchedPrefix,
          editDistance: matchType === "typo" ? 1 : 0,
          popularityBoost: +popularityBoost.toFixed(3),
        },
      };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.label.localeCompare(b.label) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}
export class LruCache {
  constructor({ capacity = 1000, ttl = 30000, now = Date.now } = {}) {
    this.capacity = capacity;
    this.ttl = ttl;
    this.now = now;
    this.entries = new Map();
  }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expires <= this.now()) return undefined;
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key, value) {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: this.now() + this.ttl });
    while (this.entries.size > this.capacity)
      this.entries.delete(this.entries.keys().next().value);
  }
}
export function createSearch(
  repository,
  { cache = new LruCache(), cacheEnabled = true, maxPending = 200 } = {},
) {
  const pending = new Map();
  return async (query, limit, { fuzzy = true } = {}) => {
    const key = JSON.stringify([query, limit, fuzzy]);
    const hit = cacheEnabled ? cache.get(key) : undefined;
    if (hit !== undefined) return { ...hit, cache: "hit" };
    if (pending.has(key))
      return { ...(await pending.get(key)), cache: "coalesced" };
    if (pending.size >= maxPending)
      throw Object.assign(new Error("Search capacity reached"), {
        status: 503,
      });
    const work = Promise.resolve().then(async () => {
      const start = performance.now();
      let candidates = await repository.find(query);
      let strategy = "prefix";
      if (
        !candidates.length &&
        fuzzy &&
        query.length >= MIN_FUZZY_LENGTH &&
        query.length <= MAX_FUZZY_LENGTH &&
        repository.findFuzzy
      ) {
        candidates = await repository.findFuzzy(query);
        strategy = "typo-fallback";
      }
      const retrievalMs = +(performance.now() - start).toFixed(3);
      const rankStart = performance.now();
      const items = rank(candidates, query, limit, {
        fuzzy: strategy === "typo-fallback",
      });
      return {
        items,
        search: {
          strategy,
          candidateCount: candidates.length,
          retrievalMs,
          rankingMs: +(performance.now() - rankStart).toFixed(3),
        },
      };
    });
    pending.set(key, work);
    try {
      const result = await work;
      if (cacheEnabled) cache.set(key, result);
      return { ...result, cache: "miss" };
    } finally {
      pending.delete(key);
    }
  };
}
