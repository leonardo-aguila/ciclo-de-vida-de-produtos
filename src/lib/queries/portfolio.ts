import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@db";
import { productDecisions, productPhaseHistory, users, type LifecyclePhase } from "@db/schema";

/**
 * Average days each phase takes across the portfolio, so a product's time in
 * phase can be read against something instead of in a vacuum.
 *
 * Only closed phases count: an open one has not finished taking however long it
 * will take, and including it would drag every average down.
 */
export async function getPortfolioPhaseAverages(): Promise<Record<string, number>> {
  const rows = await db
    .select({
      phase: productPhaseHistory.phase,
      averageDays: sql<number>`avg(${productPhaseHistory.endedAt} - ${productPhaseHistory.startedAt})::float`,
      samples: sql<number>`count(*)::int`,
    })
    .from(productPhaseHistory)
    .where(isNotNull(productPhaseHistory.endedAt))
    .groupBy(productPhaseHistory.phase);

  const averages: Record<string, number> = {};
  for (const row of rows) {
    // A negative average means inconsistent history (a phase closed before it
    // opened); showing it would be worse than showing nothing.
    if (row.samples > 0 && row.averageDays !== null && row.averageDays >= 0) {
      averages[row.phase] = row.averageDays;
    }
  }
  return averages;
}

export async function listProductDecisions(productId: string) {
  return db
    .select({
      id: productDecisions.id,
      recommended: productDecisions.recommended,
      outcome: productDecisions.outcome,
      justification: productDecisions.justification,
      metricsSnapshot: productDecisions.metricsSnapshot,
      createdAt: productDecisions.createdAt,
      decidedByName: users.name,
    })
    .from(productDecisions)
    .leftJoin(users, eq(users.id, productDecisions.decidedBy))
    .where(eq(productDecisions.productId, productId))
    .orderBy(desc(productDecisions.createdAt));
}

/** The decision already registered for this exact recommendation, if any. */
export async function getLatestDecisionFor(productId: string, recommended: LifecyclePhase | string) {
  const [row] = await db
    .select()
    .from(productDecisions)
    .where(
      and(
        eq(productDecisions.productId, productId),
        eq(productDecisions.recommended, recommended as never),
      ),
    )
    .orderBy(desc(productDecisions.createdAt))
    .limit(1);
  return row ?? null;
}
