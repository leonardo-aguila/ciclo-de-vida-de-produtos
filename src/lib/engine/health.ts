/**
 * Health Score — pure functions, no database.
 *
 * Five components, each 0–100, combined with configurable weights. A component
 * that cannot be computed (no goal, no plan, no tasks) returns `null` and is
 * excluded, with the remaining weights renormalized — scoring a product zero
 * for a plan it never had would punish it for the absence of data rather than
 * for its performance. The screen always shows which components counted.
 */
import type { HealthWeights, SemaphoreThresholds } from "@db/schema";
import { MEASURABLE_GOAL_TYPES } from "./goals";

export type ComponentKey = "goal" | "financial" | "execution" | "businessPlan" | "risk";

export type ComponentResult = {
  key: ComponentKey;
  label: string;
  /** 0–120 (the goal component allows overachievement) or null when unknown. */
  raw: number | null;
  weight: number;
  /** Contribution to the final score, already renormalized. */
  weighted: number;
  /** One line the user can read to understand the number. */
  detail: string;
};

export type HealthResult = {
  score: number;
  semaphore: "green" | "amber" | "red";
  components: ComponentResult[];
  /** Sum of the weights that could actually be computed. */
  coverage: number;
  /**
   * False when too little could be measured for the score to mean anything.
   *
   * A brand-new product has no goal history, no finance, no plan and no
   * schedule; the only component left is "no open risks", which is trivially
   * 100. Renormalizing over that one weight produces a perfect score and a
   * green light for a product nobody knows anything about — the most
   * misleading number the application could show. The screens read this flag
   * and say "sem medição" instead.
   */
  measured: boolean;
};

/**
 * Weight that has to be measurable before the score is reported as a score.
 * Half of the total: below that, more of the answer is missing than present.
 */
export const MIN_HEALTH_COVERAGE = 50;

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  goal: "Atingimento da meta",
  financial: "Saúde financeira",
  execution: "Execução / cronograma",
  businessPlan: "Aderência ao Business Plan",
  risk: "Risco em aberto",
};

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

/* -------------------------------------------------------------------------- */
/* Components                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * min(realizado / alvo, 1,2) × 100 — overachievement is capped at 120.
 *
 * When there is no number, the detail says *which* of three different things
 * is missing. They send the user to three different screens, and collapsing
 * them into "sem meta cadastrada" sent them to the wrong one.
 */
export function goalComponent(
  realized: number | null,
  target: number | null,
  /** The goal's type code, to tell "not collected" from "no history yet". */
  typeCode?: string,
): { raw: number | null; detail: string } {
  if (target === null) {
    return { raw: null, detail: "Sem meta principal cadastrada." };
  }
  if (realized === null) {
    if (typeCode !== undefined && !MEASURABLE_GOAL_TYPES.has(typeCode)) {
      return {
        raw: null,
        detail: "O sistema não coleta dados para medir uma meta desse tipo.",
      };
    }
    return {
      raw: null,
      detail: "A meta principal existe, mas ainda não há histórico para medir o realizado.",
    };
  }
  if (target <= 0) {
    return { raw: null, detail: "A meta principal tem alvo zero e não pode ser medida." };
  }
  const ratio = Math.min(realized / target, 1.2);
  return {
    raw: Math.max(0, ratio * 100),
    detail: `Realizado ${formatRatio(realized / target)} do alvo.`,
  };
}

/**
 * ROI and contribution margin, normalized and averaged.
 *
 * ROI maps −100% → 0 and +100% → 100, so break-even sits at 50. The margin maps
 * its share of revenue over the same scale.
 */
export function financialComponent(
  roi: number | null,
  contributionMargin: number | null,
  revenue: number | null,
): { raw: number | null; detail: string } {
  const parts: number[] = [];
  const notes: string[] = [];

  if (roi !== null) {
    parts.push(clamp((roi + 100) / 2));
    notes.push(`ROI acumulado de ${formatPercent(roi)}`);
  }

  if (contributionMargin !== null && revenue !== null && revenue > 0) {
    const share = (contributionMargin / revenue) * 100;
    // −50% of revenue → 0; +50% → 100.
    parts.push(clamp(share + 50));
    notes.push(`margem de ${formatPercent(share)} da receita`);
  } else if (contributionMargin !== null) {
    parts.push(contributionMargin >= 0 ? 60 : 20);
    notes.push(contributionMargin >= 0 ? "margem positiva sem receita no mês" : "margem negativa");
  }

  if (parts.length === 0) {
    return { raw: null, detail: "Sem custo nem receita lançados." };
  }

  return {
    raw: parts.reduce((sum, value) => sum + value, 0) / parts.length,
    detail: notes.join(" e ") + ".",
  };
}

/**
 * Realized completion over expected completion, penalized by late tasks.
 * Each late task costs 5 points, capped at 30 — enough to hurt, not enough to
 * erase a project that is otherwise on schedule.
 */
export function executionComponent(
  actualProgress: number,
  expectedProgress: number,
  lateTasks: number,
  totalTasks: number,
): { raw: number | null; detail: string } {
  if (totalTasks === 0) {
    return { raw: null, detail: "Nenhuma tarefa cadastrada." };
  }

  // A schedule that has not started yet cannot be judged: scoring it 100 would
  // hand the product a full mark for having done nothing.
  if (expectedProgress <= 0 && actualProgress <= 0) {
    return {
      raw: null,
      detail: "O cronograma ainda não começou — nada a avaliar por enquanto.",
    };
  }

  const ratio = expectedProgress <= 0 ? 1 : actualProgress / expectedProgress;
  const base = clamp(ratio * 100);
  const penalty = Math.min(30, lateTasks * 5);

  return {
    raw: clamp(base - penalty),
    detail:
      `${formatPercent(actualProgress)} concluído contra ${formatPercent(expectedProgress)} esperado` +
      (lateTasks > 0
        ? `, com ${lateTasks} ${lateTasks === 1 ? "tarefa atrasada" : "tarefas atrasadas"} (−${penalty} pontos).`
        : "."),
  };
}

/** 1 − |desvio acumulado|, as a percentage. */
export function businessPlanComponent(
  accumulatedDeviationPct: number | null,
): { raw: number | null; detail: string } {
  if (accumulatedDeviationPct === null) {
    return { raw: null, detail: "Sem Business Plan vigente para comparar." };
  }
  const raw = clamp(100 - Math.abs(accumulatedDeviationPct));
  return {
    raw,
    detail: `Desvio acumulado de ${formatPercent(accumulatedDeviationPct)} contra o plano.`,
  };
}

/** 100 minus penalties for overdue action plans and untreated critical insights. */
export function riskComponent(
  overdueActionPlans: number,
  untreatedCriticalInsights: number,
): { raw: number; detail: string } {
  const planPenalty = Math.min(60, overdueActionPlans * 20);
  const insightPenalty = Math.min(40, untreatedCriticalInsights * 10);
  const raw = clamp(100 - planPenalty - insightPenalty);

  const notes: string[] = [];
  if (overdueActionPlans > 0) {
    notes.push(
      `${overdueActionPlans} ${overdueActionPlans === 1 ? "plano de ação vencido" : "planos de ação vencidos"} (−${planPenalty})`,
    );
  }
  if (untreatedCriticalInsights > 0) {
    notes.push(
      `${untreatedCriticalInsights} ${untreatedCriticalInsights === 1 ? "insight crítico sem tratamento" : "insights críticos sem tratamento"} (−${insightPenalty})`,
    );
  }

  return { raw, detail: notes.length > 0 ? `${notes.join(" e ")}.` : "Nenhum risco em aberto." };
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                */
/* -------------------------------------------------------------------------- */

export type HealthInput = {
  goal: { realized: number | null; target: number | null; typeCode?: string };
  financial: { roi: number | null; contributionMargin: number | null; revenue: number | null };
  execution: {
    actualProgress: number;
    expectedProgress: number;
    lateTasks: number;
    totalTasks: number;
  };
  businessPlan: { accumulatedDeviationPct: number | null };
  risk: { overdueActionPlans: number; untreatedCriticalInsights: number };
};

export function computeHealth(
  input: HealthInput,
  weights: HealthWeights,
  thresholds: SemaphoreThresholds,
): HealthResult {
  const raw: Record<ComponentKey, { raw: number | null; detail: string }> = {
    goal: goalComponent(input.goal.realized, input.goal.target, input.goal.typeCode),
    financial: financialComponent(
      input.financial.roi,
      input.financial.contributionMargin,
      input.financial.revenue,
    ),
    execution: executionComponent(
      input.execution.actualProgress,
      input.execution.expectedProgress,
      input.execution.lateTasks,
      input.execution.totalTasks,
    ),
    businessPlan: businessPlanComponent(input.businessPlan.accumulatedDeviationPct),
    risk: riskComponent(input.risk.overdueActionPlans, input.risk.untreatedCriticalInsights),
  };

  const keys: ComponentKey[] = ["goal", "financial", "execution", "businessPlan", "risk"];
  const coverage = keys
    .filter((key) => raw[key].raw !== null)
    .reduce((sum, key) => sum + weights[key], 0);

  const components: ComponentResult[] = keys.map((key) => {
    const value = raw[key];
    // Renormalize over what could be measured, so the missing pieces neither
    // help nor hurt.
    const weighted =
      value.raw === null || coverage === 0
        ? 0
        : (value.raw / 100) * (weights[key] / coverage) * 100;

    return {
      key,
      label: COMPONENT_LABELS[key],
      raw: value.raw,
      weight: weights[key],
      weighted,
      detail: value.detail,
    };
  });

  const score = clamp(components.reduce((sum, component) => sum + component.weighted, 0));

  return {
    score,
    semaphore:
      score >= thresholds.green ? "green" : score >= thresholds.amber ? "amber" : "red",
    components,
    coverage,
    measured: coverage >= MIN_HEALTH_COVERAGE,
  };
}

export const SEMAPHORE_LABELS = {
  green: "Verde",
  amber: "Amarelo",
  red: "Vermelho",
} as const;

/* -------------------------------------------------------------------------- */

function formatPercent(value: number): string {
  return `${value.toFixed(1).replace(".", ",")}%`;
}

function formatRatio(ratio: number): string {
  return `${(ratio * 100).toFixed(1).replace(".", ",")}%`;
}
