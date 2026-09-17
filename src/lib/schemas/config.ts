import { z } from "zod";
import { parseDecimalInput } from "@/lib/format";
import { LIFECYCLE_PHASES } from "./product";

const ENUM_KINDS = [
  "goal_type",
  "task_category",
  "kanban_column",
  "finance_entry_type",
  "comment_category",
  "product_category",
  "insight_origin",
] as const;

const number = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const parsed = parseDecimalInput(value);
  if (parsed === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Informe um número válido." });
    return z.NEVER;
  }
  return parsed;
});

/* -------------------------------------------------------------------------- */
/* Administered domains                                                       */
/* -------------------------------------------------------------------------- */

export const enumValueSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(ENUM_KINDS),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, "Informe um código.")
    .regex(/^[a-z0-9_]+$/, "Use apenas letras minúsculas, números e sublinhado."),
  label: z.string().trim().min(2, "Informe o rótulo que aparece na tela."),
  sortOrder: z.coerce.number().int().min(0).default(0),
  color: z
    .union([z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use uma cor no formato #rrggbb."), z.literal("")])
    .optional()
    .transform((value) => value || null),
  active: z.coerce.boolean().default(true),
});

export const deleteEnumValueSchema = z.object({ id: z.string().uuid() });

export const reorderEnumValuesSchema = z.object({
  kind: z.enum(ENUM_KINDS),
  /** Ids in their new order, as JSON. */
  order: z.string().transform((value, ctx) => {
    try {
      return z.array(z.string().uuid()).parse(JSON.parse(value));
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Ordem inválida." });
      return z.NEVER;
    }
  }),
});

/* -------------------------------------------------------------------------- */
/* General settings                                                           */
/* -------------------------------------------------------------------------- */

export const settingsSchema = z
  .object({
    weightGoal: number,
    weightFinancial: number,
    weightExecution: number,
    weightBusinessPlan: number,
    weightRisk: number,

    semaphoreGreen: number,
    semaphoreAmber: number,

    bpDeviationLimit: number,
    projectionWindowMonths: z.coerce.number().int().min(2).max(24),
    projectionHorizonMonths: z.coerce.number().int().min(1).max(60),

    scaleMinHealth: number,
    scaleMinRoi: number,
    scaleMinMomGrowth: number,
    keepMinProjectedRoi: number,
    pivotMinNegativeMarginMonths: z.coerce.number().int().min(1).max(24),
    discontinueMaxRoi: number,
    discontinueMaxProjectedRoi: number,
    discontinueMinDecliningMonths: z.coerce.number().int().min(1).max(24),

    defaultCurrency: z.string().trim().length(3, "Use o código de 3 letras, por exemplo BRL."),
  })
  .superRefine((data, ctx) => {
    const total =
      data.weightGoal +
      data.weightFinancial +
      data.weightExecution +
      data.weightBusinessPlan +
      data.weightRisk;
    // A score out of anything but 100 would make the semaphore thresholds lie.
    if (Math.abs(total - 100) > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["weightGoal"],
        message: `Os pesos precisam somar 100. Hoje somam ${total.toLocaleString("pt-BR")}.`,
      });
    }
    if (data.semaphoreAmber >= data.semaphoreGreen) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["semaphoreAmber"],
        message: "O limite do amarelo precisa ser menor que o do verde.",
      });
    }
    if (data.bpDeviationLimit > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bpDeviationLimit"],
        message: "O limite de desvio é negativo, por exemplo -15.",
      });
    }
  });

/* -------------------------------------------------------------------------- */
/* Task packages                                                              */
/* -------------------------------------------------------------------------- */

export const packageSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(3, "Informe o nome do pacote."),
  description: z
    .union([z.string(), z.undefined()])
    .transform((value) => value?.trim() || null),
  targetPhase: z
    .union([z.enum(LIFECYCLE_PHASES), z.literal(""), z.undefined()])
    .transform((value) => (value ? value : null)),
  active: z.coerce.boolean().default(true),
});

export const templateSchema = z.object({
  id: z.string().uuid().optional(),
  packageId: z.string().uuid(),
  name: z.string().trim().min(3, "Informe o nome da tarefa."),
  description: z
    .union([z.string(), z.undefined()])
    .transform((value) => value?.trim() || null),
  categoryId: z
    .union([z.string().uuid(), z.literal(""), z.undefined()])
    .transform((value) => value || null),
  defaultAssigneeId: z
    .union([z.string().uuid(), z.literal(""), z.undefined()])
    .transform((value) => value || null),
  priority: z.enum(["low", "medium", "high", "critical"]),
  initialStatus: z.string().trim().min(1),
  estimatedHours: z
    .union([z.string(), z.number(), z.undefined()])
    .transform((value) => (value === undefined || value === "" ? null : parseDecimalInput(value))),
  anchor: z.enum(["start_date", "planned_launch_date"]),
  startOffsetDays: z.coerce.number().int().min(-3650).max(3650),
  endOffsetDays: z.coerce.number().int().min(-3650).max(3650),
  /** Predecessors inside the same package, as JSON. */
  dependsOn: z
    .union([z.string(), z.undefined()])
    .transform((value, ctx) => {
      if (!value) return [] as string[];
      try {
        return z.array(z.string().uuid()).parse(JSON.parse(value));
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Dependências inválidas." });
        return z.NEVER;
      }
    }),
});

export const reorderTemplatesSchema = z.object({
  packageId: z.string().uuid(),
  order: z.string().transform((value, ctx) => {
    try {
      return z.array(z.string().uuid()).parse(JSON.parse(value));
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Ordem inválida." });
      return z.NEVER;
    }
  }),
});

export const duplicatePackageSchema = z.object({ id: z.string().uuid() });
export const deletePackageSchema = z.object({ id: z.string().uuid() });
export const deleteTemplateSchema = z.object({ id: z.string().uuid() });

export type SettingsInput = z.infer<typeof settingsSchema>;
export type TemplateFormInput = z.infer<typeof templateSchema>;
