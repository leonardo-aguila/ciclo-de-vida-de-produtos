/** Drops and recreates the public schema. Destructive, development only. */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL ou DATABASE_URL não definida.");
if (process.env.NODE_ENV === "production") throw new Error("db:reset não roda em produção.");

const client = postgres(url, { max: 1 });
await client.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
await client.unsafe("GRANT USAGE, CREATE ON SCHEMA public TO portfolio_app;").catch(() => {});
await client.end();
console.log("schema public recriado.");
