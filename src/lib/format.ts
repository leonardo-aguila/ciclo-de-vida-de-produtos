/**
 * pt-BR formatting. Every number, date and amount the user sees goes through
 * here, so the locale lives in one file instead of being retyped per component.
 */

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

export function formatCurrency(value: number | null | undefined, currency = "BRL"): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (currency === "BRL") return currencyFormatter.format(value);
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

/**
 * R$ 1,2 mi — for dashboard tiles where the full number would not fit.
 *
 * Written by hand instead of `Intl` compact notation: the ICU data shipped
 * with Node and the one shipped with the browser disagree on the abbreviations
 * and on the trailing digit ("R$ 0" on the server, "R$ 0,0" on the client),
 * and every such disagreement is a hydration mismatch on a page that renders
 * the same number on both sides.
 */
export function formatCurrencyCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";

  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);

  const scale =
    abs >= 1_000_000_000
      ? { divisor: 1_000_000_000, suffix: " bi" }
      : abs >= 1_000_000
        ? { divisor: 1_000_000, suffix: " mi" }
        : abs >= 1_000
          ? { divisor: 1_000, suffix: " mil" }
          : { divisor: 1, suffix: "" };

  const scaled = abs / scale.divisor;
  // One decimal while the mantissa is small, none once it no longer adds
  // information: "R$ 1,2 mi" but "R$ 847 mil".
  const digits = scale.divisor === 1 ? 0 : scaled < 100 ? 1 : 0;

  return `${sign}R$ ${formatNumber(scaled, digits)}${scale.suffix}`;
}

export function formatNumber(value: number | null | undefined, fractionDigits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}

/** 12,5% — `value` is already a percentage, not a fraction. */
export function formatPercent(value: number | null | undefined, fractionDigits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${numberFormatter.format(Number(value.toFixed(fractionDigits)))}%`;
}

/** +12,5% — keeps the sign, for variations against a previous period. */
export function formatSignedPercent(value: number | null | undefined, fractionDigits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${numberFormatter.format(Number(value.toFixed(fractionDigits)))}%`;
}

/** Accepts "2024-03-15" or a Date and renders 15/03/2024. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const iso = typeof value === "string" ? value : toIsoDate(value);
  const [year, month, day] = iso.slice(0, 10).split("-");
  if (!year || !month || !day) return "—";
  return `${day}/${month}/${year}`;
}

/** 15/03/2024 14:32 */
/** 13/09 — dia e mês, para cartões e cabeçalhos onde o ano é redundante. */
export function formatDateShort(value: string | null | undefined): string {
  if (!value) return "—";
  const [, month, day] = value.split("-");
  if (!month || !day) return "—";
  return `${day}/${month}`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** "2024-03-01" -> "03/2024" */
export function formatCompetence(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month] = value.slice(0, 10).split("-");
  if (!year || !month) return "—";
  return `${month}/${year}`;
}

const MONTH_NAMES = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

/** "2024-03-01" -> "mar/24" — for chart axes, where space is scarce. */
export function formatCompetenceShort(value: string | null | undefined): string {
  if (!value) return "";
  const parts = value.slice(0, 10).split("-");
  const year = parts[0];
  const month = parts[1];
  if (!year || !month) return "";
  const name = MONTH_NAMES[Number(month) - 1] ?? month;
  return `${name}/${year.slice(2)}`;
}

/** 45 -> "45 dias"; 1 -> "1 dia"; negative values keep their sign in the caller. */
export function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const rounded = Math.round(value);
  return `${formatInteger(rounded)} ${Math.abs(rounded) === 1 ? "dia" : "dias"}`;
}

export function formatMonths(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  return `${formatNumber(rounded, 1)} ${rounded === 1 ? "mês" : "meses"}`;
}

export function formatHours(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${formatNumber(value, 1)} h`;
}

/**
 * Parses what the user typed in a pt-BR money field: "1.234,56", "R$ 1.234,56"
 * and "1234.56" all become 1234.56. Returns null when it is not a number.
 */
export function parseDecimalInput(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;

  const cleaned = input
    .replace(/[R$\s ]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Date -> "YYYY-MM-DD" in local time (not UTC, which would shift the day). */
export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayIso(): string {
  return toIsoDate(new Date());
}

/** "2024-03-17" -> "2024-03-01": the competence a date belongs to. */
export function toCompetence(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

/** Adds months to a competence, staying on the first day. */
export function addMonthsToCompetence(competence: string, months: number): string {
  const parts = competence.slice(0, 10).split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const total = year * 12 + (month - 1) + months;
  const newYear = Math.floor(total / 12);
  const newMonth = (total % 12) + 1;
  return `${String(newYear).padStart(4, "0")}-${String(newMonth).padStart(2, "0")}-01`;
}

export function addDaysToIso(isoDate: string, days: number): string {
  const parts = isoDate.slice(0, 10).split("-").map(Number);
  const date = new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** Whole days between two ISO dates (b - a). Negative when b is before a. */
export function daysBetween(a: string, b: string): number {
  const parse = (iso: string) => {
    const p = iso.slice(0, 10).split("-").map(Number);
    return Date.UTC(p[0] ?? 1970, (p[1] ?? 1) - 1, p[2] ?? 1);
  };
  return Math.round((parse(b) - parse(a)) / 86_400_000);
}

/** Whole months between two competences (b - a). */
/**
 * Dias **úteis** entre duas datas, com sinal — segunda a sexta, sem feriado.
 *
 * Conta o intervalo aberto na origem e fechado no destino: de sexta para a
 * segunda seguinte é 1, não 3. É assim que um plano de lançamento é lido —
 * "faltam 5 dias" significa cinco dias de trabalho, não cinco folhas do
 * calendário, e num fim de semana a diferença entre as duas leituras é a
 * diferença entre chegar e não chegar.
 *
 * Feriados não entram: a aplicação não tem calendário de feriados, e inventar
 * um calendário nacional para uma empresa que opera em vários estados erraria
 * em silêncio. Está documentado na nota de rodapé do slide.
 */
export function businessDaysBetween(from: string, to: string): number {
  if (from === to) return 0;
  const forward = from < to;
  const [start, end] = forward ? [from, to] : [to, from];

  let count = 0;
  let cursor = addDaysToIso(start, 1);
  while (cursor <= end) {
    const weekday = new Date(`${cursor}T00:00:00`).getDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
    cursor = addDaysToIso(cursor, 1);
  }
  return forward ? count : -count;
}

export function monthsBetween(a: string, b: string): number {
  const pa = a.slice(0, 10).split("-").map(Number);
  const pb = b.slice(0, 10).split("-").map(Number);
  return ((pb[0] ?? 0) - (pa[0] ?? 0)) * 12 + ((pb[1] ?? 0) - (pa[1] ?? 0));
}

/** Inclusive list of competences from `from` to `to`. */
export function competenceRange(from: string, to: string): string[] {
  const count = monthsBetween(from, to);
  if (count < 0) return [];
  return Array.from({ length: count + 1 }, (_, i) => addMonthsToCompetence(from, i));
}
