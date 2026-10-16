/** Applies the migrations to the test database before the suite runs. */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { applyGrants } from "../../db/grants";

config({ path: ".env.local" });

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL não definida — veja .env.example.");

  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: "db/migrations" });
  } finally {
    await client.end();
  }

  // Os grants também vão para o banco de teste: é o que permite provar, contra
  // um banco de verdade, que audit_logs continua append-only. Sem isto o teste
  // passaria por nunca ter havido restrição nenhuma.
  await applyGrants(url);
}
