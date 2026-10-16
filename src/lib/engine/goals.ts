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

/* -------------------------------------------------------------------------- */
/* Apuração manual                                                            */
/* -------------------------------------------------------------------------- */

export type GoalMeasurement = {
  /** Primeiro dia do mês apurado, "YYYY-MM-01". */
  competence: string;
  value: number;
};

export type MeasuredGoal = { value: number; competence: string };

/** Meses entre duas competências "YYYY-MM-01". Negativo se `to` vier antes. */
function monthsBetweenCompetences(from: string, to: string): number {
  const [fy, fm] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const [ty, tm] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
  return (ty - fy) * 12 + (tm - fm);
}

/**
 * O realizado de uma meta que ninguém consegue derivar: a última apuração
 * digitada, desde que ela ainda valha.
 *
 * "Ainda valer" é o mesmo recorte que as metas derivadas usam — a janela do
 * período. Uma meta mensal aceita uma apuração de até um mês atrás, uma
 * trimestral de até três, uma anual de até doze. Fora disso devolve null, e a
 * tela diz que a apuração venceu em vez de exibir um NPS do ano passado como
 * se fosse o de agora. Um número velho apresentado como atual é pior do que
 * número nenhum: o número nenhum ninguém usa para decidir.
 *
 * Não se soma: NPS, market share e adoção são níveis, não fluxos, e somar
 * três meses de NPS não quer dizer nada. Tipo que soma é tipo derivado, e
 * esse não passa por aqui.
 */
export function realizedFromMeasurements(
  measurements: GoalMeasurement[],
  period: GoalPeriod,
  today: string,
): MeasuredGoal | null {
  if (measurements.length === 0) return null;

  const latest = measurements.reduce((newest, current) =>
    current.competence > newest.competence ? current : newest,
  );

  const currentCompetence = `${today.slice(0, 7)}-01`;
  const age = monthsBetweenCompetences(latest.competence, currentCompetence);
  // Apuração do futuro não é erro de digitação a corrigir aqui — é um mês
  // que ainda não fechou, e vale.
  if (age > goalWindow(period)) return null;

  return { value: latest.value, competence: latest.competence };
}
