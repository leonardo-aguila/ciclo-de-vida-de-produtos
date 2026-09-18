import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@db";
import {
  actionPlans,
  businessPlanMonths,
  businessPlans,
  milestones,
  monthlySales,
  products,
  type UserRole,
} from "@db/schema";
import { createSession } from "@/lib/auth/service";
import { addMonthsToCompetence, toCompetence, todayIso } from "@/lib/format";
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

const {
  createVersionAction,
  saveActionPlanAction,
  saveMilestoneAction,
  savePlanAction,
  savePlanMonthsAction,
} = await import("@/app/actions/business-plan");

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? "portfolio_session";

async function signInAs(role: UserRole, login = `user_${role}`) {
  const user = await createUser({ login, role });
  const { token } = await createSession(db, user.id);
  jar.set(SESSION_COOKIE, token);
  return user;
}

function monthsAgo(count: number): string {
  return addMonthsToCompetence(toCompetence(todayIso()), -count);
}

async function seedProduct(ownerId: string | null) {
  const [product] = await db
    .insert(products)
    .values({
      code: "SKY-BP",
      name: "Produto do plano",
      phase: "growth",
      status: "active",
      startDate: monthsAgo(12),
      ownerId,
    })
    .returning();
  return product!;
}

function planForm(productId: string, overrides: Record<string, string> = {}) {
  const form = new FormData();
  form.set("productId", productId);
  form.set("horizonMonths", "12");
  form.set("status", "active");
  form.set("assumptions", "Preço médio de R$ 400 e canal direto.");
  for (const [key, value] of Object.entries(overrides)) form.set(key, value);
  return form;
}

beforeEach(async () => {
  jar.clear();
  await truncateAll();
});

describe("versões do Business Plan", () => {
  it("cria a primeira versão como vigente", async () => {
    const owner = await signInAs("product_manager");
    const product = await seedProduct(owner.id);

    const result = await savePlanAction(null, planForm(product.id));
    expect(result.ok).toBe(true);

    const [plan] = await db.select().from(businessPlans);
    expect(plan!.version).toBe(1);
    expect(plan!.status).toBe("active");
    expect(plan!.authorId).toBe(owner.id);
  });

  it("uma nova versão preserva a anterior e assume a vigência", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    await savePlanAction(null, planForm(product.id));
    const [first] = await db.select().from(businessPlans);

    // Projeções e um marco, para conferir a cópia.
    const monthsForm = new FormData();
    monthsForm.set("planId", first!.id);
    monthsForm.set(
      "rows",
      JSON.stringify([
        {
          competence: monthsAgo(1).slice(0, 7),
          plannedRevenue: 10000,
          plannedCost: 4000,
          plannedCustomers: 10,
          plannedMargin: 6000,
        },
      ]),
    );
    await savePlanMonthsAction(null, monthsForm);

    const milestoneForm = new FormData();
    milestoneForm.set("planId", first!.id);
    milestoneForm.set("name", "Beta fechado");
    milestoneForm.set("targetDate", monthsAgo(1));
    milestoneForm.set("status", "pending");
    await saveMilestoneAction(null, milestoneForm);

    const versionForm = new FormData();
    versionForm.set("productId", product.id);
    versionForm.set("fromPlanId", first!.id);
    versionForm.set("copyContent", "true");

    const result = await createVersionAction(null, versionForm);
    expect(result.ok).toBe(true);

    const plans = await db.select().from(businessPlans).orderBy(businessPlans.version);
    expect(plans).toHaveLength(2);
    expect(plans[0]!.status).toBe("superseded");
    expect(plans[1]!.status).toBe("active");
    expect(plans[1]!.version).toBe(2);

    // O conteúdo foi copiado, e o da versão antiga continua lá.
    const allMonths = await db.select().from(businessPlanMonths);
    expect(allMonths).toHaveLength(2);
    const allMilestones = await db.select().from(milestones);
    expect(allMilestones).toHaveLength(2);
    expect(allMilestones.every((milestone) => milestone.name === "Beta fechado")).toBe(true);
  });

  it("nova versão sem copiar conteúdo nasce vazia, e a antiga mantém o dela", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    await savePlanAction(null, planForm(product.id));
    const [first] = await db.select().from(businessPlans);

    const monthsForm = new FormData();
    monthsForm.set("planId", first!.id);
    monthsForm.set(
      "rows",
      JSON.stringify([
        {
          competence: monthsAgo(1).slice(0, 7),
          plannedRevenue: 10000,
          plannedCost: 4000,
          plannedCustomers: 10,
          plannedMargin: 6000,
        },
      ]),
    );
    await savePlanMonthsAction(null, monthsForm);

    const versionForm = new FormData();
    versionForm.set("productId", product.id);
    versionForm.set("fromPlanId", first!.id);
    // copyContent ausente ⇒ falso

    await createVersionAction(null, versionForm);

    const months = await db.select().from(businessPlanMonths);
    expect(months).toHaveLength(1);
    expect(months[0]!.planId).toBe(first!.id);
  });

  it("só existe um plano vigente por produto", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    await savePlanAction(null, planForm(product.id));
    await savePlanAction(null, planForm(product.id));

    const active = await db
      .select()
      .from(businessPlans)
      .where(eq(businessPlans.status, "active"));
    expect(active).toHaveLength(1);
  });

  it("recusa a criação por quem não é responsável pelo produto", async () => {
    const other = await createUser({ login: "dono", role: "product_manager" });
    const product = await seedProduct(other.id);
    await signInAs("product_manager", "intruso");

    const result = await savePlanAction(null, planForm(product.id));
    expect(result.ok).toBe(false);
    expect(await db.select().from(businessPlans)).toHaveLength(0);
  });
});

describe("projeções mensais", () => {
  it("substitui a tabela inteira ao salvar", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    await savePlanAction(null, planForm(product.id));
    const [plan] = await db.select().from(businessPlans);

    const first = new FormData();
    first.set("planId", plan!.id);
    first.set(
      "rows",
      JSON.stringify([
        { competence: "2026-01", plannedRevenue: 1000, plannedCost: 400, plannedCustomers: 5, plannedMargin: 600 },
        { competence: "2026-02", plannedRevenue: 2000, plannedCost: 500, plannedCustomers: 8, plannedMargin: 1500 },
      ]),
    );
    await savePlanMonthsAction(null, first);
    expect(await db.select().from(businessPlanMonths)).toHaveLength(2);

    const second = new FormData();
    second.set("planId", plan!.id);
    second.set(
      "rows",
      JSON.stringify([
        { competence: "2026-01", plannedRevenue: 9999, plannedCost: 0, plannedCustomers: 0, plannedMargin: 9999 },
      ]),
    );
    await savePlanMonthsAction(null, second);

    const months = await db.select().from(businessPlanMonths);
    expect(months).toHaveLength(1);
    expect(months[0]!.plannedRevenue).toBe(9999);
    // A competência é normalizada para o primeiro dia do mês.
    expect(months[0]!.competence).toBe("2026-01-01");
  });
});

describe("marcos", () => {
  it("preenche a data de conclusão ao marcar como concluído", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    await savePlanAction(null, planForm(product.id));
    const [plan] = await db.select().from(businessPlans);

    const form = new FormData();
    form.set("planId", plan!.id);
    form.set("name", "Go-live");
    form.set("targetDate", monthsAgo(1));
    form.set("status", "done");

    await saveMilestoneAction(null, form);

    const [milestone] = await db.select().from(milestones);
    expect(milestone!.doneDate).toBe(todayIso());
  });

  it("limpa a data de conclusão ao voltar para pendente", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    await savePlanAction(null, planForm(product.id));
    const [plan] = await db.select().from(businessPlans);

    const create = new FormData();
    create.set("planId", plan!.id);
    create.set("name", "Go-live");
    create.set("targetDate", monthsAgo(1));
    create.set("status", "done");
    await saveMilestoneAction(null, create);
    const [milestone] = await db.select().from(milestones);

    const update = new FormData();
    update.set("planId", plan!.id);
    update.set("id", milestone!.id);
    update.set("name", "Go-live");
    update.set("targetDate", monthsAgo(1));
    update.set("status", "in_progress");
    await saveMilestoneAction(null, update);

    const [updated] = await db.select().from(milestones).where(eq(milestones.id, milestone!.id));
    expect(updated!.doneDate).toBeNull();
  });
});

describe("gatilho de desvio e planos de ação", () => {
  it("o gatilho dispara pelo desvio acumulado e o plano guarda a competência que o originou", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    await savePlanAction(null, planForm(product.id));
    const [plan] = await db.select().from(businessPlans);

    // Plano de 10 mil por mês; realizado de 7 mil ⇒ desvio de −30%.
    const rows = [2, 1, 0].map((index) => ({
      competence: monthsAgo(index).slice(0, 7),
      plannedRevenue: 10000,
      plannedCost: 4000,
      plannedCustomers: 10,
      plannedMargin: 6000,
    }));
    const monthsForm = new FormData();
    monthsForm.set("planId", plan!.id);
    monthsForm.set("rows", JSON.stringify(rows));
    await savePlanMonthsAction(null, monthsForm);

    for (const index of [2, 1, 0]) {
      await db.insert(monthlySales).values({
        productId: product.id,
        competence: monthsAgo(index),
        recurringRevenue: 7000,
      });
    }

    const { getProductMetrics } = await import("@/lib/queries/metrics");
    const metrics = await getProductMetrics(product.id);

    expect(metrics.plan.trigger.triggered).toBe(true);
    expect(metrics.plan.trigger.deviation).toBeCloseTo(-30, 5);

    const actionForm = new FormData();
    actionForm.set("productId", product.id);
    actionForm.set("planId", plan!.id);
    actionForm.set("name", "Recuperar receita");
    actionForm.set("rootCause", "Dois contratos grandes atrasaram a assinatura.");
    actionForm.set("dueDate", monthsAgo(-1));
    actionForm.set("status", "in_progress");
    actionForm.set("triggerCompetence", metrics.plan.trigger.competence ?? "");
    actionForm.set("triggerDeviation", String(metrics.plan.trigger.deviation ?? ""));

    const result = await saveActionPlanAction(null, actionForm);
    expect(result.ok).toBe(true);

    const [saved] = await db.select().from(actionPlans);
    expect(saved!.triggerCompetence).toBe(metrics.plan.trigger.competence);
    expect(saved!.triggerDeviation).toBeCloseTo(-30, 1);
  });

  it("o gatilho não dispara dentro do limite", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);
    await savePlanAction(null, planForm(product.id));
    const [plan] = await db.select().from(businessPlans);

    const monthsForm = new FormData();
    monthsForm.set("planId", plan!.id);
    monthsForm.set(
      "rows",
      JSON.stringify([
        {
          competence: monthsAgo(0).slice(0, 7),
          plannedRevenue: 10000,
          plannedCost: 0,
          plannedCustomers: 0,
          plannedMargin: 10000,
        },
      ]),
    );
    await savePlanMonthsAction(null, monthsForm);

    await db.insert(monthlySales).values({
      productId: product.id,
      competence: monthsAgo(0),
      recurringRevenue: 9500,
    });

    const { getProductMetrics } = await import("@/lib/queries/metrics");
    const metrics = await getProductMetrics(product.id);

    expect(metrics.plan.trigger.triggered).toBe(false);
    expect(metrics.plan.trigger.deviation).toBeCloseTo(-5, 5);
  });

  it("plano de ação vencido entra como risco no Health Score", async () => {
    const owner = await signInAs("admin");
    const product = await seedProduct(owner.id);

    const form = new FormData();
    form.set("productId", product.id);
    form.set("name", "Plano que venceu");
    form.set("dueDate", monthsAgo(2));
    form.set("status", "pending");
    await saveActionPlanAction(null, form);

    const { getProductMetrics } = await import("@/lib/queries/metrics");
    const metrics = await getProductMetrics(product.id);

    expect(metrics.risk.overdueActionPlans).toBe(1);
    expect(metrics.health.components.find((c) => c.key === "risk")!.raw).toBe(80);
  });

  it("o executivo não cria plano de ação", async () => {
    const owner = await createUser({ login: "dono", role: "product_manager" });
    const product = await seedProduct(owner.id);
    await signInAs("executive");

    const form = new FormData();
    form.set("productId", product.id);
    form.set("name", "Não deveria existir");
    form.set("dueDate", monthsAgo(-1));
    form.set("status", "pending");

    const result = await saveActionPlanAction(null, form);
    expect(result.ok).toBe(false);
    expect(await db.select().from(actionPlans)).toHaveLength(0);
  });
});
