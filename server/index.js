import express from "express";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createApp } from "./app.js";
import { connectRepository, memoryRepository } from "./repository.js";
const repo =
  process.env.DEMO_MODE === "true"
    ? memoryRepository()
    : await connectRepository(
        process.env.MONGODB_URI || "mongodb://127.0.0.1:27017",
        process.env.MONGODB_DB,
      );
const app = createApp(repo);
const dist = fileURLToPath(new URL("../dist", import.meta.url));
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("/{*path}", (_req, res) => res.sendFile(`${dist}/index.html`));
}
const server = app.listen(Number(process.env.PORT || 3001), "127.0.0.1", () =>
  console.log(
    `Autocomplete: http://127.0.0.1:${server.address().port} (${repo.mode})`,
  ),
);
async function shutdown() {
  server.close(async () => {
    await repo.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
