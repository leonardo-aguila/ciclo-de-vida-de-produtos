/**
 * Continuity recommendation — pure functions, no database.
 *
 * The rules come from settings, so the thresholds are the user's. Every result
 * carries the sentences that justify it and the numbers behind them: a
 * recommendation nobody can argue with is a recommendation nobody should obey.
 *
 * Nothing here executes anything. The user records the decision.
 */
import type { RecommendationRules, RecommendationValue } from "@db/schema";

export type RecommendationInput = {
  health: number;
  /**
   * False when too little could be measured for the Health Score to mean
   * anything. Defaults to true, so callers that do not track it behave as
   * before.
   */
  healthMeasured?: boolean;
  /** Accumulated ROI in percent, null when there is no cost. */
  roi: number | null;
  /** Projected 12-month ROI in percent, null when it cannot be projected. */
  projectedRoi: number | null;
  /** Average MoM revenue growth over the last 3 months, in percent. */
  momGrowth: number | null;
  /** Months in a row with falling revenue. */
  decliningMonths: number;
  /** Months in a row with negative contribution margin. */
  negativeMarginMonths: number;
  /** Whether the primary goal has been reached. */
  goalReached: boolean | null;
  /** Estimated payback competence, and the goal deadline to compare it against. */
  paybackCompetence: string | null;
  goalDeadline: string | null;
};

export type Recommendation = {
  kind: RecommendationValue;
  label: string;
  /** Sentences, in the order they should be read. */
  rationale: string[];
  /** The numbers the rationale refers to, for the card to show beside the text. */
  evidence: { label: string; value: string }[];
  /** Ordered from most to least severe, for sorting alerts. */
  severity: number;
};

const LABELS: Record<RecommendationValue, string> = {
  scale: "Escalar",
  keep: "Manter",
  watch: "Observar / revisar",
  pivot: "Pivotar",
  discontinue: "Descontinuar",
};

const SEVERITY: Record<RecommendationValue, number> = {
  discontinue: 5,
  pivot: 4,
  watch: 3,
  keep: 2,
  scale: 1,
};

const pct = (value: number | null): string =>
  value === null ? "—" : `${value.toFixed(1).replace(".", ",")}%`;

const months = (value: number): string => `${value} ${value === 1 ? "mês" : "meses"}`;

/**
 * Evaluates the rules from the most severe down, and the first match wins.
 *
 * Order matters: a product that is both declining and unprofitable must read as
 * "discontinue", not as "watch" — the milder answer would bury the finding.
 */
export function recommend(
  input: RecommendationInput,
  rules: RecommendationRules,
): Recommendation {
  const evidence: { label: string; value: string }[] = [
    {
      label: "Health Score",
      value: input.healthMeasured === false ? "sem medição" : input.health.toFixed(0),
    },
    { label: "ROI acumulado", value: pct(input.roi) },
    { label: "ROI projetado 12M", value: pct(input.projectedRoi) },
    { label: "Crescimento MoM (3M)", value: pct(input.momGrowth) },
  ];
  if (input.decliningMonths > 0) {
    evidence.push({ label: "Meses seguidos em queda", value: String(input.decliningMonths) });
  }
  if (input.negativeMarginMonths > 0) {
    evidence.push({
      label: "Meses de margem negativa",
      value: String(input.negativeMarginMonths),
    });
  }

  const build = (kind: RecommendationValue, rationale: string[]): Recommendation => ({
    kind,
    label: LABELS[kind],
    rationale,
    evidence,
    severity: SEVERITY[kind],
  });

  // 0. Nothing to recommend yet.
  //
  // A product created last week has no goal history, no finance and no plan.
  // Every rule below reads numbers that do not exist, and the mildest of them
  // would still print "Health Score de 100" — a verdict built on the single
  // component that scores full marks for having no open risks.
  if (input.healthMeasured === false) {
    return build("watch", [
      "Ainda não há dados suficientes para avaliar a continuidade deste produto.",
      "Sem meta realizada, lançamentos financeiros ou cronograma, qualquer recomendação diria mais sobre a falta de informação do que sobre o produto.",
      "Sugestão: cadastrar meta, orçamento e as primeiras tarefas — a recomendação aparece assim que houver o que medir.",
    ]);
  }

  // 1. Discontinue — losing money now, projected to keep losing, and shrinking.
  if (
    input.roi !== null &&
    input.roi < rules.discontinue.maxRoi &&
    input.projectedRoi !== null &&
    input.projectedRoi < rules.discontinue.maxProjectedRoi &&
    input.decliningMonths >= rules.discontinue.minDecliningMonths
  ) {
    return build("discontinue", [
      `O ROI acumulado é de ${pct(input.roi)} e o projetado para 12 meses, ${pct(input.projectedRoi)}: o produto não devolveu o que custou e a projeção não indica que devolverá.`,
      `A receita cai há ${months(input.decliningMonths)} seguidos, então a tendência não sustenta a recuperação.`,
      "Sugestão: avaliar o encerramento, com plano de saída para os clientes ativos.",
    ]);
  }

  // 2. Pivot — the market responds, the economics do not.
  if (
    input.goalReached === false &&
    (input.momGrowth ?? 0) > 0 &&
    input.negativeMarginMonths >= rules.pivot.minNegativeMarginMonths
  ) {
    return build("pivot", [
      `A receita cresce (${pct(input.momGrowth)} ao mês nos últimos 3 meses), mas a meta principal não foi atingida.`,
      `A margem de contribuição é negativa há ${months(input.negativeMarginMonths)} seguidos: cada venda nova aprofunda o prejuízo.`,
      "Sugestão: rever precificação, empacotamento ou custo de entrega antes de acelerar a venda.",
    ]);
  }

  // 3. Scale — healthy, profitable and growing.
  if (
    input.health >= rules.scale.minHealth &&
    input.roi !== null &&
    input.roi > rules.scale.minRoi &&
    (input.momGrowth ?? 0) > rules.scale.minMomGrowth
  ) {
    return build("scale", [
      `Health Score de ${input.health.toFixed(0)}, acima do limite de ${rules.scale.minHealth}.`,
      `ROI acumulado positivo (${pct(input.roi)}) e crescimento médio de ${pct(input.momGrowth)} ao mês.`,
      "Sugestão: ampliar investimento enquanto a economia unitária se mantém.",
    ]);
  }

  const inMiddleBand = input.health >= rules.keep.minHealth && input.health <= rules.keep.maxHealth;

  // 4. Watch — middling health with no projected return, or payback past the goal.
  const paybackPastDeadline =
    input.paybackCompetence !== null &&
    input.goalDeadline !== null &&
    input.paybackCompetence > input.goalDeadline;

  if (inMiddleBand && (input.projectedRoi === null || input.projectedRoi <= rules.keep.minProjectedRoi)) {
    return build("watch", [
      `Health Score de ${input.health.toFixed(0)}, na faixa intermediária.`,
      input.projectedRoi === null
        ? "Não há histórico suficiente para projetar o ROI de 12 meses."
        : `O ROI projetado para 12 meses é de ${pct(input.projectedRoi)}, sem retorno à vista.`,
      "Sugestão: revisar o plano e definir o que precisa mudar no próximo trimestre.",
    ]);
  }

  if (paybackPastDeadline) {
    return build("watch", [
      `O payback estimado cai depois do prazo da meta principal.`,
      `Health Score de ${input.health.toFixed(0)}.`,
      "Sugestão: revisar meta, prazo ou estrutura de custo.",
    ]);
  }

  // 5. Keep — middling health, but the projection points to a return.
  if (inMiddleBand && input.projectedRoi !== null && input.projectedRoi > rules.keep.minProjectedRoi) {
    return build("keep", [
      `Health Score de ${input.health.toFixed(0)}, na faixa intermediária.`,
      `O ROI projetado para 12 meses é de ${pct(input.projectedRoi)}, o que sustenta a continuidade.`,
      "Sugestão: manter o curso e acompanhar mensalmente.",
    ]);
  }

  // 6. Keep — healthy, but still paying back the investment.
  //
  // Without this branch a product in full growth, with a positive projected
  // ROI and an accumulated ROI still negative because the CAPEX has not been
  // recovered yet, falls past both the middle band (its health is too good)
  // and the scale rule (its ROI is still negative), and lands on "watch". That
  // is the wrong answer: what it needs is to stay the course.
  if (
    input.health >= rules.keep.minHealth &&
    input.projectedRoi !== null &&
    input.projectedRoi > rules.keep.minProjectedRoi
  ) {
    return build("keep", [
      `Health Score de ${input.health.toFixed(0)}, mas o ROI acumulado ainda é de ${pct(input.roi)}: o investimento não se pagou.`,
      `O ROI projetado para 12 meses é de ${pct(input.projectedRoi)}, o que indica retorno dentro do horizonte.`,
      "Sugestão: manter o curso e acompanhar o payback mensalmente.",
    ]);
  }

  // Fallback: healthy but not growing, or unhealthy without the discontinue
  // conditions. Watching is the honest answer, and the text says why.
  return build("watch", [
    `Health Score de ${input.health.toFixed(0)}.`,
    input.health >= rules.scale.minHealth
      ? "A saúde está boa, mas os critérios de crescimento e retorno para escalar não foram atendidos."
      : "A saúde está abaixo da faixa intermediária, sem os três sinais que indicariam descontinuar.",
    "Sugestão: revisar antes de decidir por investimento ou encerramento.",
  ]);
}

export const RECOMMENDATION_TONES: Record<RecommendationValue, "green" | "blue" | "amber" | "red"> =
  {
    scale: "green",
    keep: "blue",
    watch: "amber",
    pivot: "amber",
    discontinue: "red",
  };
