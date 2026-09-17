/** The cookie layer around the auth service. Server-side only. */
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { db } from "@db";
import type { User } from "@db/schema";
import { SESSION_TTL_DAYS } from "@/lib/defaults";
import { createSession, destroySession, validateSessionToken, type LoginMeta } from "./service";

export const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? "portfolio_session";

/**
 * The signed-in user, or null. Memoized per request: a page that checks
 * permissions in several components still hits the database once.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSessionToken(db, token);
});

export async function requestMeta(): Promise<LoginMeta> {
  const list = await headers();
  return {
    ip:
      list.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      list.get("x-real-ip") ??
      null,
    userAgent: list.get("user-agent"),
  };
}

export async function startSession(userId: string): Promise<void> {
  const meta = await requestMeta();
  const { token, expiresAt } = await createSession(db, userId, meta);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
    maxAge: SESSION_TTL_DAYS * 86_400,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(db, token);
  store.delete(SESSION_COOKIE);
}
