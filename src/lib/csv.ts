/**
 * CSV import helpers.
 *
 * The file the user brings comes from a Brazilian spreadsheet: semicolons,
 * "1.234,56", "03/2024". Parsing is deliberate about all three, and every
 * rejected row is reported with its line number instead of silently dropped.
 */
import Papa from "papaparse";
import { parseDecimalInput } from "@/lib/format";

export type CsvRowError = { line: number; message: string };

export type CsvParseResult<T> = {
  rows: T[];
  errors: CsvRowError[];
  /** Header names found in the file, for the mapping hint. */
  headers: string[];
};

/** Accepts "2024-03", "03/2024", "2024-03-15" and "mar/2024". */
export function parseCompetence(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  const iso = /^(\d{4})-(\d{2})(-\d{2})?$/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-01`;

  const brazilian = /^(\d{1,2})\/(\d{4})$/.exec(value);
  if (brazilian) {
    const month = Number(brazilian[1]);
    if (month < 1 || month > 12) return null;
    return `${brazilian[2]}-${String(month).padStart(2, "0")}-01`;
  }

  const fullDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (fullDate) {
    const month = Number(fullDate[2]);
    if (month < 1 || month > 12) return null;
    return `${fullDate[3]}-${String(month).padStart(2, "0")}-01`;
  }

  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const named = /^([a-zç]{3})[a-zç]*[/\s-](\d{4})$/i.exec(
    value.normalize("NFD").replace(/[̀-ͯ]/g, ""),
  );
  if (named) {
    const index = months.indexOf(named[1]!.toLowerCase());
    if (index >= 0) return `${named[2]}-${String(index + 1).padStart(2, "0")}-01`;
  }

  return null;
}

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export type SalesCsvRow = {
  competence: string;
  newMrr: number;
  recurringRevenue: number;
  oneTimeRevenue: number;
  churnAmount: number;
  churnRate: number;
  newCustomers: number;
  activeCustomers: number;
  churnedCustomers: number;
  avgTicket: number;
};

/** Header aliases, so the user does not have to rename their spreadsheet. */
const SALES_FIELDS: Record<keyof SalesCsvRow, string[]> = {
  competence: ["competencia", "mes", "mes_ano", "periodo", "competence"],
  newMrr: ["novo_mrr", "new_mrr", "mrr_novo", "receita_nova"],
  recurringRevenue: ["receita_recorrente", "mrr", "recorrente", "recurring_revenue"],
  oneTimeRevenue: ["receita_unica", "receita_pontual", "one_time_revenue", "unica"],
  churnAmount: ["churn", "churn_valor", "valor_churn", "churn_amount"],
  churnRate: ["churn_percentual", "churn_pct", "churn_rate", "percentual_churn"],
  newCustomers: ["clientes_novos", "novos_clientes", "new_customers"],
  activeCustomers: ["clientes_ativos", "ativos", "active_customers"],
  churnedCustomers: ["clientes_cancelados", "cancelados", "churned_customers"],
  avgTicket: ["ticket_medio", "ticket", "avg_ticket"],
};

export const SALES_CSV_TEMPLATE = [
  "competencia;novo_mrr;receita_recorrente;receita_unica;churn;churn_percentual;clientes_novos;clientes_ativos;clientes_cancelados;ticket_medio",
  "01/2026;12000,00;48000,00;5000,00;2000,00;4,0;8;120;2;400,00",
  "02/2026;9500,00;55500,00;0,00;1800,00;3,2;6;124;2;447,58",
].join("\n");

export function parseSalesCsv(text: string): CsvParseResult<SalesCsvRow> {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: "greedy",
    // Brazilian spreadsheets export with ";" — let papaparse detect it.
    delimiter: "",
    transformHeader: normalizeHeader,
  });

  const headers = parsed.meta.fields ?? [];
  const errors: CsvRowError[] = [];
  const rows: SalesCsvRow[] = [];

  const pick = (row: Record<string, string>, field: keyof SalesCsvRow): string => {
    for (const alias of SALES_FIELDS[field]) {
      const value = row[alias];
      if (value !== undefined && value !== "") return value;
    }
    return "";
  };

  const numeric = (row: Record<string, string>, field: keyof SalesCsvRow): number =>
    parseDecimalInput(pick(row, field)) ?? 0;

  parsed.data.forEach((row, index) => {
    // +2: the header is line 1, and humans count from 1.
    const line = index + 2;
    const competence = parseCompetence(pick(row, "competence"));

    if (!competence) {
      errors.push({
        line,
        message: `Competência ausente ou inválida ("${pick(row, "competence")}"). Use 03/2026 ou 2026-03.`,
      });
      return;
    }

    rows.push({
      competence,
      newMrr: numeric(row, "newMrr"),
      recurringRevenue: numeric(row, "recurringRevenue"),
      oneTimeRevenue: numeric(row, "oneTimeRevenue"),
      churnAmount: numeric(row, "churnAmount"),
      churnRate: numeric(row, "churnRate"),
      newCustomers: Math.round(numeric(row, "newCustomers")),
      activeCustomers: Math.round(numeric(row, "activeCustomers")),
      churnedCustomers: Math.round(numeric(row, "churnedCustomers")),
      avgTicket: numeric(row, "avgTicket"),
    });
  });

  // The same competence twice in one file would fight over the same row.
  const seen = new Map<string, number>();
  const deduped: SalesCsvRow[] = [];
  rows.forEach((row, index) => {
    const previous = seen.get(row.competence);
    if (previous !== undefined) {
      errors.push({
        line: index + 2,
        message: `Competência ${row.competence.slice(0, 7)} repetida no arquivo; a última linha prevalece.`,
      });
      deduped[previous] = row;
      return;
    }
    seen.set(row.competence, deduped.length);
    deduped.push(row);
  });

  for (const error of parsed.errors.slice(0, 5)) {
    errors.push({ line: (error.row ?? 0) + 2, message: error.message });
  }

  return { rows: deduped, errors, headers };
}

/** Serializes rows to CSV in the pt-BR dialect: ";" and decimal comma. */
export function toCsv(
  rows: Record<string, string | number | null | undefined>[],
  columns: { key: string; label: string }[],
): string {
  const escape = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return "";
    const text = typeof value === "number" ? value.toFixed(2).replace(".", ",") : String(value);
    return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const header = columns.map((column) => escape(column.label)).join(";");
  const body = rows.map((row) => columns.map((column) => escape(row[column.key])).join(";"));
  // BOM so Excel opens the accents correctly.
  return `﻿${[header, ...body].join("\n")}`;
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export type PlanCsvRow = {
  competence: string;
  plannedRevenue: number;
  plannedCost: number;
  plannedCustomers: number;
  plannedMargin: number;
};

const PLAN_FIELDS: Record<keyof PlanCsvRow, string[]> = {
  competence: ["competencia", "mes", "mes_ano", "periodo", "competence"],
  plannedRevenue: ["receita_planejada", "receita", "planned_revenue"],
  plannedCost: ["custo_planejado", "custo", "planned_cost"],
  plannedCustomers: ["clientes_planejados", "clientes", "planned_customers"],
  plannedMargin: ["margem_planejada", "margem", "planned_margin"],
};

export const PLAN_CSV_TEMPLATE = [
  "competencia;receita_planejada;custo_planejado;clientes_planejados;margem_planejada",
  "01/2026;50000,00;30000,00;100;20000,00",
  "02/2026;58000,00;31000,00;110;27000,00",
].join("\n");

/**
 * Business plan projections from a spreadsheet. Margin is derived when the
 * file does not bring it — a plan where margin disagrees with revenue minus
 * cost is a plan nobody can reconcile.
 */
export function parsePlanCsv(text: string): CsvParseResult<PlanCsvRow> {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: "greedy",
    delimiter: "",
    transformHeader: normalizeHeader,
  });

  const errors: CsvRowError[] = [];
  const rows: PlanCsvRow[] = [];

  const pick = (row: Record<string, string>, field: keyof PlanCsvRow): string => {
    for (const alias of PLAN_FIELDS[field]) {
      const value = row[alias];
      if (value !== undefined && value !== "") return value;
    }
    return "";
  };

  parsed.data.forEach((row, index) => {
    const line = index + 2;
    const competence = parseCompetence(pick(row, "competence"));
    if (!competence) {
      errors.push({
        line,
        message: `Competência ausente ou inválida ("${pick(row, "competence")}"). Use 03/2026 ou 2026-03.`,
      });
      return;
    }

    const plannedRevenue = parseDecimalInput(pick(row, "plannedRevenue")) ?? 0;
    const plannedCost = parseDecimalInput(pick(row, "plannedCost")) ?? 0;
    const declaredMargin = parseDecimalInput(pick(row, "plannedMargin"));

    rows.push({
      competence,
      plannedRevenue,
      plannedCost,
      plannedCustomers: Math.round(parseDecimalInput(pick(row, "plannedCustomers")) ?? 0),
      plannedMargin: declaredMargin ?? plannedRevenue - plannedCost,
    });
  });

  const seen = new Map<string, number>();
  const deduped: PlanCsvRow[] = [];
  rows.forEach((row, index) => {
    const previous = seen.get(row.competence);
    if (previous !== undefined) {
      errors.push({
        line: index + 2,
        message: `Competência ${row.competence.slice(0, 7)} repetida no arquivo; a última linha prevalece.`,
      });
      deduped[previous] = row;
      return;
    }
    seen.set(row.competence, deduped.length);
    deduped.push(row);
  });

  return { rows: deduped, errors, headers: parsed.meta.fields ?? [] };
}
