/**
 * Server action plumbing: one shape for every mutation result, so forms handle
 * success and failure the same way everywhere.
 *
 * `fieldErrors` mirrors the zod schema shared with the client, which means a
 * message the browser already showed reads identically when the server repeats
 * the check — and the server always repeats the check.
 */
import { z } from "zod";
import { AuthenticationError, AuthorizationError } from "@/lib/auth/guard";

export type FieldErrors = Record<string, string[]>;

export type ActionResult<T = void> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: FieldErrors };

export function ok<T>(data: T, message?: string): ActionResult<T> {
  return { ok: true, data, message };
}

export function fail(error: string, fieldErrors?: FieldErrors): ActionResult<never> {
  return { ok: false, error, fieldErrors };
}

/** Turns an unexpected throw into a message the user can act on. */
export function toActionError(error: unknown): ActionResult<never> {
  if (error instanceof AuthorizationError || error instanceof AuthenticationError) {
    return fail(error.message);
  }
  if (error instanceof z.ZodError) {
    return fail("Verifique os campos destacados.", error.flatten().fieldErrors as FieldErrors);
  }
  if (error instanceof Error && "code" in error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") return fail("Já existe um registro com esse identificador.");
    if (code === "23503") return fail("Registro relacionado não encontrado.");
    if (code === "ECONNREFUSED") {
      return fail("Banco de dados indisponível. Verifique se o cluster está no ar.");
    }
  }
  console.error(error);
  return fail("Não foi possível concluir a operação. Tente novamente.");
}

/** Parses FormData with a zod schema, returning field errors instead of throwing. */
export function parseForm<S extends z.ZodType>(
  schema: S,
  formData: FormData,
): { ok: true; data: z.infer<S> } | { ok: false; result: ActionResult<never> } {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.endsWith("[]")) {
      const name = key.slice(0, -2);
      const list = (raw[name] as unknown[]) ?? [];
      list.push(value);
      raw[name] = list;
    } else {
      raw[key] = value === "" ? undefined : value;
    }
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      result: fail(
        "Verifique os campos destacados.",
        parsed.error.flatten().fieldErrors as FieldErrors,
      ),
    };
  }
  return { ok: true, data: parsed.data };
}
