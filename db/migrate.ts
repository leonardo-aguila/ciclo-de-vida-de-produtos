/**
 * Applies the versioned migrations in db/migrations, then re-applies the grants
 * for the application role (new tables would otherwise be unreachable by it).
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

config({ path: ".env.local" });

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL ou DATABASE_URL não definida.");

async function main() {
  const client = postgres(url!, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: "db/migrations" });
    console.log("migrations aplicadas.");
  } finally {
    await client.end();
  }

  const grants = "scripts/grant-app.sql";
  if (existsSync(grants) && !process.env.SKIP_GRANTS) {
    const psql = `${process.env.HOME}/Applications/Postgres.app/Contents/Versions/latest/bin/psql`;
    const bin = existsSync(psql) ? psql : "psql";
    try {
      execFileSync(bin, [url!, "-v", "ON_ERROR_STOP=1", "-q", "-f", grants], {
        stdio: "inherit",
      });
      console.log("grants do papel da aplicação aplicados.");
    } catch {
      console.warn("aviso: não foi possível aplicar os grants (psql indisponível?).");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
