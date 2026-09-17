/**
 * Guards for pages and server actions.
 *
 * `requireUser` redirects (pages); `authorize` throws (mutations). A mutation
 * must never rely on the page having redirected — it is a separate request.
 */
import { redirect } from "next/navigation";
import type { User } from "@db/schema";
import { getCurrentUser } from "./session";
import { isAdmin, type Actor } from "./policy";

export class AuthorizationError extends Error {
  constructor(message = "Você não tem permissão para esta ação.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class AuthenticationError extends Error {
  constructor(message = "Sessão expirada. Entre novamente.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

/** For pages and layouts: sends anonymous visitors to the login screen. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/entrar");
  return user;
}

/** For server actions: throws instead of redirecting. */
export async function requireUserOrThrow(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationError();
  return user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (!isAdmin(user)) redirect("/sem-permissao");
  return user;
}

/**
 * Asserts a capability. Takes the predicate itself, so the rule stays in
 * policy.ts and this file never grows a second copy of it.
 */
export function authorize(allowed: boolean, message?: string): void {
  if (!allowed) throw new AuthorizationError(message);
}

export function assertCan<T extends unknown[]>(
  predicate: (user: Actor, ...args: T) => boolean,
  user: Actor,
  ...args: T
): void {
  authorize(predicate(user, ...args));
}
