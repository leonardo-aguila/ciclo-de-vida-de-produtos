/**
 * Insight classification — pure, and deliberately free of any database import.
 *
 * The matrix is a client component: anything it imports travels to the browser.
 * Keeping these types and helpers out of the query module is what stops the
 * Postgres driver from being pulled into the client bundle.
 */

export type InsightStatus =
  | "new"
  | "under_analysis"
  | "approved"
  | "in_progress"
  | "done"
  | "discarded";

export type InsightRow = {
  id: string;
  title: string;
  description: string | null;
  originId: string | null;
  originLabel: string | null;
  ownerId: string | null;
  ownerName: string | null;
  insightDate: string;
  status: InsightStatus;
  effort: number;
  impact: number;
  /** impact ÷ effort — effort is 1..10, so it never divides by zero. */
  score: number;
  /** Tasks already created from this insight. */
  taskCount: number;
};

export type Quadrant = "quick_wins" | "big_bets" | "fill_ins" | "avoid";

export const QUADRANT_LABELS: Record<Quadrant, string> = {
  quick_wins: "Ganhos rápidos",
  big_bets: "Grandes apostas",
  fill_ins: "Preencher",
  avoid: "Evitar",
};

export const QUADRANT_DESCRIPTIONS: Record<Quadrant, string> = {
  quick_wins: "Alto impacto, baixo esforço — faça primeiro.",
  big_bets: "Alto impacto, alto esforço — decida conscientemente.",
  fill_ins: "Baixo impacto, baixo esforço — encaixe quando sobrar espaço.",
  avoid: "Baixo impacto, alto esforço — evite.",
};

/** The dividing line is 5.5, so the 1..10 scale splits evenly. */
export function quadrantOf(effort: number, impact: number): Quadrant {
  const highImpact = impact >= 5.5;
  const lowEffort = effort < 5.5;
  if (highImpact && lowEffort) return "quick_wins";
  if (highImpact && !lowEffort) return "big_bets";
  if (!highImpact && lowEffort) return "fill_ins";
  return "avoid";
}

export function insightScore(effort: number, impact: number): number {
  return impact / Math.max(1, effort);
}
