/**
 * Validation shared by the browser and the server. The form imports these to
 * show errors while typing; the server action imports the same object and
 * validates again, because the browser's check is a courtesy, not a guarantee.
 */
import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "@/lib/defaults";
import { ROLES } from "@/lib/auth/policy";

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `A senha precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`)
  .regex(/[a-zA-Z]/, "A senha precisa de pelo menos uma letra.")
  .regex(/[0-9]/, "A senha precisa de pelo menos um número.")
  .refine((value) => !/^\s|\s$/.test(value), "A senha não pode começar nem terminar com espaço.");

export const loginSchema = z.object({
  login: z.string().trim().min(1, "Informe o login."),
  password: z.string().min(1, "Informe a senha."),
  redirectTo: z.string().optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Informe a senha atual."),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Repita a nova senha."),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "As senhas não conferem.",
    path: ["confirmPassword"],
  });

const roleSchema = z.enum(ROLES as [string, ...string[]], {
  errorMap: () => ({ message: "Selecione um tipo de usuário válido." }),
});

export const createUserSchema = z.object({
  name: z.string().trim().min(3, "Informe o nome completo."),
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  login: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "O login precisa de pelo menos 3 caracteres.")
    .regex(/^[a-z0-9._-]+$/, "Use apenas letras, números, ponto, hífen e sublinhado."),
  password: passwordSchema,
  role: roleSchema,
  active: z.coerce.boolean().default(true),
});

export const updateUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(3, "Informe o nome completo."),
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  login: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "O login precisa de pelo menos 3 caracteres.")
    .regex(/^[a-z0-9._-]+$/, "Use apenas letras, números, ponto, hífen e sublinhado."),
  role: roleSchema,
  active: z.coerce.boolean().default(true),
});

export const resetPasswordSchema = z.object({
  id: z.string().uuid(),
  newPassword: passwordSchema,
  /**
   * Forces the user to pick their own password on the next sign-in.
   * Defaults to false for the same reason as every other checkbox: an
   * unchecked box sends nothing, and the schema must not overrule that.
   */
  mustChange: z.coerce.boolean().default(false),
});

export const toggleUserSchema = z.object({
  id: z.string().uuid(),
  active: z.coerce.boolean(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
