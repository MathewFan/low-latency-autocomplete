import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import {
  deletionKeys,
  fuzzyKeysFor,
  withinOneEdit,
  fuzzyMatch,
} from "../server/fuzzy.js";
import { createSearch, rank } from "../server/search.js";
import { memoryRepository } from "../server/repository.js";
import { createApp } from "../server/app.js";

describe("verified single-edit retrieval", () => {
  it.each([
    ["reaxt", "react"],
    ["reacct", "react"],
    ["ract", "react"],
    ["raect", "react"],
    ["react", "react"],
    ["abc", "ab"],
    ["ab", "abc"],
  ])("accepts one edit: %s → %s", (a, b) =>
    expect(withinOneEdit(a, b)).toBe(true),
  );
  it.each([
    ["rxzct", "react"],
    ["rcaet", "react"],
    ["r", "react"],
    ["ab", "cd"],
  ])("rejects multiple edits: %s → %s", (a, b) =>
    expect(withinOneEdit(a, b)).toBe(false),
  );
  it("verifies every single-edit mutation of representative words", () => {
    for (const word of ["react", "mongodb", "cache", "javascript"]) {
      const mutations = new Set();
      for (let i = 0; i < word.length; i++) {
        mutations.add(word.slice(0, i) + word.slice(i + 1));
        mutations.add(word.slice(0, i) + "x" + word.slice(i + 1));
        mutations.add(word.slice(0, i) + "x" + word.slice(i));
        if (i + 1 < word.length)
          mutations.add(
            word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2),
          );
      }
      mutations.add(word + "x");
      for (const query of mutations) {
        expect(withinOneEdit(word, query), `${word} → ${query}`).toBe(true);
        expect(
          deletionKeys(query).some((key) => fuzzyKeysFor(word).includes(key)),
        ).toBe(true);
      }
    }
  });
  it("bounds index keys and matches word prefixes", () => {
    expect(fuzzyMatch("MongoDB Indexes", "indxes")).toBe("indexes");
    expect(fuzzyMatch("React", "rxzct")).toBeNull();
    expect(deletionKeys("aaa")).toEqual(["aaa", "aa"]);
    expect(fuzzyKeysFor("x".repeat(100)).every((key) => key.length <= 25)).toBe(
      true,
    );
  });
});
describe("search fallback and ranking invariants", () => {
  it("corrects a typo only when strict search is empty and explains the result", async () => {
    const repo = memoryRepository();
    const fuzzy = vi.spyOn(repo, "findFuzzy");
    const search = createSearch(repo);
    const result = await search("reaxt", 8);
    expect(result.search.strategy).toBe("typo-fallback");
    expect(result.items[0].label).toBe("React");
    expect(result.items[0].explanation).toMatchObject({
      matchType: "typo",
      editDistance: 1,
      matchedPrefix: "react",
    });
    await search("react", 8);
    expect(fuzzy).toHaveBeenCalledTimes(1);
    expect((await search("reaxt", 8, { fuzzy: false })).items).toEqual([]);
    expect((await search("reaxt", 8)).cache).toBe("hit");
  });
  it("does not run expensive fallback for short or long queries", async () => {
    const repo = {
      find: vi.fn(async () => []),
      findFuzzy: vi.fn(async () => []),
    };
    const search = createSearch(repo);
    for (const q of ["zz", "z".repeat(25)]) await search(q, 8);
    expect(repo.findFuzzy).not.toHaveBeenCalled();
  });
  it("never lets extreme popularity beat an exact match", () => {
    const rows = [
      { id: "1", label: "React", popularity: 0 },
      { id: "2", label: "React Native", popularity: Number.MAX_VALUE },
    ];
    expect(rank(rows, "react")[0].id).toBe("1");
  });
  it("recovers a rare exact match beyond the candidate budget", async () => {
    const rows = Array.from({ length: 220 }, (_, i) => ({
      id: String(i),
      label: `React extension ${i}`,
      popularity: 10000 + i,
    }));
    rows.push({ id: "rare", label: "React", popularity: 0 });
    const repo = memoryRepository(rows);
    const result = await createSearch(repo)("react", 8);
    expect(result.search.candidateCount).toBe(201);
    expect(result.items[0].id).toBe("rare");
  });
  it("validates fuzzy options and separates strict/fuzzy API cache entries", async () => {
    const app = createApp(memoryRepository());
    expect(
      (await request(app).get("/api/suggest?q=reaxt&fuzzy=false")).body.items,
    ).toEqual([]);
    const result = await request(app).get("/api/suggest?q=reaxt&fuzzy=true");
    expect(result.body.items[0].label).toBe("React");
    expect(
      (await request(app).get("/api/suggest?q=react&fuzzy=maybe")).status,
    ).toBe(400);
    expect(
      (await request(app).get("/api/suggest?q=react&fuzzy=true&fuzzy=false"))
        .status,
    ).toBe(400);
  });
});
