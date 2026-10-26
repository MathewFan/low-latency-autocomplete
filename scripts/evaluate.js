import { readFile, writeFile } from "node:fs/promises";
import { memoryRepository } from "../server/repository.js";
import { createSearch } from "../server/search.js";
const cases = JSON.parse(
  await readFile(new URL("../tests/fixtures/relevance.json", import.meta.url)),
);
const repo = memoryRepository();
const search = createSearch(repo, { cacheEnabled: false });
const rows = [];
for (const test of cases) {
  const baseline = await repo.find(test.query);
  const result = await search(test.query, 5);
  const baselineRank = baseline
    .slice(0, 5)
    .findIndex((item) => item.label === test.expected);
  const rank = result.items.findIndex((item) => item.label === test.expected);
  rows.push({
    ...test,
    baselineReciprocalRank: baselineRank < 0 ? 0 : 1 / (baselineRank + 1),
    reciprocalRank: rank < 0 ? 0 : 1 / (rank + 1),
    recalledAt5: rank >= 0,
    noMatchCorrect:
      test.expected === null ? result.items.length === 0 : undefined,
    strategy: result.search.strategy,
    returned: result.items.map((item) => item.label),
  });
}
function summarize(values) {
  const positive = values.filter((row) => row.expected !== null);
  return {
    queries: positive.length,
    baselineMRR:
      positive.reduce((s, r) => s + r.baselineReciprocalRank, 0) /
      positive.length,
    rankedMRR:
      positive.reduce((s, r) => s + r.reciprocalRank, 0) / positive.length,
    recallAt5: positive.filter((r) => r.recalledAt5).length / positive.length,
  };
}
const report = {
  timestamp: new Date().toISOString(),
  corpusRecords: (await import("../server/data.js")).dataset.length,
  scope:
    "Hand-labelled synthetic vocabulary queries, fixed fixtures; not a production relevance study or a held-out user dataset.",
  overall: summarize(rows),
  cohorts: Object.fromEntries(
    ["prefix", "word", "exact", "typo"].map((cohort) => [
      cohort,
      summarize(rows.filter((row) => row.cohort === cohort)),
    ]),
  ),
  noMatchAccuracy:
    rows.filter((row) => row.expected === null && row.noMatchCorrect).length /
    rows.filter((row) => row.expected === null).length,
  rows,
};
console.log(JSON.stringify(report, null, 2));
if (process.env.EVAL_OUTPUT)
  await writeFile(
    process.env.EVAL_OUTPUT,
    JSON.stringify(report, null, 2) + "\n",
  );
// A small regression gate, not a claim of generalized relevance quality.
if (
  report.overall.recallAt5 < 1 ||
  report.cohorts.exact.rankedMRR < 1 ||
  report.noMatchAccuracy < 1
)
  process.exitCode = 1;
