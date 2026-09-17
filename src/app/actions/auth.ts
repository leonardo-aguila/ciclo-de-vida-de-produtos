"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@db";
import { users } from "@db/schema";
import { fail, ok, parseForm, toActionError, type ActionResult } from "@/lib/actions";
import { requireUserOrThrow } from "@/lib/auth/guard";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { authenticate, AUTH_MESSAGES, destroyUserSessions } from "@/lib/auth/service";
import { endSession, requestMeta, startSession } from "@/lib/auth/session";
import { changePasswordSchema, loginSchema } from "@/lib/schemas/auth";
import { formatDateTime } from "@/lib/format";

export async function signInAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const parsed = parseForm(loginSchema, formData);
  if (!parsed.ok) return parsed.result;

  let destination = "/";
  try {
    const meta = await requestMeta();
    const result = await authenticate(db, parsed.data, meta);

    if (!result.ok) {
      if (result.reason === "locked" && result.lockedUntil) {
        return fail(
          `Conta bloqueada por excesso de tentativas. Tente novamente após ${formatDateTime(
            result.lockedUntil,
          )}.`,
        );
      }
      if (result.reason === "invalid_credentials" && result.remainingAttempts !== undefined) {
        const left = result.remainingAttempts;
        return fail(
          `${AUTH_MESSAGES.invalid_credentials} ${left === 1 ? "Resta 1 tentativa" : `Restam ${left} tentativas`} antes do bloqueio.`,
        );
      }
      return fail(AUTH_MESSAGES[result.reason]);
    }

    await startSession(result.user.id);
    const requested = parsed.data.redirectTo;
    // Only same-origin paths: an open redirect would turn the login form into a
    // way to send users anywhere.
    if (requested && requested.startsWith("/") && !requested.startsWith("//")) {
      destination = requested;
    }
    if (result.user.mustChangePassword) destination = "/conta?trocar=1";
  } catch (error) {
    return toActionError(error);
  }

  redirect(destination);
}

export async function signOutAction(): Promise<void> {
  await endSession();
  redirect("/entrar");
}

export async function changePasswordAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const user = await requireUserOrThrow();
    const parsed = parseForm(changePasswordSchema, formData);
    if (!parsed.ok) return parsed.result;

    if (!verifyPassword(parsed.data.currentPassword, user.passwordHash)) {
      return fail("Senha atual incorreta.", { currentPassword: ["Senha atual incorreta."] });
    }
    if (verifyPassword(parsed.data.newPassword, user.passwordHash)) {
      return fail("A nova senha precisa ser diferente da atual.", {
        newPassword: ["A nova senha precisa ser diferente da atual."],
      });
    }

    await db
      .update(users)
      .set({
        passwordHash: hashPassword(parsed.data.newPassword),
        mustChangePassword: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    // Other devices keep a session tied to the old password; drop them all and
    // issue a fresh one for the browser doing the change.
    await destroyUserSessions(db, user.id);
    await startSession(user.id);

    revalidatePath("/conta");
    return ok(null, "Senha alterada.");
  } catch (error) {
    return toActionError(error);
  }
}
