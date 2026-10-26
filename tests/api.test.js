import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";
import { memoryRepository } from "../server/repository.js";
describe("HTTP contract", () => {
  const app = createApp(memoryRepository());
  it("reports explicit storage mode", async () => {
    expect((await request(app).get("/api/health")).body).toEqual({
      status: "ok",
      storage: "demo-memory",
    });
  });
  it("normalizes queries, limits results, returns timing and cache hits", async () => {
    const a = await request(app)
      .get("/api/suggest")
      .query({ q: "  REACT ", limit: 2 });
    expect(a.status).toBe(200);
    expect(a.body.items).toHaveLength(2);
    expect(a.body.items[0].label).toBe("React");
    expect(a.body.query).toBe("react");
    expect(a.headers["server-timing"]).toMatch(/search;dur=/);
    expect(a.headers["cache-control"]).toBe("no-store");
    expect(
      (await request(app).get("/api/suggest").query({ q: "react", limit: 2 }))
        .body.cache,
    ).toBe("hit");
  });
  it("handles empty and absent matches", async () => {
    expect((await request(app).get("/api/suggest?q=")).body.items).toEqual([]);
    expect(
      (await request(app).get("/api/suggest?q=zzzzzz")).body.items,
    ).toEqual([]);
  });
  it.each([
    "/api/suggest",
    "/api/suggest?q=a&q=b",
    "/api/suggest?q=a&limit=0",
    "/api/suggest?q=a&limit=11",
    "/api/suggest?q=a&limit=2.5",
    "/api/suggest?q=a&limit=1&limit=2",
    "/api/suggest?q=" + "a".repeat(129),
    "/api/suggest?q=" + "a".repeat(65),
  ])("rejects invalid input %s", async (path) => {
    expect((await request(app).get(path)).status).toBe(400);
  });
  it("treats regex and operator input as literal strings", async () => {
    expect(
      (await request(app).get("/api/suggest").query({ q: ".*$ne" })).body.items,
    ).toEqual([]);
  });
  it("returns safe database failures and overload responses", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const status of [500, 503]) {
        const broken = createApp({
          find: async () => {
            throw Object.assign(Error("private failure"), { status });
          },
        });
        const res = await request(broken).get("/api/suggest?q=a");
        expect(res.status).toBe(status);
        expect(res.body.error).not.toContain("private");
      }
    } finally {
      quiet.mockRestore();
    }
  });
  it("uses JSON for unknown API routes", async () => {
    expect((await request(app).get("/api/missing")).status).toBe(404);
  });
});
