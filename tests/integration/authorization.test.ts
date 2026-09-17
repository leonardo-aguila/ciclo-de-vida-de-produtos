/**
 * Proves the server refuses what the UI merely hides.
 *
 * The server actions are called directly, with a session cookie planted for the
 * role under test — the same path a hand-crafted POST would take.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@db";
import { users, type UserRole } from "@db/schema";
import { createSession } from "@/lib/auth/service";
import { createUser, truncateAll } from "./helpers";

/** Cookie jar the mocked `next/headers` reads from. */
const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  // `cache` memoizes per request; outside Next there is no request boundary, so
  // it would keep returning the first role we signed in as.
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const { createUserAction, toggleUserAction } = await import("@/app/actions/users");
const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? "portfolio_session";

async function signInAs(role: UserRole) {
  const user = await createUser({ login: `user_${role}`, role });
  const { token } = await createSession(db, user.id);
  jar.set(SESSION_COOKIE, token);
  return user;
}

function userForm(login: string) {
  const form = new FormData();
  form.set("name", "Pessoa Nova");
  form.set("email", `${login}@teste.local`);
  form.set("login", login);
  form.set("password", "Senha@Nova123");
  form.set("role", "collaborator");
  form.set("active", "true");
  return form;
}

beforeEach(async () => {
  jar.clear();
  await truncateAll();
});

describe("gestão de usuários — autorização no servidor", () => {
  it("permite que o administrador crie usuários", async () => {
    await signInAs("admin");

    const result = await createUserAction(null, userForm("novo"));

    expect(result.ok).toBe(true);
    const rows = await db.select().from(users);
    expect(rows.map((u) => u.login)).toContain("novo");
  });

  it.each<UserRole>(["product_manager", "collaborator", "executive"])(
    "recusa a criação de usuário para o perfil %s",
    async (role) => {
      await signInAs(role);

      const result = await createUserAction(null, userForm("intruso"));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/administradores|permissão/i);

      const rows = await db.select().from(users);
      expect(rows.map((u) => u.login)).not.toContain("intruso");
    },
  );

  it("recusa a mutação sem sessão", async () => {
    const result = await createUserAction(null, userForm("anonimo"));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/sessão/i);
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it("recusa a mutação com um cookie forjado", async () => {
    jar.set(SESSION_COOKIE, "token-que-nunca-existiu");

    const result = await createUserAction(null, userForm("forjado"));

    expect(result.ok).toBe(false);
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it("recusa a mutação de uma sessão cujo usuário foi desativado", async () => {
    const admin = await signInAs("admin");
    await db.update(users).set({ active: false }).where(eq(users.id, admin.id));

    const result = await createUserAction(null, userForm("depois"));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/sessão/i);
  });

  it("impede que o administrador desative a própria conta", async () => {
    const admin = await signInAs("admin");

    const form = new FormData();
    form.set("id", admin.id);
    form.set("active", "");

    const result = await toggleUserAction(null, form);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/própria conta/i);
  });

  it("valida os campos antes de gravar, mesmo com sessão de administrador", async () => {
    await signInAs("admin");

    const form = userForm("x");
    form.set("password", "curta");

    const result = await createUserAction(null, form);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.password?.length).toBeGreaterThan(0);
    expect(result.fieldErrors?.login?.length).toBeGreaterThan(0);
  });
});
