import { connectRepository, seed } from "../server/repository.js";
const repo = await connectRepository(
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017",
  process.env.MONGODB_DB,
);
try {
  await seed(repo.collection);
  console.log("Seeded vocabulary and indexes.");
} finally {
  await repo.close();
}
