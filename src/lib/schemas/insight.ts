import { z } from "zod";

const optionalUuid = z
  .union([z.string().uuid(), z.literal(""), z.undefined()])
  .transform((value) => value || null);

const optionalText = z
  .union([z.string(), z.undefined()])
  .transform((value) => value?.trim() || null);

const scale = z.coerce
  .number()
  .int("Use um número inteiro.")
  .min(1, "O mínimo é 1.")
  .max(10, "O máximo é 10.");

export const INSIGHT_STATUSES = [
  "new",
  "under_analysis",
  "approved",
  "in_progress",
  "done",
  "discarded",
] as const;

const baseInsight = z.object({
  title: z.string().trim().min(3, "Informe o título do insight."),
  description: optionalText,
  originId: optionalUuid,
  ownerId: optionalUuid,
  insightDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe uma data válida."),
  status: z.enum(INSIGHT_STATUSES),
  effort: scale,
  impact: scale,
});

export const createInsightSchema = baseInsight.extend({ productId: z.string().uuid() });
export const updateInsightSchema = baseInsight.extend({ id: z.string().uuid() });

/** Dragging a point on the matrix moves only effort and impact. */
export const moveInsightSchema = z.object({
  id: z.string().uuid(),
  effort: scale,
  impact: scale,
});

export const deleteInsightSchema = z.object({ id: z.string().uuid() });

export const convertInsightSchema = z.object({
  id: z.string().uuid(),
  /** One task, or one per line of the textarea. */
  taskNames: z.string().trim().min(2, "Informe ao menos um nome de tarefa."),
  categoryId: optionalUuid,
  assigneeId: optionalUuid,
  startDate: z.union([z.string(), z.undefined()]).transform((value) => value || null),
  dueDate: z.union([z.string(), z.undefined()]).transform((value) => value || null),
});

export const registerDecisionSchema = z.object({
  productId: z.string().uuid(),
  recommended: z.enum(["scale", "keep", "watch", "pivot", "discontinue"]),
  outcome: z.enum(["accepted", "rejected"]),
  justification: z.string().trim().min(10, "Escreva ao menos uma frase justificando a decisão."),
  /** Metrics behind the recommendation, as JSON, kept with the decision. */
  metricsSnapshot: z.union([z.string(), z.undefined()]).transform((value) => {
    if (!value) return null;
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }),
});
