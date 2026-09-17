import { describe, expect, it } from "vitest";
import {
  accumulatedDeviation,
  checkDeviationTrigger,
  comparePlan,
  milestoneProgress,
  type PlannedMonth,
} from "@/lib/engine/business-plan";
import { buildMonthlySeries, type SaleRow } from "@/lib/engine/finance";

function planned(values: [string, number, number][]): PlannedMonth[] {
  return values.map(([competence, revenue, cost]) => ({
    competence,
    plannedRevenue: revenue,
    plannedCost: cost,
    plannedCustomers: 0,
    plannedMargin: revenue - cost,
  }));
}

function actuals(values: [string, number][]) {
  const sales: SaleRow[] = values.map(([competence, revenue]) => ({
    competence,
    newMrr: 0,
    recurringRevenue: revenue,
    oneTimeRevenue: 0,
    churnAmount: 0,
    activeCustomers: 0,
  }));
  return buildMonthlySeries(sales, []);
}

describe("plano × realizado", () => {
  const plan = planned([
    ["2026-01-01", 10000, 6000],
    ["2026-02-01", 12000, 6000],
    ["2026-03-01", 14000, 6000],
  ]);

  it("calcula desvio absoluto e percentual mês a mês", () => {
    const rows = comparePlan(
      plan,
      actuals([
        ["2026-01-01", 9000],
        ["2026-02-01", 12000],
        ["2026-03-01", 10000],
      ]),
    );

    expect(rows[0]).toMatchObject({ revenueDeviation: -1000, revenueDeviationPct: -10 });
    expect(rows[1]).toMatchObject({ revenueDeviation: 0, revenueDeviationPct: 0 });
    expect(rows[2]!.revenueDeviationPct).toBeCloseTo(-28.57, 1);
  });

  it("acumula plano e realizado ao longo dos meses", () => {
    const rows = comparePlan(
      plan,
      actuals([
        ["2026-01-01", 9000],
        ["2026-02-01", 9000],
      ]),
    );

    expect(rows[1]!.accumulatedPlannedRevenue).toBe(22000);
    expect(rows[1]!.accumulatedActualRevenue).toBe(18000);
    expect(rows[1]!.accumulatedDeviationPct).toBeCloseTo(-18.18, 1);
  });

  it("não conta como falha os meses que ainda não aconteceram", () => {
    const rows = comparePlan(plan, actuals([["2026-01-01", 10000]]));

    expect(rows[0]!.hasActual).toBe(true);
    expect(rows[1]!.hasActual).toBe(false);
    expect(rows[2]!.hasActual).toBe(false);
    // O acumulado considera só janeiro, que bateu o plano.
    expect(accumulatedDeviation(rows)).toBe(0);
    // E o mês futuro não acende alerta.
    expect(rows[1]!.status).toBe("green");
  });

  it("acende o farol por faixa de desvio", () => {
    const rows = comparePlan(
      plan,
      actuals([
        ["2026-01-01", 9900],
        ["2026-02-01", 11000],
        ["2026-03-01", 10000],
      ]),
    );

    expect(rows[0]!.status).toBe("green");
    expect(rows[1]!.status).toBe("amber");
    expect(rows[2]!.status).toBe("red");
  });

  it("não divide por zero quando o plano do mês é zero", () => {
    const rows = comparePlan(planned([["2026-01-01", 0, 0]]), actuals([["2026-01-01", 5000]]));
    expect(rows[0]!.revenueDeviationPct).toBeNull();
    expect(rows[0]!.revenueDeviation).toBe(5000);
  });

  it("devolve vazio para plano sem meses", () => {
    expect(comparePlan([], actuals([["2026-01-01", 100]]))).toEqual([]);
    expect(accumulatedDeviation([])).toBeNull();
  });

  it("trata mês planejado sem realizado como receita zero", () => {
    const rows = comparePlan(
      planned([
        ["2026-01-01", 10000, 0],
        ["2026-02-01", 10000, 0],
      ]),
      // Fevereiro existe na série (custo), mas sem receita.
      buildMonthlySeries(
        [
          {
            competence: "2026-01-01",
            newMrr: 0,
            recurringRevenue: 10000,
            oneTimeRevenue: 0,
            churnAmount: 0,
            activeCustomers: 0,
          },
          {
            competence: "2026-02-01",
            newMrr: 0,
            recurringRevenue: 0,
            oneTimeRevenue: 0,
            churnAmount: 0,
            activeCustomers: 0,
          },
        ],
        [],
      ),
    );

    expect(rows[1]!.actualRevenue).toBe(0);
    expect(rows[1]!.revenueDeviationPct).toBe(-100);
    expect(rows[1]!.status).toBe("red");
  });
});

describe("gatilho de plano de ação", () => {
  const plan = planned([
    ["2026-01-01", 10000, 0],
    ["2026-02-01", 10000, 0],
  ]);

  it("dispara quando o desvio acumulado passa o limite", () => {
    const rows = comparePlan(
      plan,
      actuals([
        ["2026-01-01", 8000],
        ["2026-02-01", 8000],
      ]),
    );

    const trigger = checkDeviationTrigger(rows, -15);
    expect(trigger.triggered).toBe(true);
    expect(trigger.deviation).toBe(-20);
    expect(trigger.message).toMatch(/ultrapassou o limite/i);
    expect(trigger.competence).toBe("2026-02-01");
  });

  it("não dispara dentro do limite, e diz o número mesmo assim", () => {
    const rows = comparePlan(
      plan,
      actuals([
        ["2026-01-01", 9500],
        ["2026-02-01", 9500],
      ]),
    );

    const trigger = checkDeviationTrigger(rows, -15);
    expect(trigger.triggered).toBe(false);
    expect(trigger.deviation).toBe(-5);
    expect(trigger.message).toMatch(/dentro do limite/i);
  });

  it("não dispara sem realizado nenhum", () => {
    const trigger = checkDeviationTrigger(comparePlan(plan, []), -15);
    expect(trigger.triggered).toBe(false);
    expect(trigger.deviation).toBeNull();
    expect(trigger.message).toMatch(/ainda não há realizado/i);
  });

  it("respeita limite personalizado", () => {
    const rows = comparePlan(
      plan,
      actuals([
        ["2026-01-01", 9000],
        ["2026-02-01", 9000],
      ]),
    );
    expect(checkDeviationTrigger(rows, -5).triggered).toBe(true);
    expect(checkDeviationTrigger(rows, -25).triggered).toBe(false);
  });
});

describe("marcos", () => {
  it("conta concluídos e atrasados", () => {
    const result = milestoneProgress(
      [
        { status: "done", targetDate: "2026-01-01" },
        { status: "pending", targetDate: "2026-02-01" },
        { status: "in_progress", targetDate: "2026-12-01" },
        { status: "done", targetDate: "2026-03-01" },
      ],
      "2026-06-01",
    );

    expect(result).toMatchObject({ total: 4, done: 2, late: 1, percent: 50 });
  });

  it("não divide por zero sem marcos", () => {
    expect(milestoneProgress([], "2026-06-01")).toMatchObject({ total: 0, percent: 0 });
  });
});
