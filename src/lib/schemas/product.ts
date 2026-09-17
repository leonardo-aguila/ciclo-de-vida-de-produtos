import { z } from "zod";
import { parseDecimalInput } from "@/lib/format";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Informe uma data válida.");

const optionalIsoDate = z
  .union([isoDate, z.literal(""), z.undefined()])
  .transform((value) => (value ? value : null));

const optionalUuid = z
  .union([z.string().uuid(), z.literal(""), z.undefined()])
  .transform((value) => (value ? value : null));

const optionalText = z
  .union([z.string(), z.undefined()])
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  });

/** Money and quantities are typed in pt-BR: "1.234,56" must parse to 1234.56. */
const decimal = z
  .union([z.string(), z.number()])
  .transform((value, ctx) => {
    const parsed = parseDecimalInput(value);
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Informe um número válido." });
      return z.NEVER;
    }
    return parsed;
  });

export const goalSchema = z.object({
  id: z.string().uuid().optional(),
  goalTypeId: z.string().uuid("Selecione o tipo de meta."),
  targetValue: decimal,
  unit: optionalText,
  period: z.enum(["monthly", "quarterly", "annual"]),
  deadline: optionalIsoDate,
  isPrimary: z.boolean().default(false),
});

export const LIFECYCLE_PHASES = [
  "conception",
  "development",
  "launch",
  "growth",
  "maturity",
  "decline",
  "discontinued",
] as const;

const baseProduct = z.object({
  name: z.string().trim().min(3, "Informe o nome do produto."),
  code: z
    .string()
    .trim()
    .min(2, "Informe o código interno.")
    .max(20, "O código deve ter no máximo 20 caracteres.")
    .regex(/^[A-Za-z0-9._-]+$/, "Use apenas letras, números, ponto, hífen e sublinhado."),
  shortDescription: optionalText,
  ownerId: optionalUuid,
  team: optionalText,
  categoryId: optionalUuid,
  phase: z.enum(LIFECYCLE_PHASES),
  status: z.enum(["active", "paused", "discontinued"]),
  startDate: isoDate,
  plannedLaunchDate: optionalIsoDate,
  actualLaunchDate: optionalIsoDate,
  segment: optionalText,
  pricingModel: optionalText,
  competitors: optionalText,
  /** Free-form tags, typed comma-separated. */
  tags: z
    .union([z.string(), z.undefined()])
    .transform((value) =>
      (value ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
        .slice(0, 20),
    ),
  /** Goals travel as JSON so a repeating fieldset survives a plain form post. */
  goals: z
    .union([z.string(), z.undefined()])
    .transform((value, ctx) => {
      if (!value) return [] as z.infer<typeof goalSchema>[];
      try {
        return z.array(goalSchema).parse(JSON.parse(value));
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Revise as metas informadas." });
        return z.NEVER;
      }
    }),
});

/** Dates must be consistent with each other, whichever screen sends them. */
function withDateRules<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((data: z.infer<typeof baseProduct>, ctx) => {
    if (data.plannedLaunchDate && data.plannedLaunchDate < data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["plannedLaunchDate"],
        message: "A data prevista de lançamento não pode ser anterior à data de início.",
      });
    }
    if (data.actualLaunchDate && data.actualLaunchDate < data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actualLaunchDate"],
        message: "A data real de lançamento não pode ser anterior à data de início.",
      });
    }
    const primaries = data.goals.filter((goal) => goal.isPrimary);
    if (primaries.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["goals"],
        message: "Marque apenas uma meta como principal.",
      });
    }
    if (data.goals.length > 0 && primaries.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["goals"],
        message: "Marque uma das metas como principal — é ela que alimenta o painel executivo.",
      });
    }
  });
}

export const createProductSchema = withDateRules(
  baseProduct.extend({
    /** Optional standard package to replicate on creation. */
    packageId: optionalUuid,
  }),
);

export const updateProductSchema = withDateRules(
  baseProduct.extend({ id: z.string().uuid() }),
);

export const applyPackageSchema = z.object({
  productId: z.string().uuid(),
  packageId: z.string().uuid("Selecione um pacote."),
  /** Set after the duplicate warning was shown and accepted. */
  confirmDuplicates: z.coerce.boolean().default(false),
});

export const deleteProductSchema = z.object({
  id: z.string().uuid(),
  /** Typing the code is the confirmation; deleting a product drops its history. */
  confirmCode: z.string().trim().min(1, "Digite o código do produto para confirmar."),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type GoalInput = z.infer<typeof goalSchema>;
