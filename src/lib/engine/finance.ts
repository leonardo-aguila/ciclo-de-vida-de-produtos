/**
 * Financial engine — pure functions, no database.
 *
 * Everything here answers the same question from a different angle: is this
 * product paying for itself? Revenue, cost, margin, payback and ROI, plus the
 * monthly series the charts draw.
 */
import { addMonthsToCompetence, competenceRange, monthsBetween, toCompetence } from "@/lib/format";

export type SaleRow = {
  competence: string;
  newMrr: number;
  recurringRevenue: number;
  oneTimeRevenue: number;
  churnAmount: number;
  activeCustomers: number;
};

export type CostRow = {
  competenceDate: string;
  amount: number;
  /** Variable costs are the ones the contribution margin subtracts. */
  isVariable: boolean;
  /** Type code: capex, opex, investment, direct_cost, indirect_cost, other. */
  typeCode: string;
};

export type MonthlyPoint = {
  competence: string;
  revenue: number;
  cost: number;
  variableCost: number;
  opex: number;
  /** One-off spend (CAPEX and investment): sunk, never extrapolated forward. */
  capex: number;
  accumulatedRevenue: number;
  accumulatedCost: number;
  /** Revenue minus variable cost, for the month. */
  contributionMargin: number;
  result: number;
  /** Result excluding one-off spend — the forward-looking run rate. */
  recurringResult: number;
};

/** Revenue recognised in a month: recurring plus one-off, minus churn. */
export function monthlyRevenue(sale: SaleRow): number {
  return sale.recurringRevenue + sale.oneTimeRevenue - sale.churnAmount;
}

/**
 * The monthly series both charts and every downstream metric read.
 *
 * Months with no movement are still emitted, so a gap in the data reads as a
 * flat line rather than as a jump between distant points.
 */
export function buildMonthlySeries(sales: SaleRow[], costs: CostRow[]): MonthlyPoint[] {
  const competences = new Set<string>();
  for (const sale of sales) competences.add(toCompetence(sale.competence));
  for (const cost of costs) competences.add(toCompetence(cost.competenceDate));
  if (competences.size === 0) return [];

  const sorted = Array.from(competences).sort();
  const months = competenceRange(sorted[0]!, sorted[sorted.length - 1]!);

  const revenueByMonth = new Map<string, number>();
  for (const sale of sales) {
    const key = toCompetence(sale.competence);
    revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + monthlyRevenue(sale));
  }

  const costByMonth = new Map<
    string,
    { total: number; variable: number; opex: number; capex: number }
  >();
  for (const cost of costs) {
    const key = toCompetence(cost.competenceDate);
    const current = costByMonth.get(key) ?? { total: 0, variable: 0, opex: 0, capex: 0 };
    const isOneOff = cost.typeCode === "capex" || cost.typeCode === "investment";
    costByMonth.set(key, {
      total: current.total + cost.amount,
      variable: current.variable + (cost.isVariable ? cost.amount : 0),
      opex: current.opex + (cost.typeCode === "opex" ? cost.amount : 0),
      capex: current.capex + (isOneOff ? cost.amount : 0),
    });
  }

  let accumulatedRevenue = 0;
  let accumulatedCost = 0;

  return months.map((competence) => {
    const revenue = revenueByMonth.get(competence) ?? 0;
    const cost = costByMonth.get(competence) ?? { total: 0, variable: 0, opex: 0, capex: 0 };
    accumulatedRevenue += revenue;
    accumulatedCost += cost.total;

    return {
      competence,
      revenue,
      cost: cost.total,
      variableCost: cost.variable,
      opex: cost.opex,
      capex: cost.capex,
      accumulatedRevenue,
      accumulatedCost,
      contributionMargin: revenue - cost.variable,
      result: revenue - cost.total,
      recurringResult: revenue - (cost.total - cost.capex),
    };
  });
}

export type FinancialSummary = {
  accumulatedRevenue: number;
  accumulatedCost: number;
  /** null when there is no cost at all: dividing by zero is not "infinite ROI". */
  roi: number | null;
  lastMargin: number | null;
  /** Average monthly burn over the negative-margin months, as a positive number. */
  burn: number | null;
  months: number;
};

export function summarize(series: MonthlyPoint[]): FinancialSummary {
  if (series.length === 0) {
    return {
      accumulatedRevenue: 0,
      accumulatedCost: 0,
      roi: null,
      lastMargin: null,
      burn: null,
      months: 0,
    };
  }

  const last = series[series.length - 1]!;
  const negatives = series.filter((point) => point.result < 0);
  const burn =
    negatives.length > 0
      ? Math.abs(negatives.reduce((sum, point) => sum + point.result, 0)) / negatives.length
      : null;

  return {
    accumulatedRevenue: last.accumulatedRevenue,
    accumulatedCost: last.accumulatedCost,
    roi: roiOf(last.accumulatedRevenue, last.accumulatedCost),
    lastMargin: last.contributionMargin,
    burn,
    months: series.length,
  };
}

/**
 * ROI in percent: (revenue − cost) / cost × 100.
 *
 * With zero cost there is no return on investment to speak of — the answer is
 * "not applicable", not infinity, and the screen has to say so.
 */
export function roiOf(revenue: number, cost: number): number | null {
  if (cost <= 0) return null;
  return ((revenue - cost) / cost) * 100;
}

export type Payback = {
  status: "reached" | "estimated" | "unreachable" | "insufficient_data";
  /** Competence where accumulated revenue passes accumulated cost. */
  competence: string | null;
  /** Months from the first competence to the payback point. */
  months: number | null;
};

/**
 * Payback: the month accumulated revenue overtakes accumulated cost.
 *
 * If it has not happened yet, it is projected from the average of the last
 * months — and the result says clearly that it is an estimate, because a
 * projected date printed like a fact is how plans get believed too much.
 */
export function payback(series: MonthlyPoint[], windowMonths = 6): Payback {
  if (series.length === 0) {
    return { status: "insufficient_data", competence: null, months: null };
  }

  const reached = series.find((point) => point.accumulatedRevenue >= point.accumulatedCost);
  if (reached) {
    return {
      status: "reached",
      competence: reached.competence,
      months: monthsBetween(series[0]!.competence, reached.competence),
    };
  }

  const window = series.slice(-Math.max(2, Math.min(windowMonths, series.length)));
  if (window.length < 2) {
    return { status: "insufficient_data", competence: null, months: null };
  }

  // The run rate excludes one-off spend: a CAPEX already paid sits in the gap
  // below, and repeating it every month would declare healthy products
  // unrecoverable.
  const averageResult =
    window.reduce((sum, point) => sum + point.recurringResult, 0) / window.length;
  const last = series[series.length - 1]!;
  const gap = last.accumulatedCost - last.accumulatedRevenue;

  // Losing money every month means the gap only widens.
  if (averageResult <= 0) {
    return { status: "unreachable", competence: null, months: null };
  }

  const monthsAhead = Math.ceil(gap / averageResult);
  return {
    status: "estimated",
    competence: addMonthsToCompetence(last.competence, monthsAhead),
    months: monthsBetween(series[0]!.competence, last.competence) + monthsAhead,
  };
}

/** Runway in months at the current burn, when the margin is negative. */
export function runway(cashAvailable: number, burn: number | null): number | null {
  if (!burn || burn <= 0) return null;
  return cashAvailable / burn;
}

/** Month-over-month revenue growth, in percent, per month of the series. */
export function momGrowth(series: MonthlyPoint[]): (number | null)[] {
  return series.map((point, index) => {
    if (index === 0) return null;
    const previous = series[index - 1]!.revenue;
    if (previous === 0) return null;
    return ((point.revenue - previous) / Math.abs(previous)) * 100;
  });
}

/** Average MoM growth over the last `months` months. */
export function averageMomGrowth(series: MonthlyPoint[], months = 3): number | null {
  const growth = momGrowth(series)
    .slice(-months)
    .filter((value): value is number => value !== null);
  if (growth.length === 0) return null;
  return growth.reduce((sum, value) => sum + value, 0) / growth.length;
}

/** How many months in a row, counting back from the end, revenue fell. */
export function consecutiveDecliningMonths(series: MonthlyPoint[]): number {
  let count = 0;
  for (let index = series.length - 1; index > 0; index -= 1) {
    if (series[index]!.revenue < series[index - 1]!.revenue) count += 1;
    else break;
  }
  return count;
}

/** How many months in a row, counting back, the contribution margin was negative. */
export function consecutiveNegativeMarginMonths(series: MonthlyPoint[]): number {
  let count = 0;
  for (let index = series.length - 1; index >= 0; index -= 1) {
    if (series[index]!.contributionMargin < 0) count += 1;
    else break;
  }
  return count;
}

/** Revenue variation over the last 3 months, as a percentage — stability proxy. */
export function revenueStability(series: MonthlyPoint[], months = 3): number | null {
  const window = series.slice(-months);
  if (window.length < 2) return null;
  const values = window.map((point) => point.revenue);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (average === 0) return null;
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return (Math.sqrt(variance) / Math.abs(average)) * 100;
}

/** Annualized maintenance cost: the last 12 months of OPEX and indirect cost. */
export function annualizedMaintenanceCost(series: MonthlyPoint[]): number {
  const window = series.slice(-12);
  if (window.length === 0) return 0;
  const total = window.reduce((sum, point) => sum + point.opex, 0);
  // Scale up when there is less than a year of history.
  return (total / window.length) * 12;
}

export function annualizedRevenue(series: MonthlyPoint[]): number {
  const window = series.slice(-12);
  if (window.length === 0) return 0;
  const total = window.reduce((sum, point) => sum + point.revenue, 0);
  return (total / window.length) * 12;
}

const MONTHS_PER_PERIOD = { monthly: 1, quarterly: 3, annual: 12 } as const;
/** Guard rail: one recurrence must not be able to write thousands of rows. */
const MAX_INSTALMENTS = 120;

/**
 * The competences a recurring entry generates, excluding the first one —
 * that one is the entry the user typed.
 */
export function instalmentDates(
  start: string,
  period: "monthly" | "quarterly" | "annual",
  end: string,
): string[] {
  const step = MONTHS_PER_PERIOD[period];
  const dates: string[] = [];
  for (let index = 1; index <= MAX_INSTALMENTS; index += 1) {
    const next = addMonthsToCompetence(start, step * index);
    if (next > end) break;
    dates.push(next);
  }
  return dates;
}

/** Total of a cost type over the whole history. */
export function totalByType(costs: CostRow[], typeCode: string): number {
  return costs
    .filter((cost) => cost.typeCode === typeCode)
    .reduce((sum, cost) => sum + cost.amount, 0);
}
