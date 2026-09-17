/**
 * Product authorization and package replication, through the real server
 * actions — the same path a hand-crafted POST would take.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@db";
import {
  enumValues,
  productGoals,
  productPhaseHistory,
  products,
  taskDependencies,
  taskPackages,
  taskTemplateDependencies,
  taskTemplates,
  tasks,
  type UserRole,
} from "@db/schema";
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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});

const { applyPackageAction, createProductAction, updateProductAction } = await import(
  "@/app/actions/products"
);
const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? "portfolio_session";

async function signInAs(role: UserRole, login = `user_${role}`) {
  const user = await createUser({ login, role });
  const { token } = await createSession(db, user.id);
  jar.set(SESSION_COOKIE, token);
  return user;
}

function productForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  form.set("name", "Nimbus Backup");
  form.set("code", "SKY-BKP");
  form.set("phase", "development");
  form.set("status", "active");
  form.set("startDate", "2026-01-15");
  form.set("plannedLaunchDate", "2026-07-01");
  for (const [key, value] of Object.entries(overrides)) form.set(key, value);
  return form;
}

async function seedGoalType() {
  const [goalType] = await db
    .insert(enumValues)
    .values({ kind: "goal_type", code: "new_mrr", label: "Novo MRR", sortOrder: 1 })
    .returning();
  return goalType!;
}

beforeEach(async () => {
  jar.clear();
  await truncateAll();
});

describe("criação de produto", () => {
  it("permite que o gestor de produto crie", async () => {
    await signInAs("product_manager");

    const result = await createProductAction(null, productForm());

    expect(result.ok).toBe(true);
    const rows = await db.select().from(products);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code).toBe("SKY-BKP");
  });

  it("abre o histórico de fase na data de início do produto, não na data de cadastro", async () => {
    await signInAs("admin");
    await createProductAction(null, productForm());

    const [history] = await db.select().from(productPhaseHistory);
    expect(history!.startedAt).toBe("2026-01-15");
    expect(history!.phase).toBe("development");
    expect(history!.endedAt).toBeNull();
  });

  it.each<UserRole>(["collaborator", "executive"])("recusa a criação para o perfil %s", async (role) => {
    await signInAs(role);

    const result = await createProductAction(null, productForm());

    expect(result.ok).toBe(false);
    expect(await db.select().from(products)).toHaveLength(0);
  });

  it("recusa código repetido, ignorando a caixa", async () => {
    await signInAs("admin");
    await createProductAction(null, productForm());

    const result = await createProductAction(null, productForm({ code: "sky-bkp", name: "Outro" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.code?.[0]).toMatch(/já existe/i);
    expect(await db.select().from(products)).toHaveLength(1);
  });

  it("recusa lançamento previsto anterior à data de início", async () => {
    await signInAs("admin");

    const result = await createProductAction(
      null,
      productForm({ startDate: "2026-06-01", plannedLaunchDate: "2026-01-01" }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors?.plannedLaunchDate?.[0]).toMatch(/anterior/i);
  });

  it("grava as metas e exige exatamente uma principal", async () => {
    await signInAs("admin");
    const goalType = await seedGoalType();

    const semPrincipal = await createProductAction(
      null,
      productForm({
        goals: JSON.stringify([
          { goalTypeId: goalType.id, targetValue: "50.000,00", period: "monthly", isPrimary: false },
        ]),
      }),
    );
    expect(semPrincipal.ok).toBe(false);

    const duasPrincipais = await createProductAction(
      null,
      productForm({
        goals: JSON.stringify([
          { goalTypeId: goalType.id, targetValue: "1", period: "monthly", isPrimary: true },
          { goalTypeId: goalType.id, targetValue: "2", period: "annual", isPrimary: true },
        ]),
      }),
    );
    expect(duasPrincipais.ok).toBe(false);

    const valida = await createProductAction(
      null,
      productForm({
        goals: JSON.stringify([
          { goalTypeId: goalType.id, targetValue: "50.000,00", period: "monthly", isPrimary: true },
        ]),
      }),
    );
    expect(valida.ok).toBe(true);

    const goals = await db.select().from(productGoals);
    expect(goals).toHaveLength(1);
    // "50.000,00" typed in pt-BR must reach the database as 50000.
    expect(goals[0]!.targetValue).toBe(50000);
    expect(goals[0]!.isPrimary).toBe(true);
  });
});

describe("edição de produto", () => {
  async function createOwnedBy(ownerId: string | null) {
    const [product] = await db
      .insert(products)
      .values({
        code: "SKY-EDIT",
        name: "Produto",
        phase: "growth",
        status: "active",
        startDate: "2026-01-01",
        ownerId,
      })
      .returning();
    await db.insert(productPhaseHistory).values({
      productId: product!.id,
      phase: "growth",
      startedAt: "2026-01-01",
    });
    return product!;
  }

  function updateForm(id: string, overrides: Record<string, string> = {}) {
    const form = productForm({ code: "SKY-EDIT", name: "Produto renomeado", phase: "growth" });
    form.set("id", id);
    form.set("startDate", "2026-01-01");
    form.delete("plannedLaunchDate");
    for (const [key, value] of Object.entries(overrides)) form.set(key, value);
    return form;
  }

  it("permite que o gestor edite o produto de que é responsável", async () => {
    const owner = await signInAs("product_manager", "dono");
    const product = await createOwnedBy(owner.id);

    const result = await updateProductAction(null, updateForm(product.id));

    expect(result.ok).toBe(true);
    const [row] = await db.select().from(products).where(eq(products.id, product.id));
    expect(row!.name).toBe("Produto renomeado");
  });

  it("recusa que o gestor edite produto de outro responsável", async () => {
    const other = await createUser({ login: "outro", role: "product_manager" });
    const product = await createOwnedBy(other.id);
    await signInAs("product_manager", "intruso");

    const result = await updateProductAction(null, updateForm(product.id));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/responsável/i);
    const [row] = await db.select().from(products).where(eq(products.id, product.id));
    expect(row!.name).toBe("Produto");
  });

  it("permite que o administrador edite qualquer produto", async () => {
    const other = await createUser({ login: "outro", role: "product_manager" });
    const product = await createOwnedBy(other.id);
    await signInAs("admin");

    const result = await updateProductAction(null, updateForm(product.id));
    expect(result.ok).toBe(true);
  });

  it.each<UserRole>(["collaborator", "executive"])("recusa edição para o perfil %s", async (role) => {
    const product = await createOwnedBy(null);
    await signInAs(role);

    const result = await updateProductAction(null, updateForm(product.id));
    expect(result.ok).toBe(false);
  });

  it("fecha a fase anterior e abre a nova ao mudar de fase", async () => {
    await signInAs("admin");
    const product = await createOwnedBy(null);

    const result = await updateProductAction(null, updateForm(product.id, { phase: "maturity" }));
    expect(result.ok).toBe(true);

    const history = await db
      .select()
      .from(productPhaseHistory)
      .where(eq(productPhaseHistory.productId, product.id));

    expect(history).toHaveLength(2);
    const previous = history.find((row) => row.phase === "growth")!;
    const current = history.find((row) => row.phase === "maturity")!;
    expect(previous.endedAt).not.toBeNull();
    expect(current.endedAt).toBeNull();
  });
});

describe("replicação de pacote de tarefas", () => {
  async function seedPackage() {
    const [pkg] = await db
      .insert(taskPackages)
      .values({ name: "Lançamento", active: true })
      .returning();

    const inserted = await db
      .insert(taskTemplates)
      .values([
        {
          packageId: pkg!.id,
          name: "Definir preço",
          priority: "high",
          initialStatus: "backlog",
          anchor: "start_date",
          startOffsetDays: 0,
          endOffsetDays: 10,
          orderIndex: 1,
          estimatedHours: 8,
        },
        {
          packageId: pkg!.id,
          name: "Go-live",
          priority: "critical",
          initialStatus: "backlog",
          anchor: "planned_launch_date",
          startOffsetDays: 0,
          endOffsetDays: 2,
          orderIndex: 2,
        },
      ])
      .returning();

    await db.insert(taskTemplateDependencies).values({
      templateId: inserted[1]!.id,
      dependsOnTemplateId: inserted[0]!.id,
    });

    return { pkg: pkg!, templates: inserted };
  }

  it("cria as tarefas datadas e com as dependências ao criar o produto", async () => {
    await signInAs("admin");
    const { pkg } = await seedPackage();

    const result = await createProductAction(null, productForm({ packageId: pkg.id }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toMatch(/2 tarefas/);

    const created = await db.select().from(tasks).orderBy(tasks.boardOrder);
    expect(created).toHaveLength(2);

    // Anchored on the start date (2026-01-15).
    expect(created[0]).toMatchObject({
      name: "Definir preço",
      startDate: "2026-01-15",
      dueDate: "2026-01-25",
      estimatedHours: 8,
    });
    // Anchored on the planned launch date (2026-07-01).
    expect(created[1]).toMatchObject({
      name: "Go-live",
      startDate: "2026-07-01",
      dueDate: "2026-07-03",
    });

    const deps = await db.select().from(taskDependencies);
    expect(deps).toHaveLength(1);
    expect(deps[0]!.taskId).toBe(created[1]!.id);
    expect(deps[0]!.dependsOnTaskId).toBe(created[0]!.id);
  });

  it("avisa sobre duplicidade ao aplicar a um produto que já tem as tarefas, e aplica quando confirmado", async () => {
    await signInAs("admin");
    const { pkg } = await seedPackage();
    const created = await createProductAction(null, productForm({ packageId: pkg.id }));
    if (!created.ok || !created.data) throw new Error("produto não criado");
    const productId = created.data.id;

    const form = new FormData();
    form.set("productId", productId);
    form.set("packageId", pkg.id);

    const warned = await applyPackageAction(null, form);
    expect(warned.ok).toBe(false);
    if (warned.ok) return;
    expect(warned.error).toMatch(/mesmo nome/i);
    expect(await db.select().from(tasks)).toHaveLength(2);

    form.set("confirmDuplicates", "true");
    const applied = await applyPackageAction(null, form);
    expect(applied.ok).toBe(true);
    expect(await db.select().from(tasks)).toHaveLength(4);
  });

  it("recusa aplicar pacote a produto de outro responsável", async () => {
    const owner = await createUser({ login: "dono", role: "product_manager" });
    const { pkg } = await seedPackage();
    const [product] = await db
      .insert(products)
      .values({
        code: "SKY-X",
        name: "De outro",
        phase: "growth",
        status: "active",
        startDate: "2026-01-01",
        ownerId: owner.id,
      })
      .returning();

    await signInAs("product_manager", "intruso");

    const form = new FormData();
    form.set("productId", product!.id);
    form.set("packageId", pkg.id);

    const result = await applyPackageAction(null, form);

    expect(result.ok).toBe(false);
    expect(await db.select().from(tasks)).toHaveLength(0);
  });
});
