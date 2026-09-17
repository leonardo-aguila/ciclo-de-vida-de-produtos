/**
 * Demo data — products, tasks, finance, plans and comments.
 * Filled in by the later phases; phase 1 only needs settings, enums and users.
 */
import type { drizzle } from "drizzle-orm/postgres-js";
import type * as schema from "../schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

export async function seedDemoData(_db: Database): Promise<void> {
  console.log("dados demonstrativos: entram nas fases seguintes.");
}
