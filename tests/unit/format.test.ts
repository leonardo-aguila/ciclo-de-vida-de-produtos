import { describe, expect, it } from "vitest";
import {
  addDaysToIso,
  addMonthsToCompetence,
  businessDaysBetween,
  competenceRange,
  daysBetween,
  formatCompetence,
  formatCurrency,
  formatCurrencyCompact,
  formatDate,
  formatPercent,
  formatSignedPercent,
  monthsBetween,
  parseDecimalInput,
  toCompetence,
} from "@/lib/format";

describe("formatação pt-BR", () => {
  it("formata moeda em reais", () => {
    expect(formatCurrency(1234.5)).toBe("R$ 1.234,50");
    expect(formatCurrency(-980)).toBe("-R$ 980,00");
    expect(formatCurrency(null)).toBe("—");
  });

  it("formata datas como dd/mm/aaaa", () => {
    expect(formatDate("2024-03-15")).toBe("15/03/2024");
    expect(formatDate(null)).toBe("—");
  });

  it("formata competência como mm/aaaa", () => {
    expect(formatCompetence("2024-03-01")).toBe("03/2024");
  });

  it("usa vírgula decimal nos percentuais", () => {
    expect(formatPercent(12.34)).toBe("12,3%");
    expect(formatSignedPercent(4.2)).toBe("+4,2%");
    expect(formatSignedPercent(-4.2)).toBe("-4,2%");
  });

  it("lê números escritos no padrão brasileiro", () => {
    expect(parseDecimalInput("1.234,56")).toBe(1234.56);
    expect(parseDecimalInput("R$ 1.234,56")).toBe(1234.56);
    expect(parseDecimalInput("1234.56")).toBe(1234.56);
    expect(parseDecimalInput("980")).toBe(980);
    expect(parseDecimalInput("")).toBeNull();
    expect(parseDecimalInput("abc")).toBeNull();
  });
});

describe("aritmética de datas", () => {
  it("anda meses sem estourar o ano", () => {
    expect(addMonthsToCompetence("2024-11-01", 3)).toBe("2025-02-01");
    expect(addMonthsToCompetence("2024-01-01", -1)).toBe("2023-12-01");
  });

  it("conta dias e meses entre datas", () => {
    expect(daysBetween("2024-03-01", "2024-03-15")).toBe(14);
    expect(daysBetween("2024-03-15", "2024-03-01")).toBe(-14);
    expect(monthsBetween("2024-01-01", "2024-12-01")).toBe(11);
  });

  it("atravessa o horário de verão sem perder o dia", () => {
    expect(addDaysToIso("2024-10-19", 1)).toBe("2024-10-20");
    expect(addDaysToIso("2024-02-28", 2)).toBe("2024-03-01");
  });

  it("deriva a competência de uma data", () => {
    expect(toCompetence("2024-03-17")).toBe("2024-03-01");
  });

  it("gera intervalos de competência", () => {
    expect(competenceRange("2024-01-01", "2024-03-01")).toEqual([
      "2024-01-01",
      "2024-02-01",
      "2024-03-01",
    ]);
    expect(competenceRange("2024-03-01", "2024-01-01")).toEqual([]);
  });
});

describe("moeda compacta", () => {
  it("abrevia em mil, mi e bi sem depender do ICU do runtime", () => {
    expect(formatCurrencyCompact(0)).toBe("R$ 0");
    expect(formatCurrencyCompact(847)).toBe("R$ 847");
    expect(formatCurrencyCompact(1_200)).toBe("R$ 1,2 mil");
    expect(formatCurrencyCompact(847_000)).toBe("R$ 847 mil");
    expect(formatCurrencyCompact(3_140_000)).toBe("R$ 3,1 mi");
    expect(formatCurrencyCompact(2_400_000_000)).toBe("R$ 2,4 bi");
  });

  it("preserva o sinal", () => {
    expect(formatCurrencyCompact(-1_500_000)).toBe("-R$ 1,5 mi");
  });

  it("devolve travessão para ausência de valor", () => {
    expect(formatCurrencyCompact(null)).toBe("—");
    expect(formatCurrencyCompact(undefined)).toBe("—");
    expect(formatCurrencyCompact(Number.NaN)).toBe("—");
  });
});

describe("dias úteis", () => {
  it("não conta sábado nem domingo", () => {
    // 2026-10-08 é quinta. Até sexta 09/10 é 1. Até segunda 12/10 são 2
    // (sexta e segunda), e não 4: o fim de semana no meio não conta.
    expect(businessDaysBetween("2026-10-08", "2026-10-09")).toBe(1);
    expect(businessDaysBetween("2026-10-08", "2026-10-12")).toBe(2);
    expect(businessDaysBetween("2026-10-08", "2026-10-13")).toBe(3);
  });

  it("conta uma semana cheia como cinco", () => {
    expect(businessDaysBetween("2026-10-08", "2026-10-15")).toBe(5);
  });

  it("é simétrica e zero no mesmo dia", () => {
    expect(businessDaysBetween("2026-10-15", "2026-10-08")).toBe(-5);
    expect(businessDaysBetween("2026-10-08", "2026-10-08")).toBe(0);
  });

  it("ignora o fim de semana nas pontas", () => {
    // Sexta 09/10 → sábado 10/10: nenhum dia útil decorrido.
    expect(businessDaysBetween("2026-10-09", "2026-10-10")).toBe(0);
    // Sábado 10/10 → segunda 12/10: só a segunda conta.
    expect(businessDaysBetween("2026-10-10", "2026-10-12")).toBe(1);
  });

  it("atravessa o mês e o ano", () => {
    // 31/12/2026 é quinta; 04/01/2027 é segunda.
    expect(businessDaysBetween("2026-12-31", "2027-01-04")).toBe(2);
  });
});
