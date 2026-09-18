import { asc, eq } from "drizzle-orm";
import { db } from "@db";
import { enumValues, insights, tasks, users } from "@db/schema";
import { insightScore, type InsightRow } from "@/lib/engine/insights";

export type { InsightRow };

export async function listInsights(productId: string): Promise<InsightRow[]> {
  const rows = await db
    .select({
      id: insights.id,
      title: insights.title,
      description: insights.description,
      originId: insights.originId,
      originLabel: enumValues.label,
      ownerId: insights.ownerId,
      ownerName: users.name,
      insightDate: insights.insightDate,
      status: insights.status,
      effort: insights.effort,
      impact: insights.impact,
    })
    .from(insights)
    .leftJoin(enumValues, eq(enumValues.id, insights.originId))
    .leftJoin(users, eq(users.id, insights.ownerId))
    .where(eq(insights.productId, productId))
    .orderBy(asc(insights.insightDate));

  const converted = await db
    .select({ originInsightId: tasks.originInsightId })
    .from(tasks)
    .where(eq(tasks.productId, productId));

  const counts = new Map<string, number>();
  for (const task of converted) {
    if (task.originInsightId) {
      counts.set(task.originInsightId, (counts.get(task.originInsightId) ?? 0) + 1);
    }
  }

  return rows.map((row) => ({
    ...row,
    score: insightScore(row.effort, row.impact),
    taskCount: counts.get(row.id) ?? 0,
  }));
}
