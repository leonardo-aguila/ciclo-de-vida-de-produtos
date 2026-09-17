import { describe, expect, it } from "vitest";
import { parseCompetence, parseSalesCsv, toCsv } from "@/lib/csv";

describe("competência em CSV", () => {
  it("aceita os formatos que saem de uma planilha brasileira", () => {
    expect(parseCompetence("03/2026")).toBe("2026-03-01");
    expect(parseCompetence("3/2026")).toBe("2026-03-01");
    expect(parseCompetence("2026-03")).toBe("2026-03-01");
    expect(parseCompetence("2026-03-17")).toBe("2026-03-01");
    expect(parseCompetence("15/03/2026")).toBe("2026-03-01");
    expect(parseCompetence("mar/2026")).toBe("2026-03-01");
    expect(parseCompetence("março/2026")).toBe("2026-03-01");
  });

  it("recusa o que não é competência", () => {
    expect(parseCompetence("")).toBeNull();
    expect(parseCompetence("primeiro trimestre")).toBeNull();
    expect(parseCompetence("13/2026")).toBeNull();
  });
});

describe("importação de vendas", () => {
  const csv = [
    "competencia;receita_recorrente;receita_unica;churn;clientes_ativos;ticket_medio",
    "01/2026;48.000,00;5.000,00;2.000,00;120;400,00",
    "02/2026;55.500,00;0,00;1.800,00;124;447,58",
  ].join("\n");

  it("lê valores no padrão brasileiro", () => {
    const result = parseSalesCsv(csv);

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      competence: "2026-01-01",
      recurringRevenue: 48000,
      oneTimeRevenue: 5000,
      churnAmount: 2000,
      activeCustomers: 120,
      avgTicket: 400,
    });
  });

  it("aceita cabeçalhos alternativos e acentuados", () => {
    const alternative = [
      "Competência;MRR;Receita única;Clientes ativos",
      "01/2026;10.000,00;500,00;10",
    ].join("\n");

    const result = parseSalesCsv(alternative);
    expect(result.rows[0]).toMatchObject({
      competence: "2026-01-01",
      recurringRevenue: 10000,
      oneTimeRevenue: 500,
      activeCustomers: 10,
    });
  });

  it("reporta a linha com competência inválida em vez de descartá-la em silêncio", () => {
    const withBadLine = [
      "competencia;receita_recorrente",
      "01/2026;1000,00",
      "lixo;2000,00",
      "03/2026;3000,00",
    ].join("\n");

    const result = parseSalesCsv(withBadLine);
    expect(result.rows).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(3);
    expect(result.errors[0]!.message).toContain("Competência");
  });

  it("resolve competência repetida mantendo a última linha, e avisa", () => {
    const duplicated = [
      "competencia;receita_recorrente",
      "01/2026;1000,00",
      "01/2026;9999,00",
    ].join("\n");

    const result = parseSalesCsv(duplicated);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.recurringRevenue).toBe(9999);
    expect(result.errors[0]!.message).toMatch(/repetida/i);
  });

  it("trata coluna ausente como zero, não como erro", () => {
    const minimal = ["competencia;receita_recorrente", "01/2026;1000,00"].join("\n");
    const result = parseSalesCsv(minimal);
    expect(result.rows[0]).toMatchObject({ churnAmount: 0, newCustomers: 0, avgTicket: 0 });
    expect(result.errors).toEqual([]);
  });

  it("aceita arquivo separado por vírgula também", () => {
    const commaSeparated = ["competencia,receita_recorrente", "01/2026,1000.00"].join("\n");
    const result = parseSalesCsv(commaSeparated);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.recurringRevenue).toBe(1000);
  });

  it("devolve vazio para arquivo sem linhas", () => {
    const result = parseSalesCsv("competencia;receita_recorrente");
    expect(result.rows).toEqual([]);
  });
});

describe("exportação CSV", () => {
  it("usa ponto e vírgula, vírgula decimal e BOM", () => {
    const csv = toCsv(
      [{ nome: "Infra; cloud", valor: 1234.5 }],
      [
        { key: "nome", label: "Nome" },
        { key: "valor", label: "Valor" },
      ],
    );

    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Nome;Valor");
    // O ponto e vírgula dentro do texto obriga aspas.
    expect(csv).toContain('"Infra; cloud";1234,50');
  });

  it("escreve vazio para nulo e indefinido", () => {
    const csv = toCsv([{ a: null, b: undefined }], [
      { key: "a", label: "A" },
      { key: "b", label: "B" },
    ]);
    expect(csv.split("\n")[1]).toBe(";");
  });
});
