/**
 * Health snapshots.
 *
 * One row per product per month. They exist for a single reason: the product
 * page has to answer "and how does that compare to last month?", and recomputing
 * the past is not possible for the components that have no time dimension —
 * today's task board says nothing about how execution looked in March.
 *
 * So there are two writers, and they are labelled differently:
 * - `writeCurrentSnapshot` stores the full score for the current month.
 * - `backfillFinancialSnapshots` reconstructs past months from the financial
 *   series only, and the stored components say exactly that.
 */
import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@db";
import { healthSnapshots, type HealthComponents } from "@db/schema";
import { buildMonthlySeries, roiOf, type MonthlyPoint } from "@/lib/engine/finance";
import { computeHealth } from "@/lib/engine/health";
import { toCompetence, todayIso } from "@/lib/format";
import { listFinanceEntries, listMonthlySales } from "@/lib/queries/finance";
import { getProductMetrics } from "@/lib/queries/metrics";
import { getSettings } from "@/lib/queries/settings";

/** The engine's component list in the shape the snapshot column expects. */
function toStoredComponents(
  components: { key: string; raw: number | null; weight: number; weighted: number; detail: string }[],
): HealthComponents {
  const find = (key: string) => {
    const component = components.find((item) => item.key === key);
    return {
      raw: component?.raw ?? 0,
      weighted: component?.weighted ?? 0,
      weight: component?.weight ?? 0,
      detail: component?.detail ?? "",
    };
  };

  return {
    goal: find("goal"),
    financial: find("financial"),
    execution: find("execution"),
    businessPlan: find("businessPlan"),
    risk: find("risk"),
  };
}

export async function writeCurrentSnapshot(productId: string): Promise<void> {
  const metrics = await getProductMetrics(productId);
  const competence = toCompetence(todayIso());

  const values = {
    score: Number(metrics.health.score.toFixed(2)),
    components: toStoredComponents(metrics.health.components),
    roi: metrics.summary.roi === null ? null : Number(metrics.summary.roi.toFixed(2)),
    projectedRoi:
      metrics.projection?.projectedRoi === undefined || metrics.projection?.projectedRoi === null
        ? null
        : Number(metrics.projection.projectedRoi.toFixed(2)),
    accumulatedRevenue: metrics.summary.accumulatedRevenue,
    accumulatedCost: metrics.summary.accumulatedCost,
    recommendation: metrics.recommendation.kind,
  };

  await db
    .insert(healthSnapshots)
    .values({ productId, competence, ...values })
    .onConflictDoUpdate({
      target: [healthSnapshots.productId, healthSnapshots.competence],
      set: values,
    });
}

/**
 * Rebuilds past months from the financial series and the goal, which are the
 * only components that can be evaluated as of a past date. The detail text on
 * each component says so, so nobody reads a reconstructed score as a recorded
 * one.
 */
export async function backfillFinancialSnapshots(productId: string): Promise<number> {
  const settings = await getSettings();
  const [entries, sales] = await Promise.all([
    listFinanceEntries(productId),
    listMonthlySales(productId),
  ]);

  const fullSeries = buildMonthlySeries(
    sales.map((sale) => ({
      competence: sale.competence,
      newMrr: sale.newMrr,
      recurringRevenue: sale.recurringRevenue,
      oneTimeRevenue: sale.oneTimeRevenue,
      churnAmount: sale.churnAmount,
      activeCustomers: sale.activeCustomers,
    })),
    entries.map((entry) => ({
      competenceDate: entry.competenceDate,
      amount: entry.amount,
      isVariable: entry.isVariable,
      typeCode: entry.typeCode,
    })),
  );

  const currentCompetence = toCompetence(todayIso());
  const past = fullSeries.filter((point) => point.competence < currentCompetence);
  if (past.length === 0) return 0;

  const rows = past.map((point: MonthlyPoint) => {
    const roi = roiOf(point.accumulatedRevenue, point.accumulatedCost);

    const health = computeHealth(
      {
        goal: { realized: null, target: null },
        financial: {
          roi,
          contributionMargin: point.contributionMargin,
          revenue: point.revenue,
        },
        execution: { actualProgress: 0, expectedProgress: 0, lateTasks: 0, totalTasks: 0 },
        businessPlan: { accumulatedDeviationPct: null },
        risk: { overdueActionPlans: 0, untreatedCriticalInsights: 0 },
      },
      settings.healthWeights,
      settings.semaphoreThresholds,
    );

    const components = toStoredComponents(health.components);
    components.financial.detail = `Reconstruído a partir do histórico financeiro: ${components.financial.detail}`;
    components.execution.detail = "Não reconstruído: a execução não tem histórico por mês.";
    components.goal.detail = "Não reconstruído: a meta é medida sobre o estado atual.";
    components.businessPlan.detail = "Não reconstruído.";
    components.risk.detail = "Não reconstruído.";

    return {
      productId,
      competence: point.competence,
      score: Number(health.score.toFixed(2)),
      components,
      roi: roi === null ? null : Number(roi.toFixed(2)),
      projectedRoi: null,
      accumulatedRevenue: point.accumulatedRevenue,
      accumulatedCost: point.accumulatedCost,
      recommendation: null,
    };
  });

  await db
    .insert(healthSnapshots)
    .values(rows)
    .onConflictDoNothing({
      target: [healthSnapshots.productId, healthSnapshots.competence],
    });

  return rows.length;
}

/** The most recent snapshot strictly before `competence`. */
export async function getPreviousSnapshot(productId: string, competence: string) {
  const [row] = await db
    .select()
    .from(healthSnapshots)
    .where(
      and(eq(healthSnapshots.productId, productId), lt(healthSnapshots.competence, competence)),
    )
    .orderBy(desc(healthSnapshots.competence))
    .limit(1);
  return row ?? null;
}

/** Variation of the score against the previous month, in points. */
export async function getHealthDelta(
  productId: string,
  currentScore: number,
): Promise<number | null> {
  const previous = await getPreviousSnapshot(productId, toCompetence(todayIso()));
  if (!previous) return null;
  return currentScore - previous.score;
}
