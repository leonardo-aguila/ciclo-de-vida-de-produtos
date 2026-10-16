import { z } from "zod";

/**
 * Apuração manual de uma meta.
 *
 * O valor aceita negativo de propósito: NPS vai de −100 a 100, e redução de
 * custo apurada à mão pode piorar. Travar em zero aqui obrigaria quem apura a
 * mentir ou a deixar em branco.
 */
const measurementValue = z
  .string()
  .trim()
  .min(1, "Informe o valor apurado.")
  .transform((value) => Number(value.replace(/\./g, "").replace(",", ".")))
  .refine((value) => Number.isFinite(value), "Valor inválido.");

export const goalMeasurementSchema = z.object({
  goalId: z.string().uuid(),
  /** O formulário manda "YYYY-MM"; o banco guarda o primeiro dia do mês. */
  competence: z
    .string()
    .regex(/^\d{4}-\d{2}(-\d{2})?$/, "Informe a competência.")
    .transform((value) => `${value.slice(0, 7)}-01`),
  value: measurementValue,
  note: z
    .string()
    .trim()
    .max(280, "A observação tem no máximo 280 caracteres.")
    .optional()
    .transform((value) => value || null),
});

export const deleteGoalMeasurementSchema = z.object({ id: z.string().uuid() });

export type GoalMeasurementInput = z.infer<typeof goalMeasurementSchema>;
