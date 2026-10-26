import { describe, it, expect, vi } from "vitest";
import {
  normalize,
  prefixesFor,
  rank,
  LruCache,
  createSearch,
} from "../server/search.js";
describe("normalization and indexing", () => {
  it("normalizes unicode, case and whitespace", () => {
    expect(normalize("  ＲＥＡＣＴ  Native ")).toBe("react native");
  });
  it("deduplicates bounded prefixes and includes word starts", () => {
    const result = prefixesFor("MongoDB Indexes");
    expect(result).toContain("ind");
    expect(result).toContain("mongodb i");
    expect(new Set(result).size).toBe(result.length);
    expect(prefixesFor("a".repeat(100))).toHaveLength(64);
  });
});
describe("ranking", () => {
  const row = (id, label, popularity) => ({
    id,
    label,
    popularity,
    category: "Test",
  });
  it("prefers exact, phrase prefix, then word prefix over popularity", () => {
    expect(
      rank(
        [
          row("1", "React Native", 99999),
          row("2", "React", 1),
          row("3", "Learn React", 999999),
        ],
        "react",
      ).map((x) => x.id),
    ).toEqual(["2", "1", "3"]);
  });
  it("breaks same-tier ties by popularity then label and limits output", () => {
    expect(
      rank(
        [
          row("1", "React Zebra", 10),
          row("2", "React Apple", 10),
          row("3", "React Native", 100),
        ],
        "react",
        2,
      ).map((x) => x.id),
    ).toEqual(["3", "2"]);
  });
  it("returns an empty result", () => expect(rank([], "none")).toEqual([]));
});
describe("bounded TTL LRU cache", () => {
  it("evicts the least recently used entry", () => {
    const c = new LruCache({ capacity: 2 });
    c.set("a", 1);
    c.set("b", 2);
    expect(c.get("a")).toBe(1);
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("c")).toBe(3);
  });
  it("expires at the TTL boundary and replaces existing keys", () => {
    let now = 0;
    const c = new LruCache({ ttl: 10, now: () => now });
    expect(c.get("no")).toBeUndefined();
    c.set("a", 1);
    c.set("a", 2);
    expect(c.entries.size).toBe(1);
    expect(c.get("a")).toBe(2);
    now = 10;
    expect(c.get("a")).toBeUndefined();
  });
});
describe("async search", () => {
  it("coalesces concurrent misses then caches the result per limit", async () => {
    const find = vi.fn(async () => [
      { id: "1", label: "React", category: "Frontend", popularity: 100 },
    ]);
    const search = createSearch({ find });
    const [a, b] = await Promise.all([search("react", 8), search("react", 8)]);
    expect(a.cache).toBe("miss");
    expect(b.cache).toBe("coalesced");
    expect(find).toHaveBeenCalledTimes(1);
    expect((await search("react", 8)).cache).toBe("hit");
    await search("react", 1);
    expect(find).toHaveBeenCalledTimes(2);
  });
  it("cleans failed work and allows retry", async () => {
    const find = vi
      .fn()
      .mockRejectedValueOnce(Error("offline"))
      .mockResolvedValue([]);
    const search = createSearch({ find });
    await expect(search("react", 8)).rejects.toThrow("offline");
    expect((await search("react", 8)).items).toEqual([]);
  });
  it("can disable cache for a fair baseline", async () => {
    const find = vi.fn(async () => []);
    const search = createSearch({ find }, { cacheEnabled: false });
    await search("a", 8);
    await search("a", 8);
    expect(find).toHaveBeenCalledTimes(2);
  });
  it("rejects new distinct work at capacity while permitting coalescing", async () => {
    let release;
    const search = createSearch(
      {
        find: () =>
          new Promise((r) => {
            release = r;
          }),
      },
      { maxPending: 1 },
    );
    const first = search("a", 8);
    const shared = search("a", 8);
    await expect(search("b", 8)).rejects.toMatchObject({ status: 503 });
    release([]);
    await first;
    expect((await shared).cache).toBe("coalesced");
  });
});
