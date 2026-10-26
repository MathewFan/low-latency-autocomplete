import express from "express";
import { performance } from "node:perf_hooks";
import { normalize, createSearch } from "./search.js";
export function createApp(repository, options = {}) {
  const app = express();
  app.disable("x-powered-by");
  const search = createSearch(repository, options);
  app.get("/api/health", (_req, res) =>
    res.json({ status: "ok", storage: repository.mode }),
  );
  app.get("/api/suggest", async (req, res, next) => {
    const start = performance.now();
    if (typeof req.query.q !== "string" || req.query.q.length > 128)
      return res
        .status(400)
        .json({ error: "q must be a string up to 128 characters" });
    const query = normalize(req.query.q);
    if (query.length > 64)
      return res
        .status(400)
        .json({ error: "Normalized query must be at most 64 characters" });
    const rawLimit = req.query.limit ?? "8";
    if (typeof rawLimit !== "string" || !/^(?:[1-9]|10)$/.test(rawLimit))
      return res
        .status(400)
        .json({ error: "limit must be an integer from 1 to 10" });
    try {
      const result = query
        ? await search(query, Number(rawLimit))
        : { items: [], cache: "none" };
      const durationMs = +(performance.now() - start).toFixed(2);
      res.set({
        "Cache-Control": "no-store",
        "Server-Timing": `search;dur=${durationMs}`,
      });
      res.json({ query, ...result, durationMs, storage: repository.mode });
    } catch (error) {
      next(error);
    }
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API route not found" }),
  );
  app.use((error, _req, res, _next) => {
    console.error(error.message);
    res
      .status(error.status === 503 ? 503 : 500)
      .json({ error: "Search temporarily unavailable. Please retry." });
  });
  return app;
}
