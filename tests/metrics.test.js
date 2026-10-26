import { it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";
import { memoryRepository } from "../server/repository.js";
import { createSearch } from "../server/search.js";
import { Metrics } from "../server/metrics.js";

it("exports fixed-cardinality counters and cumulative latency buckets without query text", async () => {
  const app = createApp(memoryRepository());
  await request(app).get("/api/suggest?q=react");
  await request(app).get("/api/suggest?q=react");
  await request(app).get("/api/suggest?q=reaxt");
  await request(app).get("/api/suggest?q=private-secret-query&limit=99");
  const res = await request(app).get("/api/metrics");
  expect(res.headers["content-type"]).toContain("text/plain");
  expect(res.text).toContain(
    'autocomplete_requests_total{outcome="success"} 3',
  );
  expect(res.text).toContain(
    'autocomplete_requests_total{outcome="invalid"} 1',
  );
  expect(res.text).toContain('autocomplete_cache_total{result="hit"} 1');
  expect(res.text).toContain(
    'autocomplete_backend_total{operation="prefix"} 2',
  );
  expect(res.text).toContain('autocomplete_backend_total{operation="fuzzy"} 1');
  expect(res.text).toContain("autocomplete_http_duration_seconds_count 4");
  expect(res.text).not.toContain("react");
  expect(res.text).not.toContain("private-secret");
  const buckets = [...res.text.matchAll(/_bucket\{le="[^"]+"\} (\d+)/g)].map(
    (x) => Number(x[1]),
  );
  expect(buckets).toEqual([...buckets].sort((a, b) => a - b));
  expect(buckets.at(-1)).toBe(4);
  // Scraping metrics must not recursively count itself.
  expect((await request(app).get("/api/metrics")).text).toBe(res.text);
});
it("tracks coalescing and overload and releases inflight gauge after completion", async () => {
  const metrics = new Metrics();
  let release;
  const search = createSearch(
    {
      find: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
    { metrics, maxPending: 1 },
  );
  const first = search("react", 8),
    shared = search("react", 8);
  expect(metrics.inflight).toBe(1);
  await expect(search("python", 8)).rejects.toMatchObject({ status: 503 });
  expect(metrics.overload).toBe(1);
  expect(metrics.cache.coalesced).toBe(1);
  release([]);
  await Promise.all([first, shared]);
  expect(metrics.inflight).toBe(0);
  expect(metrics.cacheEntries).toBe(1);
});
it("records backend failures without leaking error messages through metrics", async () => {
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const app = createApp({
      find: async () => {
        throw Error("sensitive database message");
      },
    });
    await request(app).get("/api/suggest?q=secret");
    const { text } = await request(app).get("/api/metrics");
    expect(text).toContain("autocomplete_backend_errors_total 1");
    expect(text).toContain('autocomplete_requests_total{outcome="failure"} 1');
    expect(text).toContain("autocomplete_inflight 0");
    expect(text).not.toContain("sensitive");
  } finally {
    quiet.mockRestore();
  }
});
it("records exact histogram boundaries cumulatively", () => {
  const metrics = new Metrics();
  metrics.observeRequest(200, 0.005);
  metrics.observeRequest(503, 6);
  expect(metrics.histogram.slice(0, 3)).toEqual([0, 1, 1]);
  expect(metrics.render()).toContain(
    "autocomplete_http_duration_seconds_sum 6.005",
  );
});
