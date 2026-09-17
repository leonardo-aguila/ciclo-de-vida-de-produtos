import { sql } from "drizzle-orm";
import { db } from "@db";
import { users, type UserRole } from "@db/schema";
import { hashPassword } from "@/lib/auth/password";

export const TEST_PASSWORD = "Senha@Teste1";

/** Wipes every table between tests; the suite runs serially on one database. */
export async function truncateAll(): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      health_snapshots, action_plans, milestones, business_plan_months, business_plans,
      monthly_sales, finance_entries, insights, task_attachments, task_comments,
      task_dependencies, tasks, task_template_dependencies, task_templates, task_packages,
      product_comments, product_decisions, product_goals, product_phase_history, products,
      audit_logs, access_logs, sessions, enum_values, app_settings, users
    RESTART IDENTITY CASCADE
  `);
}

export async function createUser(overrides: {
  login: string;
  role?: UserRole;
  password?: string;
  active?: boolean;
  name?: string;
  email?: string;
}) {
  const [user] = await db
    .insert(users)
    .values({
      name: overrides.name ?? `Usuário ${overrides.login}`,
      email: overrides.email ?? `${overrides.login}@teste.local`,
      login: overrides.login,
      passwordHash: hashPassword(overrides.password ?? TEST_PASSWORD),
      role: overrides.role ?? "collaborator",
      active: overrides.active ?? true,
    })
    .returning();
  return user!;
}
