import { describe, expect, it } from "vitest";
import {
  addDaysToIso,
  addMonthsToCompetence,
  competenceRange,
  daysBetween,
  formatCompetence,
  formatCurrency,
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
