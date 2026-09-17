import { describe, expect, it } from "vitest";
import { buildMonthlySeries, type CostRow, type SaleRow } from "@/lib/engine/finance";
import { projectRoi, revenueTrend, runningCostAverage } from "@/lib/engine/projection";

function series(revenues: number[], costs: Partial<CostRow>[] = []) {
  const sales: SaleRow[] = revenues.map((revenue, index) => ({
    competence: `2026-${String(index + 1).padStart(2, "0")}-01`,
    newMrr: 0,
    recurringRevenue: revenue,
    oneTimeRevenue: 0,
    churnAmount: 0,
    activeCustomers: 0,
  }));
  const costRows: CostRow[] = costs.map((cost, index) => ({
    competenceDate: cost.competenceDate ?? `2026-${String(index + 1).padStart(2, "0")}-01`,
    amount: cost.amount ?? 0,
    isVariable: cost.isVariable ?? false,
    typeCode: cost.typeCode ?? "opex",
  }));
  return buildMonthlySeries(sales, costRows);
}

describe("tendência da receita", () => {
  it("encontra a inclinação de uma série perfeitamente linear", () => {
    const trend = revenueTrend(series([1000, 1100, 1200, 1300]))!;
    expect(trend.slope).toBeCloseTo(100, 5);
    expect(trend.rSquared).toBeCloseTo(1, 5);
    expect(trend.windowMonths).toBe(4);
  });

  it("encontra inclinação negativa numa série em queda", () => {
    const trend = revenueTrend(series([5000, 4500, 4000, 3500]))!;
    expect(trend.slope).toBeCloseTo(-500, 5);
  });

  it("trata série plana como ajuste perfeito de uma reta plana", () => {
    const trend = revenueTrend(series([1000, 1000, 1000]))!;
    expect(trend.slope).toBe(0);
    expect(trend.rSquared).toBe(1);
  });

  it("não projeta tendência com menos de três meses", () => {
    expect(revenueTrend(series([1000, 2000]))).toBeNull();
    expect(revenueTrend([])).toBeNull();
  });

  it("usa apenas a janela pedida", () => {
    // Doze meses, sendo os seis últimos estáveis.
    const trend = revenueTrend(series([100, 200, 300, 400, 500, 600, 1000, 1000, 1000, 1000, 1000, 1000]), 6)!;
    expect(trend.slope).toBeCloseTo(0, 5);
    expect(trend.windowMonths).toBe(6);
  });

  it("dá r² baixo para série irregular", () => {
    const trend = revenueTrend(series([1000, 5000, 1200, 4800, 900, 5200]))!;
    expect(trend.rSquared).toBeLessThan(0.4);
  });
});

describe("custo recorrente médio", () => {
  it("ignora o investimento único na média", () => {
    const rows = series(
      [1000, 1000, 1000],
      [
        { amount: 30000, typeCode: "capex" },
        { amount: 500, typeCode: "opex" },
        { amount: 500, typeCode: "opex" },
      ],
    );
    // Janeiro entra com custo recorrente zero; a média é (0 + 500 + 500)/3.
    expect(runningCostAverage(rows)).toBeCloseTo(333.33, 1);
  });

  it("devolve zero sem série", () => {
    expect(runningCostAverage([])).toBe(0);
  });
});

describe("ROI projetado", () => {
  it("projeta receita e custo pelo horizonte e recalcula o ROI", () => {
    const rows = series(
      [10000, 11000, 12000, 13000],
      [
        { amount: 5000, typeCode: "opex" },
        { amount: 5000, typeCode: "opex" },
        { amount: 5000, typeCode: "opex" },
        { amount: 5000, typeCode: "opex" },
      ],
    );

    const projection = projectRoi(rows, { windowMonths: 4, horizonMonths: 12 })!;

    expect(projection.months).toHaveLength(12);
    expect(projection.months[0]!.competence).toBe("2026-05-01");
    // A receita continua subindo 1000 por mês.
    expect(projection.months[0]!.revenue).toBeCloseTo(14000, 0);
    expect(projection.basis.monthlySlope).toBeCloseTo(1000, 0);
    expect(projection.projectedRoi).toBeGreaterThan(0);
    expect(projection.confidence).toBe("medium");
  });

  it("não deixa a receita projetada ficar negativa", () => {
    const rows = series([5000, 3000, 1000, 200]);
    const projection = projectRoi(rows, { windowMonths: 4, horizonMonths: 12 })!;
    expect(projection.months.every((month) => month.revenue >= 0)).toBe(true);
    // A reta desceria abaixo de zero; o piso segura.
    expect(projection.months[11]!.revenue).toBe(0);
  });

  it("devolve nulo para produto recém-criado, sem histórico", () => {
    expect(projectRoi([])).toBeNull();
    expect(projectRoi(series([1000, 1100]))).toBeNull();
  });

  it("não devolve ROI projetado quando não há custo nenhum", () => {
    const projection = projectRoi(series([1000, 1100, 1200]))!;
    expect(projection.projectedRoi).toBeNull();
    expect(projection.projectedRevenue).toBeGreaterThan(0);
  });

  it("classifica a confiança pela janela e pelo ajuste", () => {
    const solid = projectRoi(series([1000, 1100, 1200, 1300, 1400, 1500]), { windowMonths: 6 })!;
    expect(solid.confidence).toBe("high");

    const noisy = projectRoi(series([1000, 5000, 1200, 4800, 900, 5200]), { windowMonths: 6 })!;
    expect(noisy.confidence).toBe("low");

    const short = projectRoi(series([1000, 1100, 1200]), { windowMonths: 6 })!;
    expect(short.confidence).toBe("low");
  });

  it("informa a base usada, para a tela poder declarar que é projeção", () => {
    const projection = projectRoi(series([1000, 1100, 1200, 1300, 1400, 1500]), {
      windowMonths: 6,
      horizonMonths: 12,
    })!;

    expect(projection.basis).toMatchObject({ windowMonths: 6, horizonMonths: 12 });
    expect(projection.basis.rSquared).toBeGreaterThan(0.9);
  });
});
