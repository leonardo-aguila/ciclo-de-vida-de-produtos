/**
 * The executive dashboard's data, assembled in bulk.
 *
 * Calling `getProductMetrics` once per product would be a query storm; here the
 * rows are loaded once for the whole portfolio and the engine runs per product
 * over the slices. The numbers are the same — it is the same engine.
 */
import { and, desc, eq, inArray, lt, ne } from "drizzle-orm";
import { db } from "@db";
import {
  actionPlans,
  businessPlanMonths,
  businessPlans,
  enumValues,
  healthSnapshots,
  insights,
  milestones,
  productDecisions,
  productGoals,
  productPhaseHistory,
  products,
  users,
  type LifecyclePhase,
  type RecommendationValue,
} from "@db/schema";
import {
  averageMomGrowth,
  buildMonthlySeries,
  consecutiveDecliningMonths,
  consecutiveNegativeMarginMonths,
  payback as computePayback,
  summarize,
  type MonthlyPoint,
} from "@/lib/engine/finance";
import {
  MEASURABLE_GOAL_TYPES,
  realizedForGoal,
  realizedFromMeasurements,
} from "@/lib/engine/goals";
import { computeHealth } from "@/lib/engine/health";
import { projectRoi } from "@/lib/engine/projection";
import { recommend } from "@/lib/engine/recommendation";
import { accumulatedDeviation, comparePlan, milestoneProgress } from "@/lib/engine/business-plan";
import { countLateTasks, expectedProgress, overallProgress } from "@/lib/engine/schedule";
import { daysBetween, toCompetence, todayIso } from "@/lib/format";
import { listFinanceEntriesFor, listMonthlySalesFor } from "./finance";
import { listGoalMeasurements } from "./products";
import { listTasksFor } from "./tasks";
import { getSettings } from "./settings";

export type PortfolioProduct = {
  id: string;
  code: string;
  name: string;
  phase: LifecyclePhase;
  status: "active" | "paused" | "discontinued";
  ownerId: string | null;
  ownerName: string | null;
  categoryId: string | null;
  categoryLabel: string | null;
  startDate: string;
  health: number;
  healthDelta: number | null;
  semaphore: "green" | "amber" | "red";
  /** False when too little could be measured for the score to mean anything. */
  healthMeasured: boolean;
  roi: number | null;
  projectedRoi: number | null;
  accumulatedRevenue: number;
  accumulatedCost: number;
  monthlyRevenue: number;
  goalTarget: number | null;
  goalRealized: number | null;
  goalAttainment: number | null;
  goalTypeLabel: string | null;
  recommendation: RecommendationValue;
  recommendationRationale: string[];
  lateTasks: number;
  overdueActionPlans: number;
  lateMilestones: number;
  planDeviation: number | null;
  /** Whether a decision was already recorded for the current recommendation. */
  decisionRegistered: boolean;
};

export type PhaseSummary = {
  phase: LifecyclePhase;
  count: number;
  revenue: number;
  /** Average days products spent in this phase, across closed passages. */
  averageDays: number | null;
};

export type PortfolioOverview = {
  products: PortfolioProduct[];
  totals: {
    products: number;
    revenue: number;
    cost: number;
    roi: number | null;
    red: number;
    /** Products with too little data for their health to be computed. */
    unmeasured: number;
    goalTarget: number;
    goalRealized: number;
    goalAttainment: number | null;
  };
  phases: PhaseSummary[];
  today: string;
};

export type PortfolioFilters = {
  phase?: LifecyclePhase;
  ownerId?: string;
  categoryId?: string;
  /** Inclusive competence bounds, "YYYY-MM-01". */
  from?: string;
  to?: string;
};

/** Trims a monthly series to the filtered period, keeping the accumulation right. */
function sliceSeries(series: MonthlyPoint[], from?: string, to?: string): MonthlyPoint[] {
  if (!from && !to) return series;
  return series.filter(
    (point) => (!from || point.competence >= from) && (!to || point.competence <= to),
  );
}

export async function getPortfolioOverview(
  filters: PortfolioFilters = {},
): Promise<PortfolioOverview> {
  const today = todayIso();
  const settings = await getSettings();

  const conditions = [];
  if (filters.phase) conditions.push(eq(products.phase, filters.phase));
  if (filters.ownerId) conditions.push(eq(products.ownerId, filters.ownerId));
  if (filters.categoryId) conditions.push(eq(products.categoryId, filters.categoryId));

  const rows = await db
    .select({
      product: products,
      ownerName: users.name,
      categoryLabel: enumValues.label,
    })
    .from(products)
    .leftJoin(users, eq(users.id, products.ownerId))
    .leftJoin(enumValues, eq(enumValues.id, products.categoryId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(products.name);

  if (rows.length === 0) {
    return {
      products: [],
      totals: {
        products: 0,
        revenue: 0,
        cost: 0,
        roi: null,
        red: 0,
        unmeasured: 0,
        goalTarget: 0,
        goalRealized: 0,
        goalAttainment: null,
      },
      phases: [],
      today,
    };
  }

  const ids = rows.map((row) => row.product.id);

  // Everything the engine needs, in one round of queries.
  const [sales, entries, tasks, goals, plans, planMonths, planMilestones, overduePlans, criticalInsights, snapshots, decisions, history] =
    await Promise.all([
      listMonthlySalesFor(ids),
      listFinanceEntriesFor(ids),
      listTasksFor(ids),
      db
        .select({
          id: productGoals.id,
          productId: productGoals.productId,
          targetValue: productGoals.targetValue,
          period: productGoals.period,
          deadline: productGoals.deadline,
          code: enumValues.code,
          label: enumValues.label,
        })
        .from(productGoals)
        .leftJoin(enumValues, eq(enumValues.id, productGoals.goalTypeId))
        .where(and(inArray(productGoals.productId, ids), eq(productGoals.isPrimary, true))),
      db
        .select()
        .from(businessPlans)
        .where(and(inArray(businessPlans.productId, ids), eq(businessPlans.status, "active"))),
      db.select().from(businessPlanMonths),
      db.select().from(milestones),
      db
        .select({ productId: actionPlans.productId })
        .from(actionPlans)
        .where(
          and(
            inArray(actionPlans.productId, ids),
            lt(actionPlans.dueDate, today),
            ne(actionPlans.status, "done"),
            ne(actionPlans.status, "cancelled"),
          ),
        ),
      db
        .select({ productId: insights.productId })
        .from(insights)
        .where(
          and(
            inArray(insights.productId, ids),
            inArray(insights.status, ["new", "under_analysis"]),
            eq(insights.impact, 10),
          ),
        ),
      db
        .select()
        .from(healthSnapshots)
        .where(inArray(healthSnapshots.productId, ids))
        .orderBy(desc(healthSnapshots.competence)),
      db
        .select()
        .from(productDecisions)
        .where(inArray(productDecisions.productId, ids))
        .orderBy(desc(productDecisions.createdAt)),
      db
        .select()
        .from(productPhaseHistory)
        .where(inArray(productPhaseHistory.productId, ids)),
    ]);

  // As apurações manuais das metas principais, numa consulta só para os
  // produtos do recorte — uma por produto seria N+1 no painel.
  const measurements = await listGoalMeasurements(ids);

  const currentCompetence = toCompetence(today);
  const phaseDays = new Map<LifecyclePhase, number[]>();
  for (const entry of history) {
    if (!entry.endedAt) continue;
    const days = daysBetween(entry.startedAt, entry.endedAt);
    if (days < 0) continue;
    phaseDays.set(entry.phase, [...(phaseDays.get(entry.phase) ?? []), days]);
  }

  const portfolio: PortfolioProduct[] = rows.map(({ product, ownerName, categoryLabel }) => {
    const productSales = sales.filter((sale) => sale.productId === product.id);
    const productEntries = entries.filter((entry) => entry.productId === product.id);
    const productTasks = tasks.filter((task) => task.productId === product.id);

    const fullSeries = buildMonthlySeries(
      productSales.map((sale) => ({
        competence: sale.competence,
        newMrr: sale.newMrr,
        recurringRevenue: sale.recurringRevenue,
        oneTimeRevenue: sale.oneTimeRevenue,
        churnAmount: sale.churnAmount,
        activeCustomers: sale.activeCustomers,
      })),
      productEntries.map((entry) => ({
        competenceDate: entry.competenceDate,
        amount: entry.amount,
        isVariable: entry.isVariable,
        typeCode: entry.typeCode ?? "other",
      })),
    );

    const series = sliceSeries(fullSeries, filters.from, filters.to);
    const summary = summarize(series);
    const projection = projectRoi(series, settings.projectionSettings);

    const goal = goals.find((row) => row.productId === product.id) ?? null;
    // Same functions the product page uses — see engine/goals.ts for why this
    // is not written inline here. A escolha da fonte é a mesma dos dois lados:
    // tipo derivado lê a série, o resto lê a apuração digitada.
    const goalRealized = !goal
      ? null
      : MEASURABLE_GOAL_TYPES.has(goal.code ?? "")
        ? realizedForGoal(goal.code ?? "", series, productSales, goal.period)
        : (realizedFromMeasurements(
            measurements.filter((row) => row.goalId === goal.id),
            goal.period,
            today,
          )?.value ?? null);

    const plan = plans.find((row) => row.productId === product.id) ?? null;
    const planRows = plan
      ? comparePlan(
          planMonths
            .filter((month) => month.planId === plan.id)
            .map((month) => ({
              competence: month.competence,
              plannedRevenue: month.plannedRevenue,
              plannedCost: month.plannedCost,
              plannedCustomers: month.plannedCustomers,
              plannedMargin: month.plannedMargin,
            })),
          series,
          { redThreshold: settings.bpDeviationLimit },
        )
      : [];

    const milestoneStats = plan
      ? milestoneProgress(
          planMilestones.filter((milestone) => milestone.planId === plan.id),
          today,
        )
      : { total: 0, done: 0, late: 0, percent: 0 };

    const overdue = overduePlans.filter((row) => row.productId === product.id).length;
    const critical = criticalInsights.filter((row) => row.productId === product.id).length;

    const totalTasks = productTasks.length;
    const health = computeHealth(
      {
        goal: {
          realized: goalRealized,
          target: goal?.targetValue ?? null,
          typeCode: goal?.code ?? undefined,
        },
        financial: {
          roi: summary.roi,
          contributionMargin: summary.lastMargin,
          revenue: series.length > 0 ? series[series.length - 1]!.revenue : null,
        },
        execution: {
          actualProgress: overallProgress(productTasks),
          expectedProgress: expectedProgress(productTasks, today),
          lateTasks: countLateTasks(productTasks, today),
          totalTasks,
        },
        businessPlan: { accumulatedDeviationPct: accumulatedDeviation(planRows) },
        risk: { overdueActionPlans: overdue, untreatedCriticalInsights: critical },
      },
      settings.healthWeights,
      settings.semaphoreThresholds,
    );

    const previousSnapshot = snapshots.find(
      (snapshot) =>
        snapshot.productId === product.id && snapshot.competence < currentCompetence,
    );

    const recommendation = recommend(
      {
        health: health.score,
        healthMeasured: health.measured,
        roi: summary.roi,
        projectedRoi: projection?.projectedRoi ?? null,
        momGrowth: averageMomGrowth(series, 3),
        decliningMonths: consecutiveDecliningMonths(series),
        negativeMarginMonths: consecutiveNegativeMarginMonths(series),
        goalReached:
          goalRealized === null || !goal?.targetValue
            ? null
            : goalRealized >= goal.targetValue,
        paybackCompetence: computePayback(series, settings.projectionSettings.windowMonths)
          .competence,
        goalDeadline: goal?.deadline ?? null,
      },
      settings.recommendationRules,
    );

    return {
      id: product.id,
      code: product.code,
      name: product.name,
      phase: product.phase,
      status: product.status,
      ownerId: product.ownerId,
      ownerName,
      categoryId: product.categoryId,
      categoryLabel,
      startDate: product.startDate,
      health: health.score,
      healthDelta: previousSnapshot ? health.score - previousSnapshot.score : null,
      semaphore: health.semaphore,
      healthMeasured: health.measured,
      roi: summary.roi,
      projectedRoi: projection?.projectedRoi ?? null,
      accumulatedRevenue: summary.accumulatedRevenue,
      accumulatedCost: summary.accumulatedCost,
      monthlyRevenue: series.length > 0 ? series[series.length - 1]!.revenue : 0,
      goalTarget: goal?.targetValue ?? null,
      goalRealized,
      goalAttainment:
        goalRealized === null || !goal?.targetValue
          ? null
          : (goalRealized / goal.targetValue) * 100,
      goalTypeLabel: goal?.label ?? null,
      recommendation: recommendation.kind,
      recommendationRationale: recommendation.rationale,
      lateTasks: countLateTasks(productTasks, today),
      overdueActionPlans: overdue,
      lateMilestones: milestoneStats.late,
      planDeviation: accumulatedDeviation(planRows),
      decisionRegistered: decisions.some(
        (decision) =>
          decision.productId === product.id && decision.recommended === recommendation.kind,
      ),
    };
  });

  const revenue = portfolio.reduce((sum, product) => sum + product.accumulatedRevenue, 0);
  const cost = portfolio.reduce((sum, product) => sum + product.accumulatedCost, 0);

  // Only products whose goal can actually be measured enter the aggregate.
  // Counting the target of a product that has not started selling, with
  // nothing on the realized side, makes the portfolio look like it is missing
  // a goal it simply cannot measure yet.
  const comparableGoals = portfolio.filter(
    (product) => product.goalTarget !== null && product.goalRealized !== null,
  );
  const goalTarget = comparableGoals.reduce((sum, product) => sum + product.goalTarget!, 0);
  const goalRealized = comparableGoals.reduce((sum, product) => sum + product.goalRealized!, 0);

  const phaseList = Array.from(new Set(portfolio.map((product) => product.phase)));
  const phases: PhaseSummary[] = phaseList.map((phase) => {
    const inPhase = portfolio.filter((product) => product.phase === phase);
    const samples = phaseDays.get(phase) ?? [];
    return {
      phase,
      count: inPhase.length,
      revenue: inPhase.reduce((sum, product) => sum + product.accumulatedRevenue, 0),
      averageDays:
        samples.length > 0
          ? samples.reduce((sum, days) => sum + days, 0) / samples.length
          : null,
    };
  });

  return {
    products: portfolio,
    totals: {
      products: portfolio.length,
      revenue,
      cost,
      // Consolidated ROI is computed over the portfolio totals, not as an
      // average of each product's ROI — averaging percentages would let a tiny
      // product with a huge ratio dominate the number.
      roi: cost > 0 ? ((revenue - cost) / cost) * 100 : null,
      // Only products whose health could actually be measured count as red: a
      // brand-new product has no score to be red about.
      red: portfolio.filter((product) => product.healthMeasured && product.semaphore === "red")
        .length,
      unmeasured: portfolio.filter((product) => !product.healthMeasured).length,
      goalTarget,
      goalRealized,
      goalAttainment: goalTarget > 0 ? (goalRealized / goalTarget) * 100 : null,
    },
    phases,
    today,
  };
}
