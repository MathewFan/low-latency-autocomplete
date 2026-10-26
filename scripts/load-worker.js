import autocannon from "autocannon";
import { createHistogram, performance } from "node:perf_hooks";

// The load generator runs in its own process so it does not share the API event loop.
process.once("message", async ({ url, queries, connections, duration }) => {
  try {
    const timing = createHistogram();
    let invalidResponses = 0;
    let clientIndex = 0;
    const requests = queries.map((q) => ({
      method: "GET",
      path: `/api/suggest?q=${encodeURIComponent(q)}`,
      setupRequest: (req, ctx) => {
        ctx.start = performance.now();
        ctx.query = q;
        return req;
      },
      onResponse: (status, body, ctx) => {
        timing.record(
          Math.max(1, Math.round((performance.now() - ctx.start) * 1e6)),
        );
        try {
          const data = JSON.parse(body);
          if (
            status !== 200 ||
            data.query !== ctx.query ||
            data.storage !== "mongodb" ||
            !data.items?.length
          )
            invalidResponses++;
        } catch {
          invalidResponses++;
        }
      },
    }));
    const result = await autocannon({
      url,
      connections,
      duration,
      pipelining: 1,
      setupClient: (client) => {
        // Stagger connections so varied-query tests do not artificially synchronize misses.
        const offset = (clientIndex++ * 37) % requests.length;
        client.setRequests([
          ...requests.slice(offset),
          ...requests.slice(0, offset),
        ]);
      },
      requests,
    });
    process.send(
      {
        requestsPerSecond: result.requests.average,
        totalRequests: result.requests.total,
        latencyMs: {
          mean: timing.mean / 1e6,
          p50: timing.percentile(50) / 1e6,
          p95: timing.percentile(95) / 1e6,
          p99: timing.percentile(99) / 1e6,
        },
        errors: result.errors,
        timeouts: result.timeouts,
        non2xx: result.non2xx,
        invalidResponses,
      },
      () => process.disconnect(),
    );
  } catch (error) {
    process.send({ error: error.message }, () => process.disconnect());
  }
});
