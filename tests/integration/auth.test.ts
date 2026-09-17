import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@db";
import { accessLogs, sessions, users } from "@db/schema";
import { LOCKOUT_MINUTES, MAX_FAILED_ATTEMPTS } from "@/lib/defaults";
import {
  authenticate,
  createSession,
  deleteExpiredSessions,
  destroySession,
  destroyUserSessions,
  validateSessionToken,
} from "@/lib/auth/service";
import { createUser, TEST_PASSWORD, truncateAll } from "./helpers";

beforeEach(async () => {
  await truncateAll();
});

describe("autenticação", () => {
  it("aceita a senha correta e zera o contador de tentativas", async () => {
    const user = await createUser({ login: "ana", role: "product_manager" });
    await db.update(users).set({ failedAttempts: 3 }).where(eq(users.id, user.id));

    const result = await authenticate(db, { login: "ana", password: TEST_PASSWORD });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.id).toBe(user.id);
    expect(result.user.failedAttempts).toBe(0);
    expect(result.user.lastLoginAt).not.toBeNull();
  });

  it("aceita o login sem diferenciar maiúsculas", async () => {
    await createUser({ login: "ana" });
    const result = await authenticate(db, { login: "  ANA  ", password: TEST_PASSWORD });
    expect(result.ok).toBe(true);
  });

  it("recusa a senha errada e conta a tentativa", async () => {
    const user = await createUser({ login: "ana" });

    const result = await authenticate(db, { login: "ana", password: "errada123" });

    expect(result).toMatchObject({ ok: false, reason: "invalid_credentials" });
    if (result.ok) return;
    expect(result.remainingAttempts).toBe(MAX_FAILED_ATTEMPTS - 1);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.failedAttempts).toBe(1);
  });

  it("não revela se o login existe", async () => {
    const unknown = await authenticate(db, { login: "ninguem", password: "x" });
    await createUser({ login: "ana" });
    const wrongPassword = await authenticate(db, { login: "ana", password: "x" });

    expect(unknown.ok).toBe(false);
    expect(wrongPassword.ok).toBe(false);
    if (unknown.ok || wrongPassword.ok) return;
    expect(unknown.reason).toBe(wrongPassword.reason);
  });

  it("bloqueia a conta depois de N tentativas e recusa a senha certa durante o bloqueio", async () => {
    const user = await createUser({ login: "ana" });

    for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      const partial = await authenticate(db, { login: "ana", password: "errada" });
      expect(partial).toMatchObject({ ok: false, reason: "invalid_credentials" });
    }

    const locking = await authenticate(db, { login: "ana", password: "errada" });
    expect(locking).toMatchObject({ ok: false, reason: "locked" });

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row!.lockedUntil).toBeTruthy();
    const minutes = (row!.lockedUntil!.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(LOCKOUT_MINUTES - 1);
    expect(minutes).toBeLessThanOrEqual(LOCKOUT_MINUTES);

    // The right password does not open a locked account.
    const duringLock = await authenticate(db, { login: "ana", password: TEST_PASSWORD });
    expect(duringLock).toMatchObject({ ok: false, reason: "locked" });
  });

  it("volta a aceitar depois que o bloqueio expira", async () => {
    const user = await createUser({ login: "ana" });
    await db
      .update(users)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(users.id, user.id));

    const result = await authenticate(db, { login: "ana", password: TEST_PASSWORD });
    expect(result.ok).toBe(true);
  });

  it("recusa usuário inativo mesmo com a senha certa", async () => {
    await createUser({ login: "ana", active: false });
    const result = await authenticate(db, { login: "ana", password: TEST_PASSWORD });
    expect(result).toMatchObject({ ok: false, reason: "inactive" });
  });

  it("registra toda tentativa no log de acesso", async () => {
    await createUser({ login: "ana" });
    await authenticate(db, { login: "ana", password: "errada" }, { ip: "10.0.0.1" });
    await authenticate(db, { login: "ana", password: TEST_PASSWORD }, { ip: "10.0.0.1" });
    await authenticate(db, { login: "fantasma", password: "x" });

    const logs = await db.select().from(accessLogs);
    expect(logs).toHaveLength(3);
    expect(logs.filter((l) => l.success)).toHaveLength(1);
    expect(logs.find((l) => l.loginAttempted === "fantasma")?.reason).toBe("unknown_login");
    expect(logs.find((l) => l.success)?.ip).toBe("10.0.0.1");
  });
});

describe("sessão", () => {
  it("guarda apenas o hash do token", async () => {
    const user = await createUser({ login: "ana" });
    const { token } = await createSession(db, user.id);

    const [row] = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(row!.tokenHash).not.toBe(token);
    expect(row!.tokenHash).toHaveLength(64);
  });

  it("resolve o usuário a partir do token", async () => {
    const user = await createUser({ login: "ana", role: "executive" });
    const { token } = await createSession(db, user.id);

    const resolved = await validateSessionToken(db, token);
    expect(resolved?.id).toBe(user.id);
    expect(resolved?.role).toBe("executive");
  });

  it("recusa token desconhecido, vazio ou expirado", async () => {
    const user = await createUser({ login: "ana" });
    const { token } = await createSession(db, user.id);

    expect(await validateSessionToken(db, "")).toBeNull();
    expect(await validateSessionToken(db, "token-inventado")).toBeNull();

    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, user.id));
    expect(await validateSessionToken(db, token)).toBeNull();
  });

  it("recusa a sessão de um usuário desativado depois do login", async () => {
    const user = await createUser({ login: "ana" });
    const { token } = await createSession(db, user.id);
    expect(await validateSessionToken(db, token)).not.toBeNull();

    await db.update(users).set({ active: false }).where(eq(users.id, user.id));
    expect(await validateSessionToken(db, token)).toBeNull();
  });

  it("encerra uma sessão e todas as sessões de um usuário", async () => {
    const user = await createUser({ login: "ana" });
    const first = await createSession(db, user.id);
    const second = await createSession(db, user.id);

    await destroySession(db, first.token);
    expect(await validateSessionToken(db, first.token)).toBeNull();
    expect(await validateSessionToken(db, second.token)).not.toBeNull();

    await destroyUserSessions(db, user.id);
    expect(await validateSessionToken(db, second.token)).toBeNull();
  });

  it("limpa sessões expiradas sem tocar nas válidas", async () => {
    const user = await createUser({ login: "ana" });

    // Create one session, age it, then create a second one that stays valid.
    const stale = await createSession(db, user.id);
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, user.id));
    const valid = await createSession(db, user.id);

    await deleteExpiredSessions(db);

    expect(await validateSessionToken(db, stale.token)).toBeNull();
    expect(await validateSessionToken(db, valid.token)).not.toBeNull();
    expect(await db.select().from(sessions)).toHaveLength(1);
  });
});
