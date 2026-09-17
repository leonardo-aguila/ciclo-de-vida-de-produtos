/**
 * Business plan versus reality — pure functions, no database.
 *
 * The deviation computed here drives three things: the plan tab's traffic
 * lights, the action-plan trigger, and one component of the Health Score.
 */
import type { MonthlyPoint } from "./finance";

export type PlannedMonth = {
  competence: string;
  plannedRevenue: number;
  plannedCost: number;
  plannedCustomers: number;
  plannedMargin: number;
};

export type PlanComparisonRow = {
  competence: string;
  plannedRevenue: number;
  actualRevenue: number;
  /** Actual minus planned, in currency. */
  revenueDeviation: number;
  /** Deviation as a percentage of the plan; null when the plan is zero. */
  revenueDeviationPct: number | null;
  plannedCost: number;
  actualCost: number;
  costDeviation: number;
  costDeviationPct: number | null;
  accumulatedPlannedRevenue: number;
  accumulatedActualRevenue: number;
  accumulatedDeviationPct: number | null;
  /** Green, amber or red for this month's revenue line. */
  status: "green" | "amber" | "red";
  /** False for months that are still in the future. */
  hasActual: boolean;
};

function pct(actual: number, planned: number): number | null {
  // A plan of zero has no percentage: any actual is infinitely above it.
  if (planned === 0) return null;
  return ((actual - planned) / Math.abs(planned)) * 100;
}

/**
 * Month-by-month and accumulated comparison.
 *
 * Months beyond the last actual competence are marked `hasActual: false` and
 * left out of the accumulated deviation — counting a month that has not
 * happened as a 100% shortfall would make every plan look catastrophic.
 */
export function comparePlan(
  planned: PlannedMonth[],
  series: MonthlyPoint[],
  options: { amberThreshold?: number; redThreshold?: number; today?: string } = {},
): PlanComparisonRow[] {
  const amber = options.amberThreshold ?? -5;
  const red = options.redThreshold ?? -15;

  const actualByCompetence = new Map(series.map((point) => [point.competence, point]));
  const lastActual = series.length > 0 ? series[series.length - 1]!.competence : null;

  let accumulatedPlanned = 0;
  let accumulatedActual = 0;

  return [...planned]
    .sort((a, b) => a.competence.localeCompare(b.competence))
    .map((month) => {
      const actual = actualByCompetence.get(month.competence);
      const hasActual = Boolean(lastActual && month.competence <= lastActual);

      const actualRevenue = actual?.revenue ?? 0;
      const actualCost = actual?.cost ?? 0;

      if (hasActual) {
        accumulatedPlanned += month.plannedRevenue;
        accumulatedActual += actualRevenue;
      }

      const deviationPct = hasActual ? pct(actualRevenue, month.plannedRevenue) : null;
      const status: PlanComparisonRow["status"] =
        !hasActual || deviationPct === null
          ? "green"
          : deviationPct <= red
            ? "red"
            : deviationPct <= amber
              ? "amber"
              : "green";

      return {
        competence: month.competence,
        plannedRevenue: month.plannedRevenue,
        actualRevenue,
        revenueDeviation: actualRevenue - month.plannedRevenue,
        revenueDeviationPct: deviationPct,
        plannedCost: month.plannedCost,
        actualCost,
        costDeviation: actualCost - month.plannedCost,
        costDeviationPct: hasActual ? pct(actualCost, month.plannedCost) : null,
        accumulatedPlannedRevenue: accumulatedPlanned,
        accumulatedActualRevenue: accumulatedActual,
        accumulatedDeviationPct: pct(accumulatedActual, accumulatedPlanned),
        status,
        hasActual,
      };
    });
}

/** Accumulated revenue deviation over the months that already happened. */
export function accumulatedDeviation(rows: PlanComparisonRow[]): number | null {
  const withActual = rows.filter((row) => row.hasActual);
  if (withActual.length === 0) return null;
  return withActual[withActual.length - 1]!.accumulatedDeviationPct;
}

export type DeviationTrigger = {
  triggered: boolean;
  deviation: number | null;
  limit: number;
  competence: string | null;
  message: string;
};

/**
 * Whether the accumulated deviation crossed the configured limit, which is what
 * flags the need for an action plan. It never creates anything on its own.
 */
export function checkDeviationTrigger(
  rows: PlanComparisonRow[],
  limit: number,
): DeviationTrigger {
  const deviation = accumulatedDeviation(rows);
  const withActual = rows.filter((row) => row.hasActual);
  const competence =
    withActual.length > 0 ? withActual[withActual.length - 1]!.competence : null;

  if (deviation === null) {
    return {
      triggered: false,
      deviation: null,
      limit,
      competence,
      message: "Ainda não há realizado suficiente para comparar com o plano.",
    };
  }

  const triggered = deviation <= limit;
  return {
    triggered,
    deviation,
    limit,
    competence,
    message: triggered
      ? `O desvio acumulado de ${deviation.toFixed(1).replace(".", ",")}% ultrapassou o limite de ${limit.toFixed(1).replace(".", ",")}%. Registre um plano de ação.`
      : `O desvio acumulado é de ${deviation.toFixed(1).replace(".", ",")}%, dentro do limite de ${limit.toFixed(1).replace(".", ",")}%.`,
  };
}

/** Milestone progress: how much of the plan's checkpoints is done. */
export function milestoneProgress(
  milestones: { status: "pending" | "in_progress" | "done"; targetDate: string }[],
  today: string,
): { total: number; done: number; late: number; percent: number } {
  const total = milestones.length;
  const done = milestones.filter((milestone) => milestone.status === "done").length;
  const late = milestones.filter(
    (milestone) => milestone.status !== "done" && milestone.targetDate < today,
  ).length;
  return { total, done, late, percent: total === 0 ? 0 : (done / total) * 100 };
}
