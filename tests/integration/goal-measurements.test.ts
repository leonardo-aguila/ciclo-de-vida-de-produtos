/**
 * A apuração manual de meta, pelo caminho que um POST à mão tomaria.
 *
 * Duas recusas importam aqui, e nenhuma das duas pode depender de a tela
 * esconder o botão: quem não é responsável pelo produto não apura, e nem o
 * responsável apura um tipo que a aplicação já deriva das vendas mensais —
 * esse segundo caso não é permissão, é evitar dois realizados para a mesma
 * meta, com a tela tendo de escolher um sem conseguir justificar a escolha.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@db";
import { enumValues, goalMeasurements, productGoals, products, type UserRole } from "@db/schema";
import { createSession } from "@/lib/auth/service";
import { createUser, truncateAll } from "./helpers";

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
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const { saveGoalMeasurementAction } = await import("@/app/actions/goals");
const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? "portfolio_session";

async function signInAs(role: UserRole, login = `user_${role}`) {
  const user = await createUser({ login, role });
  const { token } = await createSession(db, user.id);
  jar.set(SESSION_COOKIE, token);
  return user;
}

async function goalTypeId(code: string, label: string, unit: string) {
  const [row] = await db
    .insert(enumValues)
    .values({ kind: "goal_type", code, label, sortOrder: 1, meta: { unit } })
    .returning({ id: enumValues.id });
  return row!.id;
}

async function productWithGoal(ownerId: string, typeCode: string) {
  const [product] = await db
    .insert(products)
    .values({
      code: `P-${typeCode}`,
      name: `Produto ${typeCode}`,
      ownerId,
      phase: "growth",
      startDate: "2026-01-01",
    })
    .returning({ id: products.id });

  const [goal] = await db
    .insert(productGoals)
    .values({
      productId: product!.id,
      goalTypeId: await goalTypeId(typeCode, typeCode.toUpperCase(), "pontos"),
      targetValue: 50,
      period: "monthly",
      isPrimary: true,
    })
    .returning({ id: productGoals.id });

  return { productId: product!.id, goalId: goal!.id };
}

function measurementForm(goalId: string, value = "42") {
  const form = new FormData();
  form.set("goalId", goalId);
  form.set("competence", "2026-10");
  form.set("value", value);
  return form;
}

beforeEach(async () => {
  jar.clear();
  await truncateAll();
});

describe("apuração manual de meta — autorização no servidor", () => {
  it("o responsável apura um tipo que a aplicação não deriva", async () => {
    const owner = await signInAs("product_manager");
    const { goalId } = await productWithGoal(owner.id, "nps");

    const result = await saveGoalMeasurementAction(null, measurementForm(goalId));

    expect(result.ok).toBe(true);
    const rows = await db
      .select()
      .from(goalMeasurements)
      .where(eq(goalMeasurements.goalId, goalId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe(42);
    expect(rows[0]!.competence).toBe("2026-10-01");
  });

  it("substitui a competência já apurada em vez de duplicar", async () => {
    const owner = await signInAs("product_manager");
    const { goalId } = await productWithGoal(owner.id, "nps");

    await saveGoalMeasurementAction(null, measurementForm(goalId, "30"));
    const result = await saveGoalMeasurementAction(null, measurementForm(goalId, "45"));

    expect(result.ok).toBe(true);
    const rows = await db
      .select()
      .from(goalMeasurements)
      .where(eq(goalMeasurements.goalId, goalId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe(45);
  });

  it("recusa apurar à mão um tipo que sai das vendas mensais", async () => {
    // Não é permissão: é a regra de uma fonte só por meta.
    const owner = await signInAs("product_manager");
    const { goalId } = await productWithGoal(owner.id, "new_mrr");

    const result = await saveGoalMeasurementAction(null, measurementForm(goalId));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/automaticamente|financeiro/i);
    expect(await db.select().from(goalMeasurements)).toHaveLength(0);
  });

  it("recusa quem não é responsável pelo produto", async () => {
    const owner = await createUser({ login: "dono", role: "product_manager" });
    const { goalId } = await productWithGoal(owner.id, "nps");
    await signInAs("collaborator", "outro");

    const result = await saveGoalMeasurementAction(null, measurementForm(goalId));

    expect(result.ok).toBe(false);
    expect(await db.select().from(goalMeasurements)).toHaveLength(0);
  });

  it("recusa sem sessão", async () => {
    const owner = await createUser({ login: "dono", role: "product_manager" });
    const { goalId } = await productWithGoal(owner.id, "nps");

    const result = await saveGoalMeasurementAction(null, measurementForm(goalId));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/sessão/i);
    expect(await db.select().from(goalMeasurements)).toHaveLength(0);
  });
});
