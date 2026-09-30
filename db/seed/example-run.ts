/**
 * Adds (or replaces) the single fictional example product.
 *
 *   npm run db:seed:example
 *
 * Touches nothing else: the products imported from the Jira Roadmap and the
 * task packages stay as they are.
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";
import { seedExampleProduct } from "./example";

config({ path: ".env.local" });

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL ou DATABASE_URL não definida.");

  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  console.log("cadastrando o produto de exemplo...");
  const productId = await seedExampleProduct(db);
  await client.end();

  console.log("\ncalculando snapshots de saúde...");
  const { backfillFinancialSnapshots, writeCurrentSnapshot } = await import("../../src/lib/snapshots");
  const meses = await backfillFinancialSnapshots(productId);
  await writeCurrentSnapshot(productId);
  console.log(`  ${meses} meses reconstruídos`);

  console.log("\npronto.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
