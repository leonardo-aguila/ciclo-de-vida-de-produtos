import { describe, expect, it } from "vitest";
import type { MonthlyPoint } from "@/lib/engine/finance";
import {
  goalWindow,
  MEASURABLE_GOAL_TYPES,
  realizedForGoal,
  realizedFromMeasurements,
  type SaleForGoal,
} from "@/lib/engine/goals";

const sale = (newMrr: number, recurringRevenue = 0, activeCustomers = 0): SaleForGoal => ({
  newMrr,
  recurringRevenue,
  activeCustomers,
});

const point = (competence: string, revenue: number, cost: number): MonthlyPoint => ({
  competence,
  revenue,
  cost,
  capex: 0,
  opex: cost,
  variableCost: cost,
  contributionMargin: revenue - cost,
  result: revenue - cost,
  recurringResult: revenue - cost,
  accumulatedRevenue: revenue,
  accumulatedCost: cost,
});

describe("realização de meta", () => {
  it("mede novo MRR na janela do período, não só no último mês", () => {
    const sales = [sale(4_000), sale(5_000), sale(6_000), sale(7_000)];

    expect(goalWindow("monthly")).toBe(1);
    expect(realizedForGoal("new_mrr", [], sales, "monthly")).toBe(7_000);
    // O trimestre soma os três últimos: uma meta trimestral julgada por um
    // mês é julgada por ruído.
    expect(realizedForGoal("new_mrr", [], sales, "quarterly")).toBe(18_000);
    expect(realizedForGoal("new_mrr", [], sales, "annual")).toBe(22_000);
  });

  it("devolve nulo quando não há nenhum mês de venda", () => {
    // Produto pré-lançamento: ausência de mês não é mês com resultado zero.
    expect(realizedForGoal("new_mrr", [], [], "monthly")).toBeNull();
    expect(realizedForGoal("arr", [], [], "annual")).toBeNull();
    expect(realizedForGoal("customers", [], [], "monthly")).toBeNull();
    expect(realizedForGoal("one_time_revenue", [], [], "monthly")).toBeNull();
  });

  it("distingue mês sem venda de ausência de mês", () => {
    // Aqui houve um mês e ele veio zerado: isso é medição, e vale zero.
    expect(realizedForGoal("new_mrr", [], [sale(0)], "monthly")).toBe(0);
  });

  it("anualiza a receita recorrente do último mês para ARR", () => {
    expect(realizedForGoal("arr", [], [sale(0, 10_000)], "annual")).toBe(120_000);
  });

  it("mede redução de custo contra o primeiro mês, nunca negativa", () => {
    const falling = [point("2026-01-01", 0, 90_000), point("2026-02-01", 0, 70_000)];
    expect(realizedForGoal("cost_reduction", falling, [], "monthly")).toBe(20_000);

    const rising = [point("2026-01-01", 0, 70_000), point("2026-02-01", 0, 90_000)];
    expect(realizedForGoal("cost_reduction", rising, [], "monthly")).toBe(0);

    // Um mês só não tem contra o que comparar.
    expect(realizedForGoal("cost_reduction", [point("2026-01-01", 0, 70_000)], [], "monthly"))
      .toBeNull();
  });

  it("devolve nulo para os tipos que o sistema não coleta", () => {
    for (const code of ["nps", "market_share", "adoption", ""]) {
      expect(realizedForGoal(code, [], [sale(5_000)], "monthly")).toBeNull();
    }
  });
});

describe("apuração manual", () => {
  const nps = (competence: string, value: number) => ({ competence, value });

  it("usa a apuração mais recente, não a última inserida", () => {
    const out = realizedFromMeasurements(
      [nps("2026-08-01", 30), nps("2026-10-01", 42), nps("2026-09-01", 35)],
      "monthly",
      "2026-10-16",
    );
    expect(out).toEqual({ value: 42, competence: "2026-10-01" });
  });

  it("não soma: NPS é nível, não fluxo", () => {
    const out = realizedFromMeasurements(
      [nps("2026-08-01", 30), nps("2026-09-01", 35), nps("2026-10-01", 42)],
      "quarterly",
      "2026-10-16",
    );
    expect(out?.value).toBe(42);
  });

  it("descarta a apuração vencida para o período da meta", () => {
    // Meta mensal aceita até um mês atrás; esta tem três.
    expect(realizedFromMeasurements([nps("2026-07-01", 42)], "monthly", "2026-10-16")).toBeNull();
    // A mesma apuração serve para uma meta anual.
    expect(realizedFromMeasurements([nps("2026-07-01", 42)], "annual", "2026-10-16")).toEqual({
      value: 42,
      competence: "2026-07-01",
    });
  });

  it("aceita a apuração na borda da janela", () => {
    expect(realizedFromMeasurements([nps("2026-09-01", 42)], "monthly", "2026-10-16")?.value).toBe(42);
    expect(realizedFromMeasurements([nps("2026-08-01", 42)], "monthly", "2026-10-16")).toBeNull();
  });

  it("aceita apuração de um mês que ainda não fechou", () => {
    expect(realizedFromMeasurements([nps("2026-11-01", 42)], "monthly", "2026-10-16")?.value).toBe(42);
  });

  it("sem apuração nenhuma devolve null, não zero", () => {
    expect(realizedFromMeasurements([], "monthly", "2026-10-16")).toBeNull();
  });

  it("não se aplica aos tipos que a aplicação já deriva", () => {
    // O par: o que está aqui não tem apuração manual, e vice-versa.
    for (const code of ["new_mrr", "arr", "one_time_revenue", "customers", "cost_reduction"]) {
      expect(MEASURABLE_GOAL_TYPES.has(code)).toBe(true);
    }
    for (const code of ["nps", "market_share", "adoption"]) {
      expect(MEASURABLE_GOAL_TYPES.has(code)).toBe(false);
    }
  });
});
