/**
 * Seed entry point.
 *
 * Idempotent by design: it wipes the domain tables and rewrites them, so running
 * it twice leaves the same database. Users are preserved unless RESET_USERS=1,
 * so a seed refresh does not log everyone out of their own accounts.
 */
import bcrypt from "bcryptjs";
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  BCRYPT_ROUNDS,
  DEFAULT_BP_DEVIATION_LIMIT,
  DEFAULT_CURRENCY,
  DEFAULT_HEALTH_WEIGHTS,
  DEFAULT_PROJECTION,
  DEFAULT_RECOMMENDATION_RULES,
  DEFAULT_SEMAPHORE,
} from "../../src/lib/defaults";
import * as schema from "../schema";
import { ENUM_SEEDS } from "./enums";
import { seedPackages } from "./packages";

config({ path: ".env.local" });

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL ou DATABASE_URL não definida.");

export const SEED_USERS = [
  {
    name: "Leonardo Aguila",
    email: "admin@portfolio.local",
    login: "admin",
    password: "***SENHA-REMOVIDA***",
    role: "admin" as const,
  },
  {
    name: "Marina Duarte",
    email: "marina.duarte@portfolio.local",
    login: "marina",
    password: "***SENHA-REMOVIDA***",
    role: "product_manager" as const,
  },
  {
    name: "Rafael Nunes",
    email: "rafael.nunes@portfolio.local",
    login: "rafael",
    password: "***SENHA-REMOVIDA***",
    role: "product_manager" as const,
  },
  {
    name: "Camila Rocha",
    email: "camila.rocha@portfolio.local",
    login: "camila",
    password: "***SENHA-REMOVIDA***",
    role: "collaborator" as const,
  },
  {
    name: "Paulo Bianchi",
    email: "paulo.bianchi@portfolio.local",
    login: "paulo",
    password: "***SENHA-REMOVIDA***",
    role: "executive" as const,
  },
];

async function main() {
  const client = postgres(url!, { max: 1 });
  const db = drizzle(client, { schema });

  console.log("limpando dados de domínio...");
  await db.execute(sql`
    TRUNCATE TABLE
      health_snapshots, action_plans, milestones, business_plan_months, business_plans,
      monthly_sales, finance_entries, insights, task_attachments, task_comments,
      task_dependencies, tasks, task_template_dependencies, task_templates, task_packages,
      product_comments, product_decisions, product_goals, product_phase_history, products,
      audit_logs, enum_values, app_settings
    RESTART IDENTITY CASCADE
  `);

  if (process.env.RESET_USERS === "1") {
    await db.execute(sql`TRUNCATE TABLE sessions, access_logs, users RESTART IDENTITY CASCADE`);
  }

  console.log("gravando configurações padrão...");
  await db.insert(schema.appSettings).values({
    id: 1,
    healthWeights: DEFAULT_HEALTH_WEIGHTS,
    semaphoreThresholds: DEFAULT_SEMAPHORE,
    recommendationRules: DEFAULT_RECOMMENDATION_RULES,
    projectionSettings: DEFAULT_PROJECTION,
    bpDeviationLimit: DEFAULT_BP_DEVIATION_LIMIT,
    defaultCurrency: DEFAULT_CURRENCY,
  });

  console.log(`gravando ${ENUM_SEEDS.length} valores de enum...`);
  await db.insert(schema.enumValues).values(
    ENUM_SEEDS.map((e) => ({
      kind: e.kind,
      code: e.code,
      label: e.label,
      sortOrder: e.sortOrder,
      color: e.color ?? null,
      isSystem: e.isSystem ?? false,
      meta: e.meta ?? null,
    })),
  );

  const existingUsers = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
  if (existingUsers.length === 0) {
    console.log("criando usuários...");
    await db.insert(schema.users).values(
      SEED_USERS.map((u) => ({
        name: u.name,
        email: u.email,
        login: u.login,
        passwordHash: bcrypt.hashSync(u.password, BCRYPT_ROUNDS),
        role: u.role,
        active: true,
      })),
    );
    console.log("\ncredenciais do seed:");
    for (const u of SEED_USERS) {
      console.log(`  ${u.login.padEnd(8)} / ${u.password.padEnd(16)} (${u.role})`);
    }
  } else {
    console.log("usuários já existem — preservados (use RESET_USERS=1 para recriar).");
  }

  console.log("gravando pacotes padrão de tarefas...");
  await seedPackages(db);

  // Products, tasks, finance and the rest of the demo data arrive with the
  // phases that build those features; this keeps the seed honest about what
  // the application can actually render today.
  const { seedDemoData } = await import("./demo");
  await seedDemoData(db);

  await client.end();
  console.log("\nseed concluído.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
