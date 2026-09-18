import { asc, desc, eq } from "drizzle-orm";
import { db } from "@db";
import {
  actionPlans,
  businessPlanMonths,
  businessPlans,
  milestones,
  users,
  type ActionPlan,
  type BusinessPlan,
  type BusinessPlanMonth,
  type Milestone,
} from "@db/schema";

export type PlanVersion = BusinessPlan & { authorName: string | null; monthCount: number };

export async function listPlanVersions(productId: string): Promise<PlanVersion[]> {
  const rows = await db
    .select({
      plan: businessPlans,
      authorName: users.name,
    })
    .from(businessPlans)
    .leftJoin(users, eq(users.id, businessPlans.authorId))
    .where(eq(businessPlans.productId, productId))
    .orderBy(desc(businessPlans.version));

  if (rows.length === 0) return [];

  const months = await db.select().from(businessPlanMonths);
  const counts = new Map<string, number>();
  for (const month of months) {
    counts.set(month.planId, (counts.get(month.planId) ?? 0) + 1);
  }

  return rows.map((row) => ({
    ...row.plan,
    authorName: row.authorName,
    monthCount: counts.get(row.plan.id) ?? 0,
  }));
}

export async function getPlanMonths(planId: string): Promise<BusinessPlanMonth[]> {
  return db
    .select()
    .from(businessPlanMonths)
    .where(eq(businessPlanMonths.planId, planId))
    .orderBy(asc(businessPlanMonths.competence));
}

export async function listMilestones(planId: string): Promise<Milestone[]> {
  return db
    .select()
    .from(milestones)
    .where(eq(milestones.planId, planId))
    .orderBy(asc(milestones.targetDate));
}

export type ActionPlanRow = ActionPlan & { ownerName: string | null };

export async function listActionPlans(productId: string): Promise<ActionPlanRow[]> {
  const rows = await db
    .select({ plan: actionPlans, ownerName: users.name })
    .from(actionPlans)
    .leftJoin(users, eq(users.id, actionPlans.ownerId))
    .where(eq(actionPlans.productId, productId))
    .orderBy(asc(actionPlans.dueDate));

  return rows.map((row) => ({ ...row.plan, ownerName: row.ownerName }));
}

/** Planned revenue by competence — the line the finance chart draws. */
export async function getPlannedRevenueByCompetence(
  productId: string,
): Promise<Record<string, number>> {
  const [active] = await db
    .select()
    .from(businessPlans)
    .where(eq(businessPlans.productId, productId))
    .orderBy(desc(businessPlans.version))
    .limit(1);

  if (!active) return {};

  const months = await getPlanMonths(active.id);
  return Object.fromEntries(months.map((month) => [month.competence, month.plannedRevenue]));
}
