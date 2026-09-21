/**
 * Projection — pure functions, no database.
 *
 * Simple linear regression over recent revenue plus a moving average of running
 * cost. Everything returns the window it used, because a projected number
 * printed without its assumptions is read as a fact.
 */
import { addMonthsToCompetence } from "@/lib/format";
import type { MonthlyPoint } from "./finance";

export type Trend = {
  /** Revenue change per month, in currency. */
  slope: number;
  intercept: number;
  /** 0..1 — how well the line explains the data. Low means "do not trust it". */
  rSquared: number;
  windowMonths: number;
};

/** Least squares over the last `windowMonths` points, x = 0,1,2… */
export function revenueTrend(series: MonthlyPoint[], windowMonths = 6): Trend | null {
  const window = series.slice(-windowMonths);
  // Two points make a line but say nothing about a trend; three is the floor.
  if (window.length < 3) return null;
  // A window with no revenue at all is not a flat trend — it is a product that
  // has not started selling. Extrapolating those zeros forward would hand a
  // pre-launch product a confident ROI of −100% for a chance it never had.
  if (window.every((point) => point.revenue <= 0)) return null;

  const n = window.length;
  const xs = window.map((_, index) => index);
  const ys = window.map((point) => point.revenue);

  const meanX = xs.reduce((sum, x) => sum + x, 0) / n;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index += 1) {
    numerator += (xs[index]! - meanX) * (ys[index]! - meanY);
    denominator += (xs[index]! - meanX) ** 2;
  }

  // Every x is the same only when n < 2, already excluded above.
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - slope * meanX;

  let ssTotal = 0;
  let ssResidual = 0;
  for (let index = 0; index < n; index += 1) {
    const predicted = intercept + slope * xs[index]!;
    ssTotal += (ys[index]! - meanY) ** 2;
    ssResidual += (ys[index]! - predicted) ** 2;
  }
  // A flat series has no variance to explain; call that a perfect fit of a
  // flat line rather than dividing by zero.
  const rSquared = ssTotal === 0 ? 1 : Math.max(0, 1 - ssResidual / ssTotal);

  return { slope, intercept, rSquared, windowMonths: n };
}

/** Average monthly running cost (everything but one-off spend) in the window. */
export function runningCostAverage(series: MonthlyPoint[], windowMonths = 6): number {
  const window = series.slice(-windowMonths);
  if (window.length === 0) return 0;
  const total = window.reduce((sum, point) => sum + (point.cost - point.capex), 0);
  return total / window.length;
}

export type Projection = {
  months: { competence: string; revenue: number; cost: number }[];
  projectedRevenue: number;
  projectedCost: number;
  /** ROI over the whole life, history plus horizon. */
  projectedRoi: number | null;
  /** What the projection was built from, for the screen to state plainly. */
  basis: {
    windowMonths: number;
    horizonMonths: number;
    monthlySlope: number;
    rSquared: number;
    averageRunningCost: number;
  };
  confidence: "low" | "medium" | "high";
};

/**
 * Projects revenue and cost over the horizon and recomputes ROI as if the
 * horizon had already happened.
 *
 * Projected revenue is floored at zero: a downward line eventually crosses into
 * negative revenue, which is arithmetic, not a forecast.
 */
export function projectRoi(
  series: MonthlyPoint[],
  options: { windowMonths?: number; horizonMonths?: number } = {},
): Projection | null {
  const windowMonths = options.windowMonths ?? 6;
  const horizonMonths = options.horizonMonths ?? 12;

  const trend = revenueTrend(series, windowMonths);
  if (!trend || series.length === 0) return null;

  const last = series[series.length - 1]!;
  const averageRunningCost = runningCostAverage(series, windowMonths);

  const months = Array.from({ length: horizonMonths }, (_, index) => {
    const step = trend.windowMonths + index;
    const projected = trend.intercept + trend.slope * step;
    return {
      competence: addMonthsToCompetence(last.competence, index + 1),
      revenue: Math.max(0, projected),
      cost: Math.max(0, averageRunningCost),
    };
  });

  const projectedRevenue = months.reduce((sum, month) => sum + month.revenue, 0);
  const projectedCost = months.reduce((sum, month) => sum + month.cost, 0);

  const totalRevenue = last.accumulatedRevenue + projectedRevenue;
  const totalCost = last.accumulatedCost + projectedCost;
  const projectedRoi = totalCost <= 0 ? null : ((totalRevenue - totalCost) / totalCost) * 100;

  // Few months or a poor fit means the number is a hint, not a forecast.
  const confidence: Projection["confidence"] =
    trend.windowMonths >= 6 && trend.rSquared >= 0.7
      ? "high"
      : trend.windowMonths >= 4 && trend.rSquared >= 0.4
        ? "medium"
        : "low";

  return {
    months,
    projectedRevenue,
    projectedCost,
    projectedRoi,
    basis: {
      windowMonths: trend.windowMonths,
      horizonMonths,
      monthlySlope: trend.slope,
      rSquared: trend.rSquared,
      averageRunningCost,
    },
    confidence,
  };
}

export const CONFIDENCE_LABELS: Record<Projection["confidence"], string> = {
  low: "baixa",
  medium: "média",
  high: "alta",
};
