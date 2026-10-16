/**
 * Applies the versioned migrations in db/migrations, then re-applies the grants
 * for the application role (new tables would otherwise be unreachable by it).
 */
import { existsSync } from "node:fs";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { applyGrants, GRANTS_FILE } from "./grants";

config({ path: ".env.local" });

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL ou DATABASE_URL não definida.");

async function main() {
  const client = postgres(url!, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "db/migrations" });
    console.log("migrations aplicadas.");
  } finally {
    await client.end();
  }

  if (!existsSync(GRANTS_FILE)) {
    throw new Error(`${GRANTS_FILE} não encontrado — os grants não foram aplicados.`);
  }
  await applyGrants(url!);
  console.log("grants do papel da aplicação aplicados.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
