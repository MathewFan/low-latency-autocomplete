import { fork } from "node:child_process";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import { MongoMemoryServer } from "mongodb-memory-server";
import { createApp } from "../server/app.js";
import { connectRepository, seed, documentFor } from "../server/repository.js";
import { deletionKeys } from "../server/fuzzy.js";
import { dataset } from "../server/data.js";

const records = Number(process.env.BENCH_RECORDS || 10000);
const duration = Number(process.env.BENCH_SECONDS || 5);
const connections = Number(process.env.BENCH_CONNECTIONS || 20);
if (!Number.isInteger(records) || records < 1000 || records > 100000)
  throw Error("BENCH_RECORDS must be an integer from 1000 to 100000");
if (!Number.isInteger(duration) || duration < 1 || duration > 120)
  throw Error("BENCH_SECONDS must be an integer from 1 to 120");
if (!Number.isInteger(connections) || connections < 1 || connections > 200)
  throw Error("BENCH_CONNECTIONS must be an integer from 1 to 200");

let mongo, repo;
try {
  // Always disposable: never seed a scale fixture into the caller's database.
  mongo = await MongoMemoryServer.create();
  repo = await connectRepository(mongo.getUri(), "scale_benchmark");
  await seed(repo.collection);
  console.log(
    `Seeding ${records.toLocaleString()} synthetic records into a disposable MongoDB…`,
  );
  for (let offset = 0; offset < records; offset += 500) {
    await repo.collection.insertMany(
      Array.from({ length: Math.min(500, records - offset) }, (_, i) => {
        const id = offset + i;
        return documentFor({
          id: `scale-${id}`,
          label: `Service ${String(id).padStart(5, "0")}`,
          category: "Synthetic benchmark",
          popularity: (id * 7919) % 10000,
        });
      }),
    );
  }
  const fixtures = [
    {
      name: "hot-prefix",
      cacheEnabled: true,
      queries: ["react", "mongo", "service 000", "service 001", "cache"],
    },
    {
      name: "varied-prefix",
      cacheEnabled: false,
      queries: Array.from(
        { length: 250 },
        (_, i) => `service ${String((i * 37) % records).padStart(5, "0")}`,
      ),
    },
    {
      name: "typo-fallback",
      cacheEnabled: false,
      queries: ["reaxt", "monog", "cahce"],
    },
  ];
  const results = {
    timestamp: new Date().toISOString(),
    revision: process.env.BENCH_REVISION || "working-tree",
    node: process.version,
    cpu: os.cpus()[0].model,
    platform: `${os.platform()} ${os.arch()}`,
    records: records + dataset.length,
    durationSeconds: duration,
    connections,
    topology:
      "Separate Node load-generator process; API and real MongoDB on same machine, loopback HTTP. Synthetic corpus; no production SLA.",
    runs: [],
    plans: {},
  };
  for (const fixture of fixtures) {
    console.log(`Running ${fixture.name}…`);
    const app = createApp(repo, { cacheEnabled: fixture.cacheEnabled });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const q of fixture.queries.slice(0, 5))
        await fetch(`${url}/api/suggest?q=${encodeURIComponent(q)}`);
      const worker = fork(new URL("./load-worker.js", import.meta.url), [], {
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      });
      const run = await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => {
            worker.kill();
            reject(Error("Load worker timed out"));
          },
          (duration + 30) * 1000,
        );
        worker.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        worker.once("message", (message) => {
          clearTimeout(timeout);
          message.error ? reject(Error(message.error)) : resolve(message);
        });
        worker.once("exit", (code) => {
          if (code) {
            clearTimeout(timeout);
            reject(Error(`Load worker exited ${code}`));
          }
        });
        worker.send({ url, queries: fixture.queries, connections, duration });
      });
      const metrics = await (await fetch(`${url}/api/metrics`)).text();
      results.runs.push({
        name: fixture.name,
        cacheEnabled: fixture.cacheEnabled,
        ...run,
        p99Within150ms: run.latencyMs.p99 < 150,
        metrics,
      });
      const { metrics: _metrics, ...summary } = results.runs.at(-1);
      console.log(JSON.stringify(summary, null, 2));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
  for (const [name, filter] of [
    ["prefix", { prefixes: "service 000" }],
    ["fuzzy", { fuzzyKeys: { $in: deletionKeys("reaxt") } }],
  ]) {
    const plan = await repo.collection
      .find(filter)
      .sort({ popularity: -1, id: 1 })
      .limit(name === "prefix" ? 200 : 100)
      .explain("executionStats");
    results.plans[name] = {
      winningPlan: plan.queryPlanner.winningPlan,
      documentsExamined: plan.executionStats.totalDocsExamined,
      keysExamined: plan.executionStats.totalKeysExamined,
      returned: plan.executionStats.nReturned,
    };
  }
  await writeFile(
    "scale-results.json",
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log("Saved scale-results.json.");
  if (
    results.runs.some(
      (run) =>
        run.errors ||
        run.timeouts ||
        run.non2xx ||
        run.invalidResponses ||
        (process.env.BENCH_ENFORCE_SLO === "true" && !run.p99Within150ms),
    )
  )
    process.exitCode = 1;
} finally {
  await repo?.close();
  await mongo?.stop();
}
