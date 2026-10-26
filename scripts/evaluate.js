import { memoryRepository } from "../server/repository.js";
import { rank } from "../server/search.js";
// Fixed hand-labelled queries; synthetic vocabulary evaluation, not user research.
const cases = [
  ["react", "React"],
  ["mongo", "MongoDB"],
  ["data", "Data Pipeline"],
  ["cache", "LRU Cache"],
  ["node", "Node.js"],
  ["py", "Python"],
  ["java", "Java"],
  ["sql", "SQL"],
  ["api", "API Gateway"],
  ["docker", "Docker"],
  ["type", "TypeScript"],
  ["index", "Index Optimization"],
];
const repo = memoryRepository();
let baseline = 0,
  ranked = 0;
for (const [query, expected] of cases) {
  const candidates = await repo.find(query);
  const a = candidates.findIndex((x) => x.label === expected);
  const b = rank(candidates, query, 200).findIndex((x) => x.label === expected);
  baseline += a < 0 ? 0 : 1 / (a + 1);
  ranked += b < 0 ? 0 : 1 / (b + 1);
}
console.log(
  JSON.stringify(
    {
      metric: "Mean reciprocal rank",
      queries: cases.length,
      baselineMRR: baseline / cases.length,
      rankedMRR: ranked / cases.length,
      relativeImprovementPercent: (ranked / baseline - 1) * 100,
      limitation:
        "Small synthetic, hand-labelled evaluation; no claim of a 20% user relevance improvement.",
    },
    null,
    2,
  ),
);
