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
export function rank(items, query, limit = 8) {
  return items
    .map((item) => {
      const label = normalize(item.label);
      const match = label === query ? 3 : label.startsWith(query) ? 2 : 1;
      return {
        id: item.id,
        label: item.label,
        category: item.category,
        score: +(match * 100 + Math.log1p(item.popularity) * 5).toFixed(3),
      };
    })
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
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
  return async (query, limit) => {
    const key = JSON.stringify([query, limit]);
    const hit = cacheEnabled ? cache.get(key) : undefined;
    if (hit !== undefined) return { items: hit, cache: "hit" };
    if (pending.has(key))
      return { items: await pending.get(key), cache: "coalesced" };
    if (pending.size >= maxPending)
      throw Object.assign(new Error("Search capacity reached"), {
        status: 503,
      });
    const work = Promise.resolve()
      .then(() => repository.find(query))
      .then((items) => rank(items, query, limit));
    pending.set(key, work);
    try {
      const items = await work;
      if (cacheEnabled) cache.set(key, items);
      return { items, cache: "miss" };
    } finally {
      pending.delete(key);
    }
  };
}
