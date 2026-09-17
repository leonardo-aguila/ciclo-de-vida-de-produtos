/**
 * Recomputes the monthly health snapshot of every product.
 *
 * Run it after a data import, or on a schedule at the start of each month: the
 * "vs. last month" figure on the product page reads these rows.
 *
 *   npm run db:recalc            — current month for every product
 *   npm run db:recalc -- --backfill  — also reconstructs past months
 */
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const backfill = process.argv.includes("--backfill");
  const { db } = await import("./index");
  const { products } = await import("./schema");
  const { backfillFinancialSnapshots, writeCurrentSnapshot } = await import(
    "../src/lib/snapshots"
  );

  const rows = await db.select({ id: products.id, name: products.name }).from(products);
  if (rows.length === 0) {
    console.log("nenhum produto cadastrado.");
    return;
  }

  for (const product of rows) {
    if (backfill) {
      const count = await backfillFinancialSnapshots(product.id);
      if (count > 0) console.log(`  ${product.name}: ${count} meses reconstruídos`);
    }
    await writeCurrentSnapshot(product.id);
    console.log(`  ${product.name}: snapshot do mês atual gravado`);
  }

  console.log(`\n${rows.length} ${rows.length === 1 ? "produto" : "produtos"} recalculados.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
