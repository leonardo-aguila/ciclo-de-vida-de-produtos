/**
 * The bridge between the database and the engine.
 *
 * Everything the product page and the executive dashboard show comes from here:
 * load the rows once, run the pure functions, return one object. No component
 * queries the database on its own, and no calculation happens in a component.
 */
import { and, eq, inArray, lt, ne } from "drizzle-orm";
import { db } from "@db";
import {
  actionPlans,
  businessPlanMonths,
  businessPlans,
  insights,
  milestones,
  productGoals,
  products,
  type LifecyclePhase,
  type MonthlySale,
  type RecommendationValue,
} from "@db/schema";
import {
  buildMonthlySeries,
  payback as computePayback,
  summarize,
  annualizedMaintenanceCost,
  annualizedRevenue,
  averageMomGrowth,
  consecutiveDecliningMonths,
  consecutiveNegativeMarginMonths,
  revenueStability,
  type MonthlyPoint,
} from "@/lib/engine/finance";
import {
  type GoalMeasurement,
  MEASURABLE_GOAL_TYPES,
  realizedForGoal,
  realizedFromMeasurements,
} from "@/lib/engine/goals";
import { projectRoi, type Projection } from "@/lib/engine/projection";
import { computeHealth, type HealthResult } from "@/lib/engine/health";
import { recommend, type Recommendation } from "@/lib/engine/recommendation";
import {
  accumulatedDeviation,
  checkDeviationTrigger,
  comparePlan,
  milestoneProgress,
  type DeviationTrigger,
  type PlanComparisonRow,
} from "@/lib/engine/business-plan";
import {
  countLateTasks,
  dueWithin,
  expectedProgress,
  overallProgress,
  scheduleDeviationDays,
  sCurve,
} from "@/lib/engine/schedule";
import { daysBetween, toCompetence as toCompetenceOf, todayIso } from "@/lib/format";
import { listFinanceEntries, listMonthlySales } from "./finance";
import { getPhaseHistory, getProductGoals, listGoalMeasurements } from "./products";
import { listTasks, type TaskRow } from "./tasks";
import { getSettings } from "./settings";

export type GoalProgress = {
  id: string;
  typeCode: string;
  typeLabel: string;
  target: number;
  unit: string | null;
  period: "monthly" | "quarterly" | "annual";
  deadline: string | null;
  /** null quando não há como medir: sem histórico, ou sem apuração válida. */
  realized: number | null;
  attainmentPct: number | null;
  reached: boolean | null;
  /** O tipo não é derivado pela aplicação: o realizado vem de apuração manual. */
  manual: boolean;
  /** A competência da apuração usada, quando o realizado veio de uma. */
  measuredAt: string | null;
  /** As apurações manuais da meta, da mais antiga para a mais recente. */
  measurements: { id: string; competence: string; value: number; note: string | null }[];
};

export type PhaseDuration = { phase: LifecyclePhase; days: number; current: boolean };

export type ProductMetrics = {
  productId: string;
  series: MonthlyPoint[];
  summary: ReturnType<typeof summarize>;
  payback: ReturnType<typeof computePayback>;
  projection: Projection | null;
  health: HealthResult;
  recommendation: Recommendation;
  primaryGoal: GoalProgress | null;
  goals: GoalProgress[];
  tasks: {
    all: TaskRow[];
    total: number;
    late: number;
    progress: number;
    expected: number;
    scheduleDeviationDays: number | null;
    dueIn7: number;
    dueIn15: number;
    dueIn30: number;
    byStatus: Record<string, number>;
    curve: { date: string; planned: number; actual: number }[];
  };
  trend: {
    momGrowth: number | null;
    decliningMonths: number;
    negativeMarginMonths: number;
    stability3m: number | null;
    annualizedRevenue: number;
    annualizedMaintenanceCost: number;
  };
  plan: {
    planId: string | null;
    version: number | null;
    rows: PlanComparisonRow[];
    accumulatedDeviation: number | null;
    trigger: DeviationTrigger;
    milestones: ReturnType<typeof milestoneProgress>;
  };
  risk: {
    overdueActionPlans: number;
    untreatedCriticalInsights: number;
  };
  costs: {
    byType: { code: string; label: string; total: number }[];
    capex: number;
    opex: number;
    investment: number;
    /** Entries categorised as marketing or sales, over the last 3 months. */
    acquisitionLast3m: number;
  };
  insights: {
    total: number;
    validated: number;
    quickWins: number;
    byStatus: Record<string, number>;
  };
  effort: {
    estimatedHours: number;
    doneHours: number;
  };
  /** Customer acquisition cost, null when there is nothing to divide. */
  cac: number | null;
  phases: PhaseDuration[];
  today: string;
};


function toGoalProgress(
  goal: {
    id: string;
    goalTypeCode: string | null;
    goalTypeLabel: string | null;
    targetValue: number;
    unit: string | null;
    period: "monthly" | "quarterly" | "annual";
    deadline: string | null;
  },
  series: MonthlyPoint[],
  sales: MonthlySale[],
  measurements: (GoalMeasurement & { id: string; note: string | null })[],
  today: string,
): GoalProgress {
  const typeCode = goal.goalTypeCode ?? "";
  // Um tipo só tem uma fonte. Derivado lê a série; o resto lê a apuração
  // digitada. Aceitar as duas criaria dois realizados para a mesma meta, e a
  // tela teria de escolher um sem ter como justificar a escolha.
  const manual = !MEASURABLE_GOAL_TYPES.has(typeCode);
  const measured = manual ? realizedFromMeasurements(measurements, goal.period, today) : null;
  const realized = manual
    ? (measured?.value ?? null)
    : realizedForGoal(typeCode, series, sales, goal.period);
  const attainmentPct =
    realized === null || goal.targetValue <= 0 ? null : (realized / goal.targetValue) * 100;

  return {
    id: goal.id,
    typeCode: goal.goalTypeCode ?? "",
    typeLabel: goal.goalTypeLabel ?? "—",
    target: goal.targetValue,
    unit: goal.unit,
    period: goal.period,
    deadline: goal.deadline,
    realized,
    attainmentPct,
    reached: attainmentPct === null ? null : attainmentPct >= 100,
    manual,
    measuredAt: measured?.competence ?? null,
    measurements: measurements.map((row) => ({
      id: row.id,
      competence: row.competence,
      value: row.value,
      note: row.note,
    })),
  };
}

/** Days spent in each phase, from the history, closing the open one at today. */
function phaseDurations(
  history: { phase: LifecyclePhase; startedAt: string; endedAt: string | null }[],
  today: string,
): PhaseDuration[] {
  return history.map((entry) => ({
    phase: entry.phase,
    days: Math.max(0, daysBetween(entry.startedAt, entry.endedAt ?? today)),
    current: entry.endedAt === null,
  }));
}

export async function getProductMetrics(productId: string): Promise<ProductMetrics> {
  const today = todayIso();
  const settings = await getSettings();

  const [entries, sales, tasks, goals, history] = await Promise.all([
    listFinanceEntries(productId),
    listMonthlySales(productId),
    listTasks(productId),
    getProductGoals(productId),
    getPhaseHistory(productId),
  ]);

  const series = buildMonthlySeries(
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

  const summary = summarize(series);
  const payback = computePayback(series, settings.projectionSettings.windowMonths);
  const projection = projectRoi(series, settings.projectionSettings);

  const measurements = await listGoalMeasurements([productId]);
  const goalProgress = goals.map((goal) =>
    toGoalProgress(
      goal,
      series,
      sales,
      measurements.filter((row) => row.goalId === goal.id),
      today,
    ),
  );
  const primaryGoal =
    goalProgress.find((goal) => goals.find((g) => g.id === goal.id)?.isPrimary) ?? null;

  // The active plan, if any.
  const [activePlan] = await db
    .select()
    .from(businessPlans)
    .where(and(eq(businessPlans.productId, productId), eq(businessPlans.status, "active")))
    .limit(1);

  const plannedMonths = activePlan
    ? await db
        .select()
        .from(businessPlanMonths)
        .where(eq(businessPlanMonths.planId, activePlan.id))
    : [];

  const planRows = comparePlan(
    plannedMonths.map((month) => ({
      competence: month.competence,
      plannedRevenue: month.plannedRevenue,
      plannedCost: month.plannedCost,
      plannedCustomers: month.plannedCustomers,
      plannedMargin: month.plannedMargin,
    })),
    series,
    { redThreshold: settings.bpDeviationLimit },
  );

  const planMilestones = activePlan
    ? await db.select().from(milestones).where(eq(milestones.planId, activePlan.id))
    : [];

  // Risk: overdue action plans and critical insights nobody has touched.
  const overduePlans = await db
    .select({ id: actionPlans.id })
    .from(actionPlans)
    .where(
      and(
        eq(actionPlans.productId, productId),
        lt(actionPlans.dueDate, today),
        ne(actionPlans.status, "done"),
        ne(actionPlans.status, "cancelled"),
      ),
    );

  const criticalInsights = await db
    .select({ id: insights.id })
    .from(insights)
    .where(
      and(
        eq(insights.productId, productId),
        inArray(insights.status, ["new", "under_analysis"]),
        // "Critical" here means high impact with low effort left untouched.
        eq(insights.impact, 10),
      ),
    );

  const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);

  const totalTasks = tasks.length;
  const actualProgress = overallProgress(tasks);
  const expected = expectedProgress(tasks, today);
  const lateTasks = countLateTasks(tasks, today);

  const byStatus: Record<string, number> = {};
  for (const task of tasks) byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;

  const health = computeHealth(
    {
      goal: {
        realized: primaryGoal?.realized ?? null,
        target: primaryGoal?.target ?? null,
        typeCode: primaryGoal?.typeCode,
      },
      financial: {
        roi: summary.roi,
        contributionMargin: summary.lastMargin,
        revenue: series.length > 0 ? series[series.length - 1]!.revenue : null,
      },
      execution: {
        actualProgress,
        expectedProgress: expected,
        lateTasks,
        totalTasks,
      },
      businessPlan: { accumulatedDeviationPct: accumulatedDeviation(planRows) },
      risk: {
        overdueActionPlans: overduePlans.length,
        untreatedCriticalInsights: criticalInsights.length,
      },
    },
    settings.healthWeights,
    settings.semaphoreThresholds,
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
      goalReached: primaryGoal?.reached ?? null,
      paybackCompetence: payback.competence,
      goalDeadline: primaryGoal?.deadline ?? null,
    },
    settings.recommendationRules,
  );

  const curveDates = series.map((point) => point.competence);

  // Cost breakdown by type, and the acquisition spend the CAC divides.
  const byTypeMap = new Map<string, { label: string; total: number }>();
  for (const entry of entries) {
    const current = byTypeMap.get(entry.typeCode) ?? { label: entry.typeLabel, total: 0 };
    byTypeMap.set(entry.typeCode, { label: current.label, total: current.total + entry.amount });
  }

  const threeMonthsAgo = series.length >= 3 ? series[series.length - 3]!.competence : null;
  const acquisitionLast3m = entries
    .filter((entry) => {
      if (!threeMonthsAgo) return false;
      if (toCompetenceOf(entry.competenceDate) < threeMonthsAgo) return false;
      return /market|comerc|vendas|publicid/i.test(entry.category ?? "");
    })
    .reduce((sum, entry) => sum + entry.amount, 0);

  const newCustomersLast3m = sales
    .slice(-3)
    .reduce((sum, sale) => sum + sale.newCustomers, 0);

  const insightRows = await db
    .select({ status: insights.status, effort: insights.effort, impact: insights.impact })
    .from(insights)
    .where(eq(insights.productId, productId));

  const insightsByStatus: Record<string, number> = {};
  for (const insight of insightRows) {
    insightsByStatus[insight.status] = (insightsByStatus[insight.status] ?? 0) + 1;
  }

  return {
    productId,
    series,
    summary,
    payback,
    projection,
    health,
    recommendation,
    primaryGoal,
    goals: goalProgress,
    tasks: {
      all: tasks,
      total: totalTasks,
      late: lateTasks,
      progress: actualProgress,
      expected,
      scheduleDeviationDays: scheduleDeviationDays(product?.plannedLaunchDate, tasks),
      dueIn7: dueWithin(tasks, today, 7).length,
      dueIn15: dueWithin(tasks, today, 15).length,
      dueIn30: dueWithin(tasks, today, 30).length,
      byStatus,
      curve: sCurve(tasks, curveDates.length > 0 ? curveDates : [today]),
    },
    trend: {
      momGrowth: averageMomGrowth(series, 3),
      decliningMonths: consecutiveDecliningMonths(series),
      negativeMarginMonths: consecutiveNegativeMarginMonths(series),
      stability3m: revenueStability(series, 3),
      annualizedRevenue: annualizedRevenue(series),
      annualizedMaintenanceCost: annualizedMaintenanceCost(series),
    },
    plan: {
      planId: activePlan?.id ?? null,
      version: activePlan?.version ?? null,
      rows: planRows,
      accumulatedDeviation: accumulatedDeviation(planRows),
      trigger: checkDeviationTrigger(planRows, settings.bpDeviationLimit),
      milestones: milestoneProgress(planMilestones, today),
    },
    risk: {
      overdueActionPlans: overduePlans.length,
      untreatedCriticalInsights: criticalInsights.length,
    },
    costs: {
      byType: Array.from(byTypeMap.entries())
        .map(([code, value]) => ({ code, label: value.label, total: value.total }))
        .sort((a, b) => b.total - a.total),
      capex: byTypeMap.get("capex")?.total ?? 0,
      opex: byTypeMap.get("opex")?.total ?? 0,
      investment: byTypeMap.get("investment")?.total ?? 0,
      acquisitionLast3m,
    },
    insights: {
      total: insightRows.length,
      // "Validated" means it got past analysis: approved, running or done.
      validated: insightRows.filter((insight) =>
        ["approved", "in_progress", "done"].includes(insight.status),
      ).length,
      quickWins: insightRows.filter((insight) => insight.impact >= 7 && insight.effort <= 4).length,
      byStatus: insightsByStatus,
    },
    effort: {
      estimatedHours: tasks.reduce((sum, task) => sum + (task.estimatedHours ?? 0), 0),
      doneHours: tasks.reduce(
        (sum, task) => sum + ((task.estimatedHours ?? 0) * task.progress) / 100,
        0,
      ),
    },
    cac: newCustomersLast3m > 0 && acquisitionLast3m > 0
      ? acquisitionLast3m / newCustomersLast3m
      : null,
    phases: phaseDurations(history, today),
    today,
  };
}

/** Lightweight shape the executive dashboard needs for every product at once. */
export type PortfolioRow = {
  productId: string;
  code: string;
  name: string;
  phase: LifecyclePhase;
  status: "active" | "paused" | "discontinued";
  ownerName: string | null;
  categoryLabel: string | null;
  health: number;
  semaphore: "green" | "amber" | "red";
  healthDelta: number | null;
  roi: number | null;
  projectedRoi: number | null;
  accumulatedRevenue: number;
  accumulatedCost: number;
  goalAttainment: number | null;
  recommendation: RecommendationValue;
  lateTasks: number;
};

export async function getPrimaryGoalId(productId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: productGoals.id })
    .from(productGoals)
    .where(and(eq(productGoals.productId, productId), eq(productGoals.isPrimary, true)))
    .limit(1);
  return row?.id ?? null;
}
