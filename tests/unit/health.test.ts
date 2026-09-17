import { describe, expect, it } from "vitest";
import {
  businessPlanComponent,
  computeHealth,
  executionComponent,
  financialComponent,
  goalComponent,
  riskComponent,
  type HealthInput,
} from "@/lib/engine/health";
import { DEFAULT_HEALTH_WEIGHTS, DEFAULT_SEMAPHORE } from "@/lib/defaults";

function input(overrides: Partial<HealthInput> = {}): HealthInput {
  return {
    goal: { realized: 100, target: 100 },
    financial: { roi: 0, contributionMargin: 0, revenue: 1000 },
    execution: { actualProgress: 50, expectedProgress: 50, lateTasks: 0, totalTasks: 10 },
    businessPlan: { accumulatedDeviationPct: 0 },
    risk: { overdueActionPlans: 0, untreatedCriticalInsights: 0 },
    ...overrides,
  };
}

describe("componente de meta", () => {
  it("vale 100 quando o alvo é exatamente atingido", () => {
    expect(goalComponent(100, 100).raw).toBe(100);
  });

  it("limita o excesso em 120", () => {
    expect(goalComponent(300, 100).raw).toBe(120);
  });

  it("é proporcional abaixo do alvo", () => {
    expect(goalComponent(40, 100).raw).toBe(40);
  });

  it("não computa sem meta ou com alvo zero", () => {
    expect(goalComponent(null, 100).raw).toBeNull();
    expect(goalComponent(100, null).raw).toBeNull();
    expect(goalComponent(100, 0).raw).toBeNull();
    expect(goalComponent(100, 0).detail).toMatch(/alvo zero/i);
  });

  it("não vai abaixo de zero com realizado negativo", () => {
    expect(goalComponent(-500, 100).raw).toBe(0);
  });
});

describe("componente financeiro", () => {
  it("põe o ponto de equilíbrio no meio da escala", () => {
    expect(financialComponent(0, null, null).raw).toBe(50);
  });

  it("mapeia ROI de −100% para zero e +100% para cem", () => {
    expect(financialComponent(-100, null, null).raw).toBe(0);
    expect(financialComponent(100, null, null).raw).toBe(100);
    expect(financialComponent(-400, null, null).raw).toBe(0);
  });

  it("combina ROI e margem quando os dois existem", () => {
    // ROI 0 ⇒ 50; margem de 50% da receita ⇒ 100. Média 75.
    expect(financialComponent(0, 500, 1000).raw).toBe(75);
  });

  it("não computa sem custo nem receita", () => {
    expect(financialComponent(null, null, null).raw).toBeNull();
  });

  it("explica o número em texto", () => {
    expect(financialComponent(25, 200, 1000).detail).toContain("ROI acumulado");
  });
});

describe("componente de execução", () => {
  it("vale 100 quando o realizado acompanha o esperado", () => {
    expect(executionComponent(50, 50, 0, 10).raw).toBe(100);
  });

  it("cai proporcionalmente ao atraso do avanço", () => {
    expect(executionComponent(25, 50, 0, 10).raw).toBe(50);
  });

  it("penaliza cinco pontos por tarefa atrasada, com teto de trinta", () => {
    expect(executionComponent(50, 50, 2, 10).raw).toBe(90);
    expect(executionComponent(50, 50, 20, 30).raw).toBe(70);
  });

  it("não computa sem tarefa nenhuma", () => {
    expect(executionComponent(0, 0, 0, 0).raw).toBeNull();
  });

  it("não passa de 100 quando o projeto está adiantado", () => {
    expect(executionComponent(90, 30, 0, 10).raw).toBe(100);
  });
});

describe("componente de Business Plan", () => {
  it("vale 100 quando o realizado bate o plano", () => {
    expect(businessPlanComponent(0).raw).toBe(100);
  });

  it("desconta o módulo do desvio, para cima e para baixo", () => {
    expect(businessPlanComponent(-15).raw).toBe(85);
    expect(businessPlanComponent(15).raw).toBe(85);
  });

  it("não fica negativo com desvio enorme", () => {
    expect(businessPlanComponent(-300).raw).toBe(0);
  });

  it("não computa sem plano", () => {
    expect(businessPlanComponent(null).raw).toBeNull();
    expect(businessPlanComponent(null).detail).toMatch(/sem business plan/i);
  });
});

describe("componente de risco", () => {
  it("vale 100 sem risco em aberto", () => {
    expect(riskComponent(0, 0).raw).toBe(100);
    expect(riskComponent(0, 0).detail).toMatch(/nenhum risco/i);
  });

  it("desconta por plano vencido e por insight crítico", () => {
    expect(riskComponent(1, 0).raw).toBe(80);
    expect(riskComponent(0, 2).raw).toBe(80);
    expect(riskComponent(1, 1).raw).toBe(70);
  });

  it("tem teto de penalidade por tipo", () => {
    expect(riskComponent(10, 10).raw).toBe(0);
  });
});

describe("composição do Health Score", () => {
  const weights = DEFAULT_HEALTH_WEIGHTS;
  const thresholds = DEFAULT_SEMAPHORE;

  it("um produto perfeito chega a 100", () => {
    const result = computeHealth(
      input({
        goal: { realized: 100, target: 100 },
        financial: { roi: 100, contributionMargin: 500, revenue: 1000 },
        execution: { actualProgress: 50, expectedProgress: 50, lateTasks: 0, totalTasks: 5 },
        businessPlan: { accumulatedDeviationPct: 0 },
      }),
      weights,
      thresholds,
    );

    expect(result.score).toBe(100);
    expect(result.semaphore).toBe("green");
    expect(result.coverage).toBe(100);
  });

  it("devolve a decomposição por componente", () => {
    const result = computeHealth(input(), weights, thresholds);

    expect(result.components).toHaveLength(5);
    expect(result.components.map((component) => component.key)).toEqual([
      "goal",
      "financial",
      "execution",
      "businessPlan",
      "risk",
    ]);
    // A soma das partes é o próprio score.
    const sum = result.components.reduce((total, component) => total + component.weighted, 0);
    expect(sum).toBeCloseTo(result.score, 6);
    expect(result.components.every((component) => component.detail.length > 0)).toBe(true);
  });

  it("redistribui o peso dos componentes que não podem ser medidos", () => {
    const result = computeHealth(
      input({
        goal: { realized: null, target: null },
        businessPlan: { accumulatedDeviationPct: null },
      }),
      weights,
      thresholds,
    );

    // Sobraram financeiro (25), execução (20) e risco (10) = 55.
    expect(result.coverage).toBe(55);
    expect(result.components.find((c) => c.key === "goal")!.weighted).toBe(0);
    // Ainda assim o score usa a escala inteira de 0 a 100.
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("produto recém-criado, sem nada medível além do risco, não vira zero", () => {
    const result = computeHealth(
      input({
        goal: { realized: null, target: null },
        financial: { roi: null, contributionMargin: null, revenue: null },
        execution: { actualProgress: 0, expectedProgress: 0, lateTasks: 0, totalTasks: 0 },
        businessPlan: { accumulatedDeviationPct: null },
        risk: { overdueActionPlans: 0, untreatedCriticalInsights: 0 },
      }),
      weights,
      thresholds,
    );

    // Só o risco é mensurável, e ele está limpo.
    expect(result.coverage).toBe(10);
    expect(result.score).toBe(100);
  });

  it("não quebra quando nenhum componente é mensurável", () => {
    const zeroWeights = { goal: 0, financial: 0, execution: 0, businessPlan: 0, risk: 0 };
    const result = computeHealth(input(), zeroWeights, thresholds);
    expect(result.coverage).toBe(0);
    expect(result.score).toBe(0);
    expect(Number.isNaN(result.score)).toBe(false);
  });

  it("acende o semáforo pelas faixas configuradas", () => {
    const red = computeHealth(
      input({
        goal: { realized: 10, target: 100 },
        financial: { roi: -80, contributionMargin: -500, revenue: 1000 },
        execution: { actualProgress: 5, expectedProgress: 80, lateTasks: 6, totalTasks: 10 },
        businessPlan: { accumulatedDeviationPct: -60 },
        risk: { overdueActionPlans: 2, untreatedCriticalInsights: 2 },
      }),
      weights,
      thresholds,
    );
    expect(red.semaphore).toBe("red");
    expect(red.score).toBeLessThan(50);

    const amber = computeHealth(
      input({
        goal: { realized: 60, target: 100 },
        financial: { roi: 0, contributionMargin: 0, revenue: 1000 },
        execution: { actualProgress: 40, expectedProgress: 50, lateTasks: 1, totalTasks: 10 },
        businessPlan: { accumulatedDeviationPct: -20 },
      }),
      weights,
      thresholds,
    );
    expect(amber.semaphore).toBe("amber");
  });

  it("respeita pesos personalizados", () => {
    const onlyGoal = { goal: 100, financial: 0, execution: 0, businessPlan: 0, risk: 0 };
    const result = computeHealth(
      input({ goal: { realized: 50, target: 100 } }),
      onlyGoal,
      thresholds,
    );
    expect(result.score).toBe(50);
  });
});
