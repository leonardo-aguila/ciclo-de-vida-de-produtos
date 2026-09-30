/**
 * Creates the "Novo Produto" and "Nova Release" task packages from the epics
 * in the Jira Roadmap extract.
 *
 *   npm run db:packages:jira
 *
 * Re-runnable: packages of the same name are replaced, not duplicated.
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";
import { seedJiraPackages } from "./packages-jira";

config({ path: ".env.local" });

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL ou DATABASE_URL não definida.");

  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  console.log("criando pacotes a partir do Roadmap...");
  const packages = await seedJiraPackages(db);
  await client.end();

  for (const pkg of packages) {
    console.log(`\n=== ${pkg.name} — âncora em ${pkg.anchorDate} (${pkg.epicKey})`);
    for (const t of pkg.templates) {
      const off = (n: number) => (n >= 0 ? `+${n}` : String(n));
      console.log(
        `  ${off(t.start).padStart(5)}…${off(t.end).padStart(5)}d  ` +
          `${(t.category ?? "—").padEnd(15)} ${t.priority.padEnd(8)} ${t.name}`,
      );
    }
    const semCategoria = pkg.templates.filter((t) => t.category === null).length;
    if (semCategoria > 0) console.log(`  (${semCategoria} sem categoria — defina na tela do pacote)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
