/** Drops and recreates the public schema. Destructive, development only. */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

// Wrapped in a function rather than written at the top level: tsx transforms
// this file to CommonJS, where top-level await is a syntax error.
async function main() {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL ou DATABASE_URL não definida.");
  if (process.env.NODE_ENV === "production") throw new Error("db:reset não roda em produção.");

  const client = postgres(url, { max: 1 });
  await client.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  // The migration journal lives in its own schema and would survive the drop
  // above — drizzle would then believe every migration was already applied and
  // skip them all, leaving an empty database behind a successful reset.
  await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE;");
  await client.unsafe("GRANT USAGE, CREATE ON SCHEMA public TO portfolio_app;").catch(() => {});
  await client.end();
  console.log("schema public recriado.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
