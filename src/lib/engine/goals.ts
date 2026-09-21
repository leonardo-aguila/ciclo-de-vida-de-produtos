/**
 * Goal realization — pure functions, no database.
 *
 * This lives in the engine because two screens ask the same question: the
 * product page and the executive dashboard. They used to answer it with two
 * separate copies of the rule, and the copies drifted — the dashboard ignored
 * the goal's period and scored a product with no sales as "0% of target"
 * while its own page said "não medido". The same product read differently
 * depending on where you looked at it.
 */
import type { MonthlyPoint } from "./finance";

export type GoalPeriod = "monthly" | "quarterly" | "annual";

export type SaleForGoal = {
  newMrr: number;
  recurringRevenue: number;
  activeCustomers: number;
};

/** Months of history the goal is measured over. */
export function goalWindow(period: GoalPeriod): number {
  return period === "monthly" ? 1 : period === "quarterly" ? 3 : 12;
}

/**
 * What the product actually achieved against a goal of this type.
 *
 * Returns null when the type has no data source here (NPS, market share and
 * adoption are entered nowhere in this application) and when there is no
 * history at all — an absence of months is not a month that came in at zero,
 * and scoring it zero would punish a product for not having started yet.
 */
export function realizedForGoal(
  typeCode: string,
  series: MonthlyPoint[],
  sales: SaleForGoal[],
  period: GoalPeriod,
): number | null {
  const window = goalWindow(period);
  const lastSale = sales.length > 0 ? sales[sales.length - 1]! : null;
  const last = series.length > 0 ? series[series.length - 1]! : null;

  switch (typeCode) {
    case "new_mrr":
      if (sales.length === 0) return null;
      // Summed over the period being measured, not over the last month: a
      // quarterly target judged by one month is judged by noise.
      return sales.slice(-window).reduce((sum, sale) => sum + sale.newMrr, 0);
    case "arr":
      return lastSale ? lastSale.recurringRevenue * 12 : null;
    case "one_time_revenue":
      if (series.length === 0) return null;
      return series.slice(-window).reduce((sum, point) => sum + point.revenue, 0);
    case "customers":
      return lastSale?.activeCustomers ?? null;
    case "cost_reduction":
      // Measured as the drop in running cost against the first month.
      if (series.length < 2 || !last) return null;
      return Math.max(0, series[0]!.cost - last.cost);
    default:
      return null;
  }
}

/** The goal types this application has a data source for. */
export const MEASURABLE_GOAL_TYPES = new Set([
  "new_mrr",
  "arr",
  "one_time_revenue",
  "customers",
  "cost_reduction",
]);
