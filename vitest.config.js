import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["server/**/*.js", "client/**/*.jsx"],
      exclude: ["server/index.js", "client/main.jsx"],
      reporter: ["text", "json-summary"],
    },
  },
});
