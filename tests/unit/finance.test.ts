import { describe, expect, it } from "vitest";
import {
  annualizedMaintenanceCost,
  annualizedRevenue,
  averageMomGrowth,
  buildMonthlySeries,
  consecutiveDecliningMonths,
  consecutiveNegativeMarginMonths,
  momGrowth,
  monthlyRevenue,
  payback,
  revenueStability,
  roiOf,
  runway,
  summarize,
  totalByType,
  type CostRow,
  type SaleRow,
} from "@/lib/engine/finance";

function sale(competence: string, overrides: Partial<SaleRow> = {}): SaleRow {
  return {
    competence,
    newMrr: 0,
    recurringRevenue: 0,
    oneTimeRevenue: 0,
    churnAmount: 0,
    activeCustomers: 0,
    ...overrides,
  };
}

function cost(competenceDate: string, amount: number, overrides: Partial<CostRow> = {}): CostRow {
  return { competenceDate, amount, isVariable: false, typeCode: "capex", ...overrides };
}

describe("receita mensal", () => {
  it("soma recorrente e única e desconta o churn", () => {
    expect(
      monthlyRevenue(
        sale("2026-01-01", { recurringRevenue: 10000, oneTimeRevenue: 2000, churnAmount: 1500 }),
      ),
    ).toBe(10500);
  });
});

describe("série mensal", () => {
  it("acumula receita e custo mês a mês", () => {
    const series = buildMonthlySeries(
      [
        sale("2026-01-01", { recurringRevenue: 1000 }),
        sale("2026-02-01", { recurringRevenue: 1500 }),
      ],
      [cost("2026-01-01", 5000)],
    );

    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({ revenue: 1000, cost: 5000, accumulatedCost: 5000 });
    expect(series[1]).toMatchObject({
      revenue: 1500,
      accumulatedRevenue: 2500,
      accumulatedCost: 5000,
    });
  });

  it("preenche meses sem movimento em vez de saltar entre pontos distantes", () => {
    const series = buildMonthlySeries(
      [sale("2026-01-01", { recurringRevenue: 1000 }), sale("2026-04-01", { recurringRevenue: 900 })],
      [],
    );

    expect(series.map((point) => point.competence)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
    ]);
    expect(series[1]!.revenue).toBe(0);
    expect(series[1]!.accumulatedRevenue).toBe(1000);
  });

  it("separa custo variável e OPEX para a margem de contribuição", () => {
    const series = buildMonthlySeries(
      [sale("2026-01-01", { recurringRevenue: 10000 })],
      [
        cost("2026-01-01", 3000, { isVariable: true, typeCode: "opex" }),
        cost("2026-01-01", 20000, { isVariable: false, typeCode: "capex" }),
      ],
    );

    expect(series[0]).toMatchObject({
      cost: 23000,
      variableCost: 3000,
      opex: 3000,
      contributionMargin: 7000,
      result: -13000,
    });
  });

  it("usa a competência do dia informado, não o dia exato", () => {
    const series = buildMonthlySeries([], [cost("2026-03-17", 500), cost("2026-03-29", 700)]);
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ competence: "2026-03-01", cost: 1200 });
  });

  it("devolve série vazia sem dado nenhum", () => {
    expect(buildMonthlySeries([], [])).toEqual([]);
  });
});

describe("ROI", () => {
  it("calcula o retorno sobre o custo", () => {
    expect(roiOf(150, 100)).toBe(50);
    expect(roiOf(50, 100)).toBe(-50);
    expect(roiOf(100, 100)).toBe(0);
  });

  it("não devolve infinito quando o custo é zero", () => {
    expect(roiOf(1000, 0)).toBeNull();
    expect(roiOf(0, 0)).toBeNull();
    expect(roiOf(1000, -5)).toBeNull();
  });
});

describe("resumo financeiro", () => {
  it("resume um produto sem histórico sem quebrar", () => {
    const summary = summarize([]);
    expect(summary).toMatchObject({
      accumulatedRevenue: 0,
      accumulatedCost: 0,
      roi: null,
      burn: null,
      months: 0,
    });
  });

  it("calcula o burn médio só sobre os meses negativos", () => {
    const series = buildMonthlySeries(
      [
        sale("2026-01-01", { recurringRevenue: 1000 }),
        sale("2026-02-01", { recurringRevenue: 1000 }),
        sale("2026-03-01", { recurringRevenue: 5000 }),
      ],
      [cost("2026-01-01", 3000), cost("2026-02-01", 2000), cost("2026-03-01", 1000)],
    );

    const summary = summarize(series);
    // Meses negativos: -2000 e -1000; média 1500.
    expect(summary.burn).toBe(1500);
    expect(summary.accumulatedRevenue).toBe(7000);
    expect(summary.accumulatedCost).toBe(6000);
  });
});

describe("payback", () => {
  it("encontra o mês em que a receita acumulada ultrapassa o custo", () => {
    const series = buildMonthlySeries(
      [
        sale("2026-01-01", { recurringRevenue: 4000 }),
        sale("2026-02-01", { recurringRevenue: 4000 }),
        sale("2026-03-01", { recurringRevenue: 4000 }),
      ],
      [cost("2026-01-01", 10000)],
    );

    const result = payback(series);
    expect(result.status).toBe("reached");
    expect(result.competence).toBe("2026-03-01");
    expect(result.months).toBe(2);
  });

  it("estima o mês quando ainda não aconteceu, e diz que é estimativa", () => {
    const series = buildMonthlySeries(
      [
        sale("2026-01-01", { recurringRevenue: 3000 }),
        sale("2026-02-01", { recurringRevenue: 3000 }),
      ],
      [cost("2026-01-01", 10000)],
    );

    const result = payback(series);
    expect(result.status).toBe("estimated");
    // Faltam 4000 e o ritmo recorrente é 3000/mês — o CAPEX de janeiro já está
    // no buraco a cobrir e não se repete. Logo, mais 2 meses.
    expect(result.competence).toBe("2026-04-01");
  });

  it("não deixa um investimento único do passado declarar o produto irrecuperável", () => {
    const series = buildMonthlySeries(
      [
        sale("2026-01-01", { recurringRevenue: 3000 }),
        sale("2026-02-01", { recurringRevenue: 3000 }),
        sale("2026-03-01", { recurringRevenue: 3000 }),
      ],
      [
        // CAPEX alto no primeiro mês, depois só custeio.
        cost("2026-01-01", 30000, { typeCode: "capex" }),
        cost("2026-02-01", 500, { typeCode: "opex", isVariable: true }),
        cost("2026-03-01", 500, { typeCode: "opex", isVariable: true }),
      ],
    );

    const result = payback(series);
    expect(result.status).toBe("estimated");
    expect(result.competence).not.toBeNull();
  });

  it("diz que não chega quando o custeio recorrente supera a receita todo mês", () => {
    const series = buildMonthlySeries(
      [
        sale("2026-01-01", { recurringRevenue: 1000 }),
        sale("2026-02-01", { recurringRevenue: 900 }),
      ],
      [
        cost("2026-01-01", 5000, { typeCode: "opex", isVariable: true }),
        cost("2026-02-01", 5000, { typeCode: "opex", isVariable: true }),
      ],
    );

    expect(payback(series).status).toBe("unreachable");
  });

  it("não inventa payback para produto sem histórico", () => {
    expect(payback([]).status).toBe("insufficient_data");
    const single = buildMonthlySeries([sale("2026-01-01", { recurringRevenue: 10 })], [cost("2026-01-01", 1000)]);
    expect(payback(single).status).toBe("insufficient_data");
  });

  it("considera pago no primeiro mês quando não houve custo nenhum", () => {
    const series = buildMonthlySeries([sale("2026-01-01", { recurringRevenue: 500 })], []);
    const result = payback(series);
    expect(result.status).toBe("reached");
    expect(result.months).toBe(0);
  });
});

describe("runway", () => {
  it("divide o caixa pelo burn", () => {
    expect(runway(30000, 5000)).toBe(6);
  });

  it("não devolve runway sem burn", () => {
    expect(runway(30000, null)).toBeNull();
    expect(runway(30000, 0)).toBeNull();
  });
});

describe("crescimento e tendência", () => {
  const growing = buildMonthlySeries(
    [
      sale("2026-01-01", { recurringRevenue: 1000 }),
      sale("2026-02-01", { recurringRevenue: 1100 }),
      sale("2026-03-01", { recurringRevenue: 1210 }),
    ],
    [],
  );

  it("calcula o crescimento MoM e ignora o primeiro mês", () => {
    const growth = momGrowth(growing);
    expect(growth[0]).toBeNull();
    expect(growth[1]).toBeCloseTo(10, 5);
    expect(growth[2]).toBeCloseTo(10, 5);
  });

  it("não divide por zero quando o mês anterior foi zero", () => {
    const series = buildMonthlySeries(
      [sale("2026-01-01"), sale("2026-02-01", { recurringRevenue: 500 })],
      [],
    );
    expect(momGrowth(series)[1]).toBeNull();
    expect(averageMomGrowth(series)).toBeNull();
  });

  it("conta meses seguidos de queda", () => {
    const declining = buildMonthlySeries(
      [
        sale("2026-01-01", { recurringRevenue: 5000 }),
        sale("2026-02-01", { recurringRevenue: 4500 }),
        sale("2026-03-01", { recurringRevenue: 4000 }),
        sale("2026-04-01", { recurringRevenue: 3500 }),
      ],
      [],
    );
    expect(consecutiveDecliningMonths(declining)).toBe(3);
    expect(consecutiveDecliningMonths(growing)).toBe(0);
  });

  it("conta meses seguidos de margem negativa", () => {
    const series = buildMonthlySeries(
      [
        sale("2026-01-01", { recurringRevenue: 5000 }),
        sale("2026-02-01", { recurringRevenue: 1000 }),
        sale("2026-03-01", { recurringRevenue: 1000 }),
      ],
      [
        cost("2026-01-01", 1000, { isVariable: true }),
        cost("2026-02-01", 3000, { isVariable: true }),
        cost("2026-03-01", 3000, { isVariable: true }),
      ],
    );
    expect(consecutiveNegativeMarginMonths(series)).toBe(2);
  });

  it("mede a estabilidade da receita pelo coeficiente de variação", () => {
    const stable = buildMonthlySeries(
      [
        sale("2026-01-01", { recurringRevenue: 1000 }),
        sale("2026-02-01", { recurringRevenue: 1000 }),
        sale("2026-03-01", { recurringRevenue: 1000 }),
      ],
      [],
    );
    expect(revenueStability(stable)).toBe(0);
    expect(revenueStability(growing)!).toBeGreaterThan(0);
    expect(revenueStability([])).toBeNull();
  });
});

describe("anualização", () => {
  it("projeta 12 meses a partir da média, mesmo com menos histórico", () => {
    const series = buildMonthlySeries(
      [sale("2026-01-01", { recurringRevenue: 1000 }), sale("2026-02-01", { recurringRevenue: 1000 })],
      [
        cost("2026-01-01", 200, { typeCode: "opex" }),
        cost("2026-02-01", 200, { typeCode: "opex" }),
      ],
    );

    expect(annualizedRevenue(series)).toBe(12000);
    expect(annualizedMaintenanceCost(series)).toBe(2400);
  });

  it("devolve zero sem histórico", () => {
    expect(annualizedRevenue([])).toBe(0);
    expect(annualizedMaintenanceCost([])).toBe(0);
  });
});

describe("totais por tipo", () => {
  it("soma apenas o tipo pedido", () => {
    const costs = [
      cost("2026-01-01", 1000, { typeCode: "capex" }),
      cost("2026-01-01", 500, { typeCode: "opex" }),
      cost("2026-02-01", 700, { typeCode: "capex" }),
    ];
    expect(totalByType(costs, "capex")).toBe(1700);
    expect(totalByType(costs, "opex")).toBe(500);
    expect(totalByType(costs, "inexistente")).toBe(0);
  });
});
