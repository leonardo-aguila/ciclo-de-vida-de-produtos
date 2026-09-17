"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@db";
import { users, type UserRole } from "@db/schema";
import { fail, ok, parseForm, toActionError, type ActionResult } from "@/lib/actions";
import { authorize, requireUserOrThrow } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { canManageUsers } from "@/lib/auth/policy";
import { destroyUserSessions } from "@/lib/auth/service";
import {
  createUserSchema,
  resetPasswordSchema,
  toggleUserSchema,
  updateUserSchema,
} from "@/lib/schemas/auth";
import { writeAudit } from "@/lib/audit";

async function requireUserAdmin() {
  const actor = await requireUserOrThrow();
  authorize(canManageUsers(actor), "Apenas administradores gerenciam usuários.");
  return actor;
}

/** Login and e-mail are unique case-insensitively; check before writing so the
 *  user gets a field error instead of a database constraint message. */
async function findConflict(login: string, email: string, ignoreId?: string) {
  const rows = await db
    .select({ id: users.id, login: users.login, email: users.email })
    .from(users)
    .where(sql`lower(${users.login}) = ${login} or lower(${users.email}) = ${email}`);

  const clash = rows.find((row) => row.id !== ignoreId);
  if (!clash) return null;
  return clash.login.toLowerCase() === login ? "login" : "email";
}

export async function createUserAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const actor = await requireUserAdmin();
    const parsed = parseForm(createUserSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const conflict = await findConflict(input.login, input.email);
    if (conflict === "login") return fail("Já existe um usuário com esse login.", { login: ["Já existe um usuário com esse login."] });
    if (conflict === "email") return fail("Já existe um usuário com esse e-mail.", { email: ["Já existe um usuário com esse e-mail."] });

    const [created] = await db
      .insert(users)
      .values({
        name: input.name,
        email: input.email,
        login: input.login,
        passwordHash: hashPassword(input.password),
        role: input.role as UserRole,
        active: input.active,
        mustChangePassword: true,
      })
      .returning({ id: users.id });

    await writeAudit({
      entityType: "user",
      entityId: created!.id,
      action: "create",
      actorId: actor.id,
      changes: [
        { field: "name", to: input.name },
        { field: "login", to: input.login },
        { field: "role", to: input.role },
      ],
    });

    revalidatePath("/usuarios");
    return ok(null, `Usuário ${input.name} criado.`);
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateUserAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const actor = await requireUserAdmin();
    const parsed = parseForm(updateUserSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const [current] = await db.select().from(users).where(eq(users.id, input.id)).limit(1);
    if (!current) return fail("Usuário não encontrado.");

    // An administrator must not lock themselves out of the only admin account.
    if (current.id === actor.id && (input.role !== "admin" || !input.active)) {
      return fail("Você não pode remover o próprio acesso de administrador.");
    }

    const conflict = await findConflict(input.login, input.email, input.id);
    if (conflict === "login") return fail("Já existe um usuário com esse login.", { login: ["Já existe um usuário com esse login."] });
    if (conflict === "email") return fail("Já existe um usuário com esse e-mail.", { email: ["Já existe um usuário com esse e-mail."] });

    await db
      .update(users)
      .set({
        name: input.name,
        email: input.email,
        login: input.login,
        role: input.role as UserRole,
        active: input.active,
        updatedAt: new Date(),
      })
      .where(eq(users.id, input.id));

    // Losing access must take effect now, not when the session expires.
    if (!input.active) await destroyUserSessions(db, input.id);

    await writeAudit({
      entityType: "user",
      entityId: input.id,
      action: "update",
      actorId: actor.id,
      changes: [
        { field: "name", from: current.name, to: input.name },
        { field: "email", from: current.email, to: input.email },
        { field: "login", from: current.login, to: input.login },
        { field: "role", from: current.role, to: input.role },
        { field: "active", from: String(current.active), to: String(input.active) },
      ],
    });

    revalidatePath("/usuarios");
    return ok(null, "Usuário atualizado.");
  } catch (error) {
    return toActionError(error);
  }
}

export async function resetPasswordAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const actor = await requireUserAdmin();
    const parsed = parseForm(resetPasswordSchema, formData);
    if (!parsed.ok) return parsed.result;

    const [target] = await db.select().from(users).where(eq(users.id, parsed.data.id)).limit(1);
    if (!target) return fail("Usuário não encontrado.");

    await db
      .update(users)
      .set({
        passwordHash: hashPassword(parsed.data.newPassword),
        mustChangePassword: parsed.data.mustChange,
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, parsed.data.id));

    await destroyUserSessions(db, parsed.data.id);

    await writeAudit({
      entityType: "user",
      entityId: parsed.data.id,
      action: "update",
      actorId: actor.id,
      changes: [{ field: "password", to: "redefinida pelo administrador" }],
    });

    revalidatePath("/usuarios");
    return ok(null, `Senha de ${target.name} redefinida. As sessões dele foram encerradas.`);
  } catch (error) {
    return toActionError(error);
  }
}

export async function toggleUserAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const actor = await requireUserAdmin();
    const parsed = parseForm(toggleUserSchema, formData);
    if (!parsed.ok) return parsed.result;

    if (parsed.data.id === actor.id && !parsed.data.active) {
      return fail("Você não pode desativar a própria conta.");
    }

    await db
      .update(users)
      .set({ active: parsed.data.active, updatedAt: new Date() })
      .where(eq(users.id, parsed.data.id));

    if (!parsed.data.active) await destroyUserSessions(db, parsed.data.id);

    await writeAudit({
      entityType: "user",
      entityId: parsed.data.id,
      action: "update",
      actorId: actor.id,
      changes: [{ field: "active", to: String(parsed.data.active) }],
    });

    revalidatePath("/usuarios");
    return ok(null, parsed.data.active ? "Usuário reativado." : "Usuário desativado.");
  } catch (error) {
    return toActionError(error);
  }
}
