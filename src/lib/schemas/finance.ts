import { z } from "zod";
import { parseDecimalInput } from "@/lib/format";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe uma data válida.");

const optionalIsoDate = z
  .union([isoDate, z.literal(""), z.undefined()])
  .transform((value) => (value ? value : null));

const optionalText = z
  .union([z.string(), z.undefined()])
  .transform((value) => value?.trim() || null);

const money = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const parsed = parseDecimalInput(value);
  if (parsed === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Informe um valor válido." });
    return z.NEVER;
  }
  return parsed;
});

const optionalMoney = z
  .union([z.string(), z.number(), z.undefined()])
  .transform((value) => (value === undefined || value === "" ? 0 : (parseDecimalInput(value) ?? 0)));

const wholeNumber = z
  .union([z.string(), z.number(), z.undefined()])
  .transform((value) => {
    if (value === undefined || value === "") return 0;
    const parsed = parseDecimalInput(value);
    return parsed === null ? 0 : Math.round(parsed);
  });

/* -------------------------------------------------------------------------- */
/* Finance entries                                                            */
/* -------------------------------------------------------------------------- */

const baseEntry = z.object({
  entryTypeId: z.string().uuid("Selecione o tipo de lançamento."),
  category: optionalText,
  description: z.string().trim().min(2, "Descreva o lançamento."),
  amount: money,
  currency: z.string().trim().length(3).default("BRL"),
  competenceDate: isoDate,
  isVariable: z.coerce.boolean().default(false),
  recurring: z.coerce.boolean().default(false),
  recurrencePeriod: z
    .union([z.enum(["monthly", "quarterly", "annual"]), z.literal(""), z.undefined()])
    .transform((value) => (value ? value : null)),
  recurrenceEnd: optionalIsoDate,
  costCenter: optionalText,
  supplier: optionalText,
  receiptUrl: optionalText,
});

function withRecurrenceRules<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((data: z.infer<typeof baseEntry>, ctx) => {
    if (!data.recurring) return;
    if (!data.recurrencePeriod) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recurrencePeriod"],
        message: "Informe a periodicidade da recorrência.",
      });
    }
    if (!data.recurrenceEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recurrenceEnd"],
        message: "Informe até quando o lançamento se repete.",
      });
    } else if (data.recurrenceEnd < data.competenceDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recurrenceEnd"],
        message: "A data-fim não pode ser anterior à competência.",
      });
    }
  });
}

export const createEntrySchema = withRecurrenceRules(
  baseEntry.extend({ productId: z.string().uuid() }),
);

export const updateEntrySchema = withRecurrenceRules(
  baseEntry.extend({
    id: z.string().uuid(),
    /** Changing a recurring parent can rewrite the instalments it generated. */
    applyToSeries: z.coerce.boolean().default(false),
  }),
);

export const deleteEntrySchema = z.object({
  id: z.string().uuid(),
  deleteSeries: z.coerce.boolean().default(false),
});

/* -------------------------------------------------------------------------- */
/* Monthly sales                                                              */
/* -------------------------------------------------------------------------- */

export const saleSchema = z.object({
  productId: z.string().uuid(),
  id: z.string().uuid().optional(),
  /** The form sends "YYYY-MM"; the database keeps the first day of the month. */
  competence: z
    .string()
    .regex(/^\d{4}-\d{2}(-\d{2})?$/, "Informe a competência.")
    .transform((value) => `${value.slice(0, 7)}-01`),
  newMrr: optionalMoney,
  recurringRevenue: optionalMoney,
  oneTimeRevenue: optionalMoney,
  churnAmount: optionalMoney,
  churnRate: optionalMoney,
  newCustomers: wholeNumber,
  activeCustomers: wholeNumber,
  churnedCustomers: wholeNumber,
  avgTicket: optionalMoney,
});

export const deleteSaleSchema = z.object({ id: z.string().uuid() });

export const importSalesSchema = z.object({
  productId: z.string().uuid(),
  /** Rows already parsed and validated in the browser, as JSON. */
  rows: z.string().transform((value, ctx) => {
    try {
      return z
        .array(
          z.object({
            competence: z.string(),
            newMrr: z.number(),
            recurringRevenue: z.number(),
            oneTimeRevenue: z.number(),
            churnAmount: z.number(),
            churnRate: z.number(),
            newCustomers: z.number(),
            activeCustomers: z.number(),
            churnedCustomers: z.number(),
            avgTicket: z.number(),
          }),
        )
        .max(600, "Importe no máximo 600 linhas por vez.")
        .parse(JSON.parse(value));
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Arquivo inválido." });
      return z.NEVER;
    }
  }),
});

export type EntryInput = z.infer<typeof createEntrySchema>;
export type SaleInput = z.infer<typeof saleSchema>;
