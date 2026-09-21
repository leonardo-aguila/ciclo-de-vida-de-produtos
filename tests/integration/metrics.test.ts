/**
 * Proves the wiring: rows in the database in, a full metrics object out, with
 * the engine's numbers reaching the shape the pages consume.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@db";
import {
  actionPlans,
  businessPlanMonths,
  businessPlans,
  enumValues,
  financeEntries,
  monthlySales,
  productGoals,
  productPhaseHistory,
  products,
  tasks,
} from "@db/schema";
import { addMonthsToCompetence, toCompetence, todayIso } from "@/lib/format";
import { getProductMetrics } from "@/lib/queries/metrics";
import { backfillFinancialSnapshots, getPreviousSnapshot, writeCurrentSnapshot } from "@/lib/snapshots";
import { createUser, truncateAll } from "./helpers";

async function seedSettings() {
  const { appSettings } = await import("@db/schema");
  const defaults = await import("@/lib/defaults");
  await db.insert(appSettings).values({
    id: 1,
    healthWeights: defaults.DEFAULT_HEALTH_WEIGHTS,
    semaphoreThresholds: defaults.DEFAULT_SEMAPHORE,
    recommendationRules: defaults.DEFAULT_RECOMMENDATION_RULES,
    projectionSettings: defaults.DEFAULT_PROJECTION,
    bpDeviationLimit: defaults.DEFAULT_BP_DEVIATION_LIMIT,
    defaultCurrency: defaults.DEFAULT_CURRENCY,
  });
}

/** Competences counting back from the current month, so the data is "recent". */
function monthsAgo(count: number): string {
  return addMonthsToCompetence(toCompetence(todayIso()), -count);
}

async function seedProduct(overrides: { code?: string } = {}) {
  const [product] = await db
    .insert(products)
    .values({
      code: overrides.code ?? "SKY-M",
      name: "Produto métrica",
      phase: "growth",
      status: "active",
      startDate: monthsAgo(12),
      plannedLaunchDate: monthsAgo(6),
    })
    .returning();

  await db.insert(productPhaseHistory).values({
    productId: product!.id,
    phase: "growth",
    startedAt: monthsAgo(12),
  });

  return product!;
}

beforeEach(async () => {
  await truncateAll();
  await seedSettings();
});

describe("métricas do produto", () => {
  it("monta série, resumo, projeção, health e recomendação a partir do banco", async () => {
    const product = await seedProduct();
    const [opex] = await db
      .insert(enumValues)
      .values({
        kind: "finance_entry_type",
        code: "opex",
        label: "OPEX",
        sortOrder: 1,
        meta: { isVariable: true },
      })
      .returning();

    // Seis meses de receita crescente e custo estável.
    for (let index = 5; index >= 0; index -= 1) {
      const competence = monthsAgo(index);
      await db.insert(monthlySales).values({
        productId: product.id,
        competence,
        recurringRevenue: 10000 + (5 - index) * 1000,
        activeCustomers: 100 + (5 - index) * 5,
      });
      await db.insert(financeEntries).values({
        productId: product.id,
        entryTypeId: opex!.id,
        description: "Custeio",
        amount: 4000,
        competenceDate: competence,
        isVariable: true,
      });
    }

    const metrics = await getProductMetrics(product.id);

    expect(metrics.series).toHaveLength(6);
    expect(metrics.summary.accumulatedRevenue).toBe(75000);
    expect(metrics.summary.accumulatedCost).toBe(24000);
    expect(metrics.summary.roi).toBeGreaterThan(0);

    expect(metrics.projection).not.toBeNull();
    expect(metrics.projection!.basis.monthlySlope).toBeCloseTo(1000, 0);
    expect(metrics.projection!.confidence).toBe("high");

    expect(metrics.health.score).toBeGreaterThan(0);
    expect(metrics.health.components).toHaveLength(5);
    expect(metrics.payback.status).toBe("reached");
    expect(metrics.trend.momGrowth).toBeGreaterThan(0);
    expect(["scale", "keep", "watch"]).toContain(metrics.recommendation.kind);
  });

  it("mede a meta principal contra o realizado", async () => {
    const product = await seedProduct();
    const [goalType] = await db
      .insert(enumValues)
      .values({ kind: "goal_type", code: "customers", label: "Nº de clientes", sortOrder: 1 })
      .returning();

    await db.insert(productGoals).values({
      productId: product.id,
      goalTypeId: goalType!.id,
      targetValue: 200,
      unit: "clientes",
      period: "monthly",
      isPrimary: true,
    });

    await db.insert(monthlySales).values({
      productId: product.id,
      competence: monthsAgo(0),
      recurringRevenue: 5000,
      activeCustomers: 150,
    });

    const metrics = await getProductMetrics(product.id);

    expect(metrics.primaryGoal).not.toBeNull();
    expect(metrics.primaryGoal!.realized).toBe(150);
    expect(metrics.primaryGoal!.attainmentPct).toBe(75);
    expect(metrics.primaryGoal!.reached).toBe(false);
    // 75% do alvo alimenta o componente de meta.
    expect(metrics.health.components.find((c) => c.key === "goal")!.raw).toBe(75);
  });

  it("diz que a meta não é medível quando o tipo não tem fonte de dado", async () => {
    const product = await seedProduct();
    const [goalType] = await db
      .insert(enumValues)
      .values({ kind: "goal_type", code: "nps", label: "NPS", sortOrder: 1 })
      .returning();

    await db.insert(productGoals).values({
      productId: product.id,
      goalTypeId: goalType!.id,
      targetValue: 70,
      period: "quarterly",
      isPrimary: true,
    });

    const metrics = await getProductMetrics(product.id);

    expect(metrics.primaryGoal!.realized).toBeNull();
    const goalComponent = metrics.health.components.find((c) => c.key === "goal")!;
    expect(goalComponent.raw).toBeNull();
    // A meta existe e está cadastrada; o que falta é fonte de dado para o
    // tipo dela (NPS). Dizer "sem meta principal" mandaria o usuário
    // cadastrar de novo uma meta que já está lá.
    expect(goalComponent.detail).toMatch(/não coleta dados/i);
    expect(goalComponent.detail).not.toMatch(/sem meta principal/i);
  });

  it("conta plano de ação vencido como risco em aberto", async () => {
    const product = await seedProduct();
    const owner = await createUser({ login: "dono", role: "product_manager" });

    await db.insert(actionPlans).values([
      {
        productId: product.id,
        name: "Plano vencido",
        dueDate: monthsAgo(2),
        status: "in_progress",
        ownerId: owner.id,
      },
      {
        productId: product.id,
        name: "Plano concluído no passado",
        dueDate: monthsAgo(2),
        status: "done",
        ownerId: owner.id,
      },
    ]);

    const metrics = await getProductMetrics(product.id);

    expect(metrics.risk.overdueActionPlans).toBe(1);
    const risk = metrics.health.components.find((c) => c.key === "risk")!;
    expect(risk.raw).toBe(80);
    expect(risk.detail).toMatch(/plano de ação vencido/i);
  });

  it("compara o plano vigente com o realizado e dispara o gatilho", async () => {
    const product = await seedProduct();

    const [plan] = await db
      .insert(businessPlans)
      .values({ productId: product.id, version: 1, status: "active", horizonMonths: 3 })
      .returning();

    for (let index = 2; index >= 0; index -= 1) {
      const competence = monthsAgo(index);
      await db.insert(businessPlanMonths).values({
        planId: plan!.id,
        competence,
        plannedRevenue: 10000,
        plannedCost: 4000,
        plannedMargin: 6000,
      });
      await db.insert(monthlySales).values({
        productId: product.id,
        competence,
        recurringRevenue: 7000,
      });
    }

    const metrics = await getProductMetrics(product.id);

    expect(metrics.plan.planId).toBe(plan!.id);
    expect(metrics.plan.rows).toHaveLength(3);
    expect(metrics.plan.accumulatedDeviation).toBeCloseTo(-30, 5);
    expect(metrics.plan.trigger.triggered).toBe(true);
    expect(metrics.plan.trigger.message).toMatch(/ultrapassou/i);

    const component = metrics.health.components.find((c) => c.key === "businessPlan")!;
    expect(component.raw).toBe(70);
  });

  it("produto recém-criado, sem nada lançado, não quebra e não inventa número", async () => {
    const product = await seedProduct({ code: "SKY-NOVO" });

    const metrics = await getProductMetrics(product.id);

    expect(metrics.series).toEqual([]);
    expect(metrics.summary.roi).toBeNull();
    expect(metrics.projection).toBeNull();
    expect(metrics.payback.status).toBe("insufficient_data");
    expect(metrics.primaryGoal).toBeNull();
    expect(metrics.tasks.total).toBe(0);
    expect(Number.isNaN(metrics.health.score)).toBe(false);
    expect(metrics.recommendation.kind).toBe("watch");
  });

  it("acompanha tarefas atrasadas e desvio de cronograma", async () => {
    const product = await seedProduct();

    await db.insert(tasks).values([
      {
        productId: product.id,
        name: "Atrasada",
        status: "doing",
        progress: 20,
        startDate: monthsAgo(3),
        dueDate: monthsAgo(1),
      },
      {
        productId: product.id,
        name: "Concluída",
        status: "done",
        progress: 100,
        startDate: monthsAgo(3),
        dueDate: monthsAgo(2),
        doneDate: monthsAgo(2),
      },
    ]);

    const metrics = await getProductMetrics(product.id);

    expect(metrics.tasks.total).toBe(2);
    expect(metrics.tasks.late).toBe(1);
    expect(metrics.tasks.progress).toBe(60);
    // O último prazo cai depois do lançamento previsto: desvio positivo é atraso.
    expect(metrics.tasks.scheduleDeviationDays).toBeGreaterThan(0);
  });
});

describe("snapshots de health", () => {
  it("grava o mês atual e permite comparar com o anterior", async () => {
    const product = await seedProduct();
    const [opex] = await db
      .insert(enumValues)
      .values({ kind: "finance_entry_type", code: "opex", label: "OPEX", sortOrder: 1 })
      .returning();

    for (let index = 3; index >= 0; index -= 1) {
      await db.insert(monthlySales).values({
        productId: product.id,
        competence: monthsAgo(index),
        recurringRevenue: 10000,
      });
      await db.insert(financeEntries).values({
        productId: product.id,
        entryTypeId: opex!.id,
        description: "Custeio",
        amount: 3000,
        competenceDate: monthsAgo(index),
      });
    }

    const reconstructed = await backfillFinancialSnapshots(product.id);
    expect(reconstructed).toBe(3);

    await writeCurrentSnapshot(product.id);

    const previous = await getPreviousSnapshot(product.id, toCompetence(todayIso()));
    expect(previous).not.toBeNull();
    expect(previous!.competence).toBe(monthsAgo(1));
    // O snapshot reconstruído diz que não recompôs execução nem meta.
    expect(previous!.components.execution.detail).toMatch(/não reconstruído/i);
    expect(previous!.components.financial.detail).toMatch(/reconstruído a partir/i);
  });

  it("gravar duas vezes o mesmo mês atualiza em vez de duplicar", async () => {
    const product = await seedProduct();
    await writeCurrentSnapshot(product.id);
    await writeCurrentSnapshot(product.id);

    const { healthSnapshots } = await import("@db/schema");
    const rows = await db.select().from(healthSnapshots);
    expect(rows).toHaveLength(1);
  });
});
