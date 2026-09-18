import { z } from "zod";
import { parseDecimalInput } from "@/lib/format";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe uma data válida.");

const optionalIsoDate = z
  .union([isoDate, z.literal(""), z.undefined()])
  .transform((value) => (value ? value : null));

const optionalUuid = z
  .union([z.string().uuid(), z.literal(""), z.undefined()])
  .transform((value) => value || null);

const optionalText = z
  .union([z.string(), z.undefined()])
  .transform((value) => value?.trim() || null);

const money = z
  .union([z.string(), z.number(), z.undefined()])
  .transform((value) => (value === undefined || value === "" ? 0 : (parseDecimalInput(value) ?? 0)));

export const planSchema = z.object({
  productId: z.string().uuid(),
  id: z.string().uuid().optional(),
  approvedAt: optionalIsoDate,
  assumptions: optionalText,
  horizonMonths: z.coerce
    .number()
    .int()
    .min(1, "O horizonte mínimo é 1 mês.")
    .max(120, "O horizonte máximo é 120 meses."),
  /** Only one plan per product is the active one. */
  status: z.enum(["draft", "active", "superseded"]).default("active"),
});

/** Creating a new version keeps the previous one intact. */
export const newVersionSchema = z.object({
  productId: z.string().uuid(),
  fromPlanId: z.string().uuid(),
  /**
   * Copy the months and milestones of the previous version.
   * Defaults to false: an unchecked checkbox sends nothing, so a default of
   * true would quietly ignore the user unticking the box. The form offers it
   * checked; the schema honours whatever actually arrives.
   */
  copyContent: z.coerce.boolean().default(false),
});

export const planMonthsSchema = z.object({
  planId: z.string().uuid(),
  /** The whole editable table, as JSON. */
  rows: z.string().transform((value, ctx) => {
    try {
      return z
        .array(
          z.object({
            competence: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
            plannedRevenue: z.number(),
            plannedCost: z.number(),
            plannedCustomers: z.number(),
            plannedMargin: z.number(),
          }),
        )
        .max(120, "O plano aceita no máximo 120 meses.")
        .parse(JSON.parse(value));
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Projeções inválidas." });
      return z.NEVER;
    }
  }),
});

export const milestoneSchema = z.object({
  planId: z.string().uuid(),
  id: z.string().uuid().optional(),
  name: z.string().trim().min(3, "Informe o nome do marco."),
  targetDate: isoDate,
  acceptanceCriteria: optionalText,
  status: z.enum(["pending", "in_progress", "done"]),
  doneDate: optionalIsoDate,
});

export const deleteMilestoneSchema = z.object({ id: z.string().uuid() });

export const actionPlanSchema = z.object({
  productId: z.string().uuid(),
  id: z.string().uuid().optional(),
  planId: optionalUuid,
  name: z.string().trim().min(3, "Informe o nome do plano de ação."),
  description: optionalText,
  rootCause: optionalText,
  ownerId: optionalUuid,
  dueDate: isoDate,
  status: z.enum(["pending", "in_progress", "done", "cancelled"]),
  expectedResult: optionalText,
  actualResult: optionalText,
  /** The deviation that triggered it, kept for traceability. */
  triggerCompetence: optionalIsoDate,
  triggerDeviation: z
    .union([z.string(), z.number(), z.undefined()])
    .transform((value) => (value === undefined || value === "" ? null : parseDecimalInput(value))),
});

export const deleteActionPlanSchema = z.object({ id: z.string().uuid() });

export const importPlanSchema = z.object({
  planId: z.string().uuid(),
  rows: z.string().transform((value, ctx) => {
    try {
      return z
        .array(
          z.object({
            competence: z.string(),
            plannedRevenue: z.number(),
            plannedCost: z.number(),
            plannedCustomers: z.number(),
            plannedMargin: z.number(),
          }),
        )
        .max(120)
        .parse(JSON.parse(value));
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Arquivo inválido." });
      return z.NEVER;
    }
  }),
});

export type PlanMonthInput = { competence: string } & Record<string, number | string>;
export { money as planMoney };
