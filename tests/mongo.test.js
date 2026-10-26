import { beforeAll, afterAll, it, expect } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { connectRepository, seed, indexSpec } from "../server/repository.js";
import { rank } from "../server/search.js";
import { dataset } from "../server/data.js";
let mongo, repo;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  repo = await connectRepository(mongo.getUri(), "integration");
  await seed(repo.collection);
});
afterAll(async () => {
  await repo?.close();
  await mongo?.stop();
});
it("seeds idempotently and persists searchable prefixes", async () => {
  await seed(repo.collection);
  expect(await repo.collection.countDocuments()).toBe(dataset.length);
  expect(rank(await repo.find("react"), "react")[0].label).toBe("React");
  expect((await repo.find("ind")).map((x) => x.label)).toContain(
    "MongoDB Indexes",
  );
  expect(await repo.find(".*")).toEqual([]);
});
it("has a compound multikey index and serves prefix lookups without collection scanning", async () => {
  const indexes = await repo.collection.indexes();
  expect(indexes.find((i) => i.name === "prefix_popularity").key).toEqual(
    indexSpec,
  );
  const plan = await repo.collection
    .find({ prefixes: "react" })
    .sort({ popularity: -1, id: 1 })
    .limit(200)
    .explain("executionStats");
  expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain("IXSCAN");
  expect(plan.executionStats.nReturned).toBeGreaterThan(0);
  expect(plan.executionStats.totalDocsExamined).toBeLessThan(dataset.length);
});

it("uses the fuzzy multikey index and verifies typo candidates", async () => {
  const { createSearch } = await import("../server/search.js");
  const result = await createSearch(repo)("reaxt", 8);
  expect(result.items[0].label).toBe("React");
  const { deletionKeys } = await import("../server/fuzzy.js");
  const plan = await repo.collection
    .find({ fuzzyKeys: { $in: deletionKeys("reaxt") } })
    .sort({ popularity: -1, id: 1 })
    .limit(100)
    .explain("executionStats");
  expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain("IXSCAN");
  expect(plan.executionStats.totalDocsExamined).toBeLessThan(dataset.length);
});
it("protects rare exact matches even when popular prefixes fill the candidate budget", async () => {
  const { documentFor } = await import("../server/repository.js");
  const { createSearch } = await import("../server/search.js");
  const rows = Array.from({ length: 220 }, (_, i) => ({
    id: `scale-${i}`,
    label: `Zebra extension ${i}`,
    popularity: 10000 + i,
  }));
  rows.push({ id: "scale-exact", label: "Zebra", popularity: 0 });
  await repo.collection.insertMany(rows.map(documentFor));
  expect((await createSearch(repo)("zebra", 8)).items[0].label).toBe("Zebra");
});
