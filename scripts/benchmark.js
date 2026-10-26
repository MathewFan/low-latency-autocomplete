import autocannon from "autocannon";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../server/app.js";
import { connectRepository, seed } from "../server/repository.js";
import { dataset } from "../server/data.js";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import { performance } from "node:perf_hooks";
let mongo, repo;
const seconds = Number(process.env.BENCH_SECONDS || 10);
const connections = Number(process.env.BENCH_CONNECTIONS || 30);
const queries = [
  "react",
  "mongo",
  "data",
  "cache",
  "node",
  "py",
  "java",
  "aws",
  "sql",
  "api",
  "docker",
  "type",
];
try {
  mongo = process.env.MONGODB_URI ? null : await MongoMemoryServer.create();
  repo = await connectRepository(
    process.env.MONGODB_URI || mongo.getUri(),
    "autocomplete_benchmark",
  );
  await seed(repo.collection);
  const results = {
    timestamp: new Date().toISOString(),
    node: process.version,
    platform: `${os.platform()} ${os.arch()}`,
    cpu: os.cpus()[0].model,
    records: dataset.length,
    seconds,
    connections,
    notes:
      "Loopback HTTP, same-machine client/server/database; curated small corpus. Not an end-to-end browser or production benchmark.",
    runs: {},
  };
  for (const cacheEnabled of [false, true]) {
    let databaseLookups = 0;
    const app = createApp(
      {
        ...repo,
        find: (query) => {
          databaseLookups++;
          return repo.find(query);
        },
      },
      { cacheEnabled },
    );
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const q of queries) await fetch(`${url}/api/suggest?q=${q}`);
      databaseLookups = 0;
      const samples = [];
      const result = await autocannon({
        url,
        connections,
        duration: seconds,
        pipelining: 1,
        verifyBody: (body) => {
          try {
            const data = JSON.parse(body);
            return (
              data.storage === "mongodb" &&
              queries.includes(data.query) &&
              data.items.length > 0
            );
          } catch {
            return false;
          }
        },
        requests: queries.map((q) => ({
          method: "GET",
          path: `/api/suggest?q=${q}`,
          setupRequest: (req, ctx) => {
            ctx.start = performance.now();
            return req;
          },
          onResponse: (_status, _body, ctx) => {
            samples.push(performance.now() - ctx.start);
          },
        })),
      });
      samples.sort((a, b) => a - b);
      const highResolutionLatencyMs = {
        mean: samples.reduce((a, b) => a + b, 0) / samples.length,
        p50: samples[Math.floor(samples.length * 0.5)],
        p95: samples[Math.floor(samples.length * 0.95)],
        p99: samples[Math.floor(samples.length * 0.99)],
      };
      results.runs[cacheEnabled ? "cached" : "uncached"] = {
        requestsPerSecond: result.requests.average,
        highResolutionLatencyMs,
        latency: result.latency,
        errors: result.errors,
        timeouts: result.timeouts,
        non2xx: result.non2xx,
        totalRequests: result.requests.total,
        databaseLookups,
        mismatches: result.mismatches,
      };
      console.log(
        cacheEnabled ? "Cached" : "Uncached",
        results.runs[cacheEnabled ? "cached" : "uncached"],
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  results.meanLatencyReductionPercent = +(
    (1 -
      results.runs.cached.highResolutionLatencyMs.mean /
        results.runs.uncached.highResolutionLatencyMs.mean) *
    100
  ).toFixed(2);
  await writeFile(
    "benchmark-results.json",
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(
    "Saved benchmark-results.json. Mean latency reduction:",
    results.meanLatencyReductionPercent,
    "%",
  );
  if (
    Object.values(results.runs).some(
      (r) => r.errors || r.timeouts || r.non2xx || r.mismatches,
    )
  )
    process.exitCode = 1;
} finally {
  await repo?.close();
  await mongo?.stop();
}
