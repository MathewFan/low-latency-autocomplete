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
