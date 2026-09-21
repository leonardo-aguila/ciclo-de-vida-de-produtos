import { z } from "zod";

const optionalUuid = z
  .union([z.string().uuid(), z.literal(""), z.undefined()])
  .transform((value) => value || null);

export const commentSchema = z.object({
  productId: z.string().uuid(),
  id: z.string().uuid().optional(),
  categoryId: optionalUuid,
  body: z
    .string()
    .trim()
    .min(10, "Escreva ao menos uma frase — o motor de sugestões lê este texto.")
    .max(4000, "O comentário está longo demais."),
  commentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe uma data válida."),
});

export const deleteCommentSchema = z.object({ id: z.string().uuid() });
