import { MongoClient } from "mongodb";
import { dataset } from "./data.js";
import { normalize, prefixesFor } from "./search.js";
import { deletionKeys, fuzzyKeysFor } from "./fuzzy.js";
export const indexSpec = { prefixes: 1, popularity: -1, id: 1 };
const projection = { _id: 0, id: 1, label: 1, category: 1, popularity: 1 };
export function documentFor(item) {
  return {
    ...item,
    normalized: normalize(item.label),
    prefixes: prefixesFor(item.label),
    fuzzyKeys: fuzzyKeysFor(item.label),
  };
}
export async function connectRepository(uri, dbName = "autocomplete") {
  const client = new MongoClient(uri, {
    maxPoolSize: 30,
    serverSelectionTimeoutMS: 5000,
    waitQueueTimeoutMS: 2000,
  });
  try {
    await client.connect();
    const collection = client.db(dbName).collection("suggestions");
    return {
      client,
      collection,
      mode: "mongodb",
      find: async (query) => {
        const candidates = await collection
          .find({ prefixes: query }, { projection, maxTimeMS: 2000 })
          .sort({ popularity: -1, id: 1 })
          .limit(200)
          .toArray();
        // Recover a rare exact match excluded by popularity truncation.
        if (
          candidates.length === 200 &&
          !candidates.some((item) => normalize(item.label) === query)
        ) {
          const exact = await collection.findOne(
            { normalized: query },
            { projection, maxTimeMS: 2000 },
          );
          if (exact) candidates.push(exact);
        }
        return candidates;
      },
      findFuzzy: (query) =>
        collection
          .find(
            { fuzzyKeys: { $in: deletionKeys(query) } },
            { projection, maxTimeMS: 2000 },
          )
          .sort({ popularity: -1, id: 1 })
          .limit(100)
          .toArray(),
      close: () => client.close(),
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}
export async function seed(collection) {
  await collection.createIndex({ id: 1 }, { unique: true });
  await collection.createIndex(indexSpec, { name: "prefix_popularity" });
  await collection.createIndex({ normalized: 1 }, { name: "normalized_exact" });
  await collection.createIndex(
    { fuzzyKeys: 1, popularity: -1, id: 1 },
    { name: "fuzzy_candidates" },
  );
  await collection.bulkWrite(
    dataset.map((item) => ({
      updateOne: {
        filter: { id: item.id },
        update: { $set: documentFor(item) },
        upsert: true,
      },
    })),
  );
}
export function memoryRepository(items = dataset) {
  const rows = items.map(documentFor);
  const order = (a, b) =>
    b.popularity - a.popularity || a.id.localeCompare(b.id);
  // Inverted maps mirror MongoDB index lookups; demo searches no longer scan all rows.
  function index(field) {
    const map = new Map();
    for (const row of rows)
      for (const key of row[field]) {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(row);
      }
    for (const bucket of map.values()) bucket.sort(order);
    return map;
  }
  const prefixes = index("prefixes");
  const fuzzyKeys = index("fuzzyKeys");
  const exact = new Map(rows.map((row) => [row.normalized, row]));
  return {
    mode: "demo-memory",
    find: async (query) => {
      const candidates = (prefixes.get(query) || []).slice(0, 200);
      const match = exact.get(query);
      if (match && !candidates.some((row) => row.id === match.id))
        candidates.push(match);
      return candidates;
    },
    findFuzzy: async (query) =>
      [
        ...new Map(
          deletionKeys(query)
            .flatMap((key) => fuzzyKeys.get(key) || [])
            .map((row) => [row.id, row]),
        ).values(),
      ]
        .sort(order)
        .slice(0, 100),
    close: async () => {},
  };
}
