import { describe, expect, it } from "vitest";
import { DEFAULT_RECOMMENDATION_RULES } from "@/lib/defaults";
import { recommend, type RecommendationInput } from "@/lib/engine/recommendation";

const rules = DEFAULT_RECOMMENDATION_RULES;

function input(overrides: Partial<RecommendationInput> = {}): RecommendationInput {
  return {
    health: 60,
    roi: 10,
    projectedRoi: 10,
    momGrowth: 1,
    decliningMonths: 0,
    negativeMarginMonths: 0,
    goalReached: true,
    paybackCompetence: null,
    goalDeadline: null,
    ...overrides,
  };
}

describe("recomendação de continuidade", () => {
  it("escala produto saudável, lucrativo e crescendo", () => {
    const result = recommend(
      input({ health: 82, roi: 45, momGrowth: 6, projectedRoi: 60 }),
      rules,
    );

    expect(result.kind).toBe("scale");
    expect(result.label).toBe("Escalar");
    expect(result.rationale.length).toBeGreaterThan(0);
    expect(result.rationale.join(" ")).toContain("82");
  });

  it("mantém produto intermediário com retorno projetado positivo", () => {
    const result = recommend(input({ health: 62, roi: -5, projectedRoi: 18 }), rules);
    expect(result.kind).toBe("keep");
    expect(result.rationale.join(" ")).toContain("18,0%");
  });

  it("manda observar produto intermediário sem retorno projetado", () => {
    const result = recommend(input({ health: 55, projectedRoi: -12 }), rules);
    expect(result.kind).toBe("watch");
  });

  it("manda observar quando não dá para projetar o ROI", () => {
    const result = recommend(input({ health: 55, projectedRoi: null }), rules);
    expect(result.kind).toBe("watch");
    expect(result.rationale.join(" ")).toMatch(/histórico suficiente/i);
  });

  it("manda observar quando o payback cai depois do prazo da meta", () => {
    const result = recommend(
      input({
        health: 80,
        roi: 20,
        momGrowth: -1,
        paybackCompetence: "2027-12-01",
        goalDeadline: "2027-06-30",
      }),
      rules,
    );
    expect(result.kind).toBe("watch");
    expect(result.rationale.join(" ")).toMatch(/payback/i);
  });

  it("manda pivotar quando a receita cresce mas a margem é negativa há meses", () => {
    const result = recommend(
      input({
        health: 58,
        goalReached: false,
        momGrowth: 8,
        negativeMarginMonths: 4,
        projectedRoi: 5,
      }),
      rules,
    );

    expect(result.kind).toBe("pivot");
    expect(result.rationale.join(" ")).toMatch(/margem de contribuição é negativa/i);
    expect(result.evidence.some((item) => item.label === "Meses de margem negativa")).toBe(true);
  });

  it("não manda pivotar com margem negativa por menos meses que o limite", () => {
    const result = recommend(
      input({ health: 58, goalReached: false, momGrowth: 8, negativeMarginMonths: 2 }),
      rules,
    );
    expect(result.kind).not.toBe("pivot");
  });

  it("manda descontinuar com ROI negativo, projeção negativa e queda persistente", () => {
    const result = recommend(
      input({
        health: 28,
        roi: -62,
        projectedRoi: -40,
        momGrowth: -9,
        decliningMonths: 5,
      }),
      rules,
    );

    expect(result.kind).toBe("discontinue");
    expect(result.severity).toBe(5);
    expect(result.rationale.join(" ")).toMatch(/não devolveu o que custou/i);
    expect(result.rationale.join(" ")).toMatch(/5 meses/);
  });

  it("descontinuar vence pivotar quando os dois se aplicam", () => {
    // A ordem importa: a resposta mais branda esconderia o achado.
    const result = recommend(
      input({
        health: 30,
        roi: -70,
        projectedRoi: -50,
        momGrowth: 3,
        decliningMonths: 4,
        negativeMarginMonths: 6,
        goalReached: false,
      }),
      rules,
    );
    expect(result.kind).toBe("discontinue");
  });

  it("não descontinua com queda por menos meses que o limite", () => {
    const result = recommend(
      input({ health: 30, roi: -62, projectedRoi: -40, decliningMonths: 2 }),
      rules,
    );
    expect(result.kind).not.toBe("discontinue");
  });

  it("não descontinua produto sem custo lançado, em que o ROI é desconhecido", () => {
    const result = recommend(
      input({ health: 40, roi: null, projectedRoi: null, decliningMonths: 6 }),
      rules,
    );
    expect(result.kind).not.toBe("discontinue");
  });

  it("produto recém-criado, sem número nenhum, cai em observar e diz por quê", () => {
    const result = recommend(
      input({
        health: 100,
        roi: null,
        projectedRoi: null,
        momGrowth: null,
        goalReached: null,
      }),
      rules,
    );

    expect(result.kind).toBe("watch");
    expect(result.rationale.length).toBeGreaterThan(0);
  });

  it("sempre traz as evidências numéricas que sustentam o texto", () => {
    const result = recommend(input({ health: 82, roi: 45, momGrowth: 6 }), rules);
    const labels = result.evidence.map((item) => item.label);

    expect(labels).toContain("Health Score");
    expect(labels).toContain("ROI acumulado");
    expect(labels).toContain("ROI projetado 12M");
    expect(labels).toContain("Crescimento MoM (3M)");
  });

  it("respeita limites personalizados", () => {
    const strict = {
      ...rules,
      scale: { minHealth: 95, minRoi: 50, minMomGrowth: 10 },
    };
    const result = recommend(input({ health: 82, roi: 45, momGrowth: 6 }), strict);
    expect(result.kind).not.toBe("scale");
  });

  it("ordena a severidade da mais grave para a mais branda", () => {
    const discontinue = recommend(
      input({ health: 20, roi: -80, projectedRoi: -60, decliningMonths: 6 }),
      rules,
    );
    const scale = recommend(input({ health: 90, roi: 80, momGrowth: 10 }), rules);
    expect(discontinue.severity).toBeGreaterThan(scale.severity);
  });
});

describe("produto saudável que ainda não se pagou", () => {
  it('recomenda "manter" em vez de "observar"', () => {
    // Crescimento forte, CAPEX ainda não recuperado: o ROI acumulado é
    // negativo, então "escalar" não se aplica; a saúde está acima da faixa
    // intermediária, então a regra de "manter" pela faixa também não pega.
    const result = recommend(
      {
        health: 82,
        roi: -45,
        projectedRoi: 19,
        momGrowth: 11,
        decliningMonths: 0,
        negativeMarginMonths: 0,
        goalReached: true,
        paybackCompetence: null,
        goalDeadline: null,
      },
      DEFAULT_RECOMMENDATION_RULES,
    );

    expect(result.kind).toBe("keep");
    expect(result.rationale.join(" ")).toMatch(/não se pagou|payback/i);
  });

  it('continua em "observar" quando não há projeção para sustentar a continuidade', () => {
    const result = recommend(
      {
        health: 82,
        roi: -45,
        projectedRoi: null,
        momGrowth: 11,
        decliningMonths: 0,
        negativeMarginMonths: 0,
        goalReached: true,
        paybackCompetence: null,
        goalDeadline: null,
      },
      DEFAULT_RECOMMENDATION_RULES,
    );

    expect(result.kind).toBe("watch");
  });
});

describe("produto sem dados para avaliar", () => {
  it("não emite veredito quando a saúde não pôde ser medida", () => {
    const result = recommend(
      {
        health: 100,
        healthMeasured: false,
        roi: null,
        projectedRoi: null,
        momGrowth: null,
        decliningMonths: 0,
        negativeMarginMonths: 0,
        goalReached: null,
        paybackCompetence: null,
        goalDeadline: null,
      },
      DEFAULT_RECOMMENDATION_RULES,
    );

    // "Observar" é o mais brando dos valores disponíveis; o que muda é o texto,
    // que não pode afirmar um Health Score de 100 construído sobre um
    // componente só.
    expect(result.kind).toBe("watch");
    expect(result.rationale[0]).toMatch(/não há dados suficientes/i);
    expect(result.rationale.join(" ")).not.toMatch(/Health Score de 100/);
    expect(result.evidence.find((item) => item.label === "Health Score")?.value).toBe("sem medição");
  });
});


