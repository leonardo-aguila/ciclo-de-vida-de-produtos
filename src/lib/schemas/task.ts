import { z } from "zod";
import { parseDecimalInput } from "@/lib/format";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe uma data válida.");

const optionalIsoDate = z
  .union([isoDate, z.literal(""), z.undefined()])
  .transform((value) => (value ? value : null));

const optionalUuid = z
  .union([z.string().uuid(), z.literal(""), z.undefined()])
  .transform((value) => (value ? value : null));

const optionalText = z
  .union([z.string(), z.undefined()])
  .transform((value) => value?.trim() || null);

const baseTask = z.object({
  name: z.string().trim().min(2, "Informe o nome da tarefa."),
  description: optionalText,
  categoryId: optionalUuid,
  assigneeId: optionalUuid,
  status: z.string().trim().min(1, "Selecione a situação."),
  priority: z.enum(["low", "medium", "high", "critical"]),
  progress: z.coerce
    .number()
    .int("Informe um número inteiro.")
    .min(0, "O mínimo é 0.")
    .max(100, "O máximo é 100."),
  startDate: optionalIsoDate,
  dueDate: optionalIsoDate,
  doneDate: optionalIsoDate,
  estimatedHours: z
    .union([z.string(), z.number(), z.undefined()])
    .transform((value) => (value === undefined || value === "" ? null : parseDecimalInput(value))),
  parentTaskId: optionalUuid,
  isMilestone: z.coerce.boolean().default(false),
  /** Predecessors, as JSON — a repeating fieldset does not survive a form post. */
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

function withDateRules<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((data: z.infer<typeof baseTask>, ctx) => {
    if (data.startDate && data.dueDate && data.dueDate < data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dueDate"],
        message: "O prazo não pode ser anterior ao início.",
      });
    }
  });
}

export const createTaskSchema = withDateRules(
  baseTask.extend({ productId: z.string().uuid() }),
);

export const updateTaskSchema = withDateRules(baseTask.extend({ id: z.string().uuid() }));

/** Kanban drop: new column and new position inside it. */
export const moveTaskSchema = z.object({
  id: z.string().uuid(),
  status: z.string().trim().min(1),
  /** Ids of the destination column, in their new order. */
  order: z.string().transform((value, ctx) => {
    try {
      return z.array(z.string().uuid()).parse(JSON.parse(value));
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Ordem inválida." });
      return z.NEVER;
    }
  }),
});

/** Gantt drag and resize: dates only. */
export const rescheduleTaskSchema = z
  .object({
    id: z.string().uuid(),
    startDate: isoDate,
    dueDate: isoDate,
  })
  .refine((data) => data.dueDate >= data.startDate, {
    path: ["dueDate"],
    message: "O prazo não pode ser anterior ao início.",
  });

export const setProgressSchema = z.object({
  id: z.string().uuid(),
  progress: z.coerce.number().int().min(0).max(100),
});

export const deleteTaskSchema = z.object({ id: z.string().uuid() });

export const taskCommentSchema = z.object({
  taskId: z.string().uuid(),
  body: z.string().trim().min(1, "Escreva o comentário."),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
