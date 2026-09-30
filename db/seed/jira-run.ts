/**
 * Wipes the portfolio's domain data and repopulates it from the Jira Roadmap.
 *
 *   npm run db:seed:jira
 *
 * Configuration survives — enum values, task packages and the settings row are
 * how the application is set up, not data about products. Login accounts also
 * survive, except the fictional demo users, which are removed once the rows
 * that referenced them are gone.
 */
import { config } from "dotenv";
import { inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../schema";
import { importJiraRoadmap } from "./jira";

config({ path: ".env.local" });

/** Seeded demo logins. The admin stays; these go with the demo data. */
const DEMO_LOGINS = ["marina", "rafael", "camila", "paulo"];

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL ou DATABASE_URL não definida.");

  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  console.log("limpando os dados de produto da aplicação...");
  // Configuration (app_settings, enum_values, task_packages, task_templates)
  // is deliberately not in this list: it describes how the application works,
  // not what it holds.
  await db.execute(sql`
    TRUNCATE TABLE
      health_snapshots, action_plans, milestones, business_plan_months, business_plans,
      monthly_sales, finance_entries, insights, task_attachments, task_comments,
      task_dependencies, tasks, product_comments, product_decisions, product_goals,
      product_phase_history, products, audit_logs
    RESTART IDENTITY CASCADE
  `);

  await db.delete(schema.users).where(inArray(schema.users.login, DEMO_LOGINS));
  console.log("usuários de demonstração removidos (o admin permanece).");

  await importJiraRoadmap(db);
  await client.end();

  console.log("\ncalculando snapshots de saúde...");
  const { backfillFinancialSnapshots, writeCurrentSnapshot } = await import("../../src/lib/snapshots");
  const { db: appDb } = await import("../index");
  const imported = await appDb.select({ id: schema.products.id }).from(schema.products);
  for (const product of imported) {
    await backfillFinancialSnapshots(product.id);
    await writeCurrentSnapshot(product.id);
  }

  console.log("\nimportação concluída.");
  // The application's pool stays open once the snapshot step has used it.
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
