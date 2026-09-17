/**
 * Authentication against the database, with no knowledge of cookies or of
 * Next.js — which is what lets the integration tests drive it directly.
 */
import { randomBytes, createHash } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { Db } from "@db";
import { accessLogs, sessions, users, type User } from "@db/schema";
import { LOCKOUT_MINUTES, MAX_FAILED_ATTEMPTS, SESSION_TTL_DAYS } from "@/lib/defaults";
import { verifyPassword } from "./password";

export type LoginMeta = { ip?: string | null; userAgent?: string | null };

export type AuthFailure =
  | "invalid_credentials"
  | "inactive"
  | "locked";

export type AuthResult =
  | { ok: true; user: User }
  | { ok: false; reason: AuthFailure; lockedUntil?: Date; remainingAttempts?: number };

/** Messages the login screen shows. Never says whether the login exists. */
export const AUTH_MESSAGES: Record<AuthFailure, string> = {
  invalid_credentials: "Login ou senha incorretos.",
  inactive: "Este usuário está inativo. Procure o administrador.",
  locked: "Conta bloqueada por excesso de tentativas. Tente novamente mais tarde.",
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function log(
  db: Db,
  entry: {
    userId?: string | null;
    loginAttempted: string;
    success: boolean;
    reason?: string;
    meta: LoginMeta;
  },
) {
  await db.insert(accessLogs).values({
    userId: entry.userId ?? null,
    loginAttempted: entry.loginAttempted,
    success: entry.success,
    reason: entry.reason ?? null,
    ip: entry.meta.ip ?? null,
    userAgent: entry.meta.userAgent ?? null,
  });
}

/**
 * Checks credentials and keeps the lockout counter. Every attempt is written to
 * `access_logs`, successful or not.
 */
export async function authenticate(
  db: Db,
  input: { login: string; password: string },
  meta: LoginMeta = {},
): Promise<AuthResult> {
  const login = input.login.trim().toLowerCase();

  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.login}) = ${login}`)
    .limit(1);

  if (!user) {
    // Same shape of work as a real user so the response time does not leak
    // whether the login exists.
    verifyPassword(input.password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
    await log(db, { loginAttempted: login, success: false, reason: "unknown_login", meta });
    return { ok: false, reason: "invalid_credentials" };
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await log(db, {
      userId: user.id,
      loginAttempted: login,
      success: false,
      reason: "locked",
      meta,
    });
    return { ok: false, reason: "locked", lockedUntil: user.lockedUntil };
  }

  if (!verifyPassword(input.password, user.passwordHash)) {
    const failed = user.failedAttempts + 1;
    const shouldLock = failed >= MAX_FAILED_ATTEMPTS;
    const lockedUntil = shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null;

    await db
      .update(users)
      .set({
        failedAttempts: shouldLock ? 0 : failed,
        lockedUntil,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    await log(db, {
      userId: user.id,
      loginAttempted: login,
      success: false,
      reason: shouldLock ? "locked_now" : "wrong_password",
      meta,
    });

    if (shouldLock) return { ok: false, reason: "locked", lockedUntil: lockedUntil! };
    return {
      ok: false,
      reason: "invalid_credentials",
      remainingAttempts: MAX_FAILED_ATTEMPTS - failed,
    };
  }

  // The password is right; an inactive account still must not get a session.
  if (!user.active) {
    await log(db, {
      userId: user.id,
      loginAttempted: login,
      success: false,
      reason: "inactive",
      meta,
    });
    return { ok: false, reason: "inactive" };
  }

  const [updated] = await db
    .update(users)
    .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(users.id, user.id))
    .returning();

  await log(db, { userId: user.id, loginAttempted: login, success: true, meta });
  return { ok: true, user: updated ?? user };
}

/** Creates a session and returns the raw token — only its hash is stored. */
export async function createSession(
  db: Db,
  userId: string,
  meta: LoginMeta = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { token, expiresAt };
}

/** Returns the user behind a token, or null when it is unknown, expired or inactive. */
export async function validateSessionToken(db: Db, token: string): Promise<User | null> {
  if (!token) return null;

  const [row] = await db
    .select({ user: users, sessionId: sessions.id })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!row || !row.user.active) return null;

  // Cheap liveness marker; not awaited on the hot path of every request.
  void db
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.id, row.sessionId))
    .catch(() => undefined);

  return row.user;
}

export async function destroySession(db: Db, token: string): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Drops every session of a user — used when a password is changed or reset. */
export async function destroyUserSessions(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function deleteExpiredSessions(db: Db): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
