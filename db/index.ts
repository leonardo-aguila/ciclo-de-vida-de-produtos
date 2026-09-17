import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL não definida. Copie .env.example para .env.local (veja o README).",
  );
}

// One pool per process. Next.js hot-reloads modules in development, so the
// client is cached on globalThis to avoid leaking connections on every reload.
const globalForDb = globalThis as unknown as { __pgClient?: ReturnType<typeof postgres> };

const client =
  globalForDb.__pgClient ??
  postgres(url, {
    max: 10,
    // Dates and numerics are mapped by drizzle; keep postgres.js out of it.
    transform: { undefined: null },
  });

if (process.env.NODE_ENV !== "production") globalForDb.__pgClient = client;

export const db = drizzle(client, { schema });
export type Db = typeof db;
export { schema };
export * from "./schema";
