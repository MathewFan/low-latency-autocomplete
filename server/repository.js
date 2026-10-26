import { MongoClient } from "mongodb";
import { dataset } from "./data.js";
import { prefixesFor } from "./search.js";
export const indexSpec = { prefixes: 1, popularity: -1, id: 1 };
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
      find: (query) =>
        collection
          .find(
            { prefixes: query },
            {
              projection: {
                _id: 0,
                id: 1,
                label: 1,
                category: 1,
                popularity: 1,
              },
              maxTimeMS: 2000,
            },
          )
          .sort({ popularity: -1, id: 1 })
          .limit(200)
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
  await collection.bulkWrite(
    dataset.map((item) => ({
      updateOne: {
        filter: { id: item.id },
        update: { $set: { ...item, prefixes: prefixesFor(item.label) } },
        upsert: true,
      },
    })),
  );
}
export function memoryRepository() {
  const rows = dataset.map((item) => ({
    ...item,
    prefixes: prefixesFor(item.label),
  }));
  return {
    mode: "demo-memory",
    find: async (query) =>
      rows
        .filter((item) => item.prefixes.includes(query))
        .sort((a, b) => b.popularity - a.popularity || a.id.localeCompare(b.id))
        .slice(0, 200),
    close: async () => {},
  };
}
