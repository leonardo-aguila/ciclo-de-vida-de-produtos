/**
 * One fictional product, so the executive dashboard has something to show.
 *
 * The eight products imported from the Jira Roadmap carry no money, no goal
 * and no business plan, because Jira holds none — so every financial panel in
 * the application sits empty and the health score reads "sem medição". That is
 * the honest answer for those products, and it stays that way.
 *
 * This module adds a ninth product whose numbers are invented on purpose, to
 * exercise the panels end to end: revenue, cost, goals, business plan, action
 * plan, insights and comments.
 *
 * It is named "Produto Exemplo (dados fictícios)" and coded `EXEMPLO`, and the
 * label is in the name itself rather than in a note somewhere, because the name
 * is what travels: it is what shows on the portfolio matrix, in the health
 * ranking, in the CSV export and in the printed PDF. Beside eight real Nimbus
 * launches with real colleagues attached, a made-up R$ 800 mil that is not
 * marked as made-up is a number waiting to be quoted in a meeting.
 *
 * Tasks come from the "Novo Produto" package, so the schedule is the real
 * go-to-market derived from the Astra launch rather than a second invention.
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, inArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { BCRYPT_ROUNDS } from "../../src/lib/defaults";
import { planTasksFromPackage } from "../../src/lib/engine/schedule";
import { addDaysToIso, addMonthsToCompetence, toCompetence, todayIso } from "../../src/lib/format";
import * as schema from "../schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

export const EXAMPLE_CODE = "EXEMPLO";
const EXAMPLE_NAME = "Produto Exemplo (dados fictícios)";
const PACKAGE_NAME = "Novo Produto";

const TODAY = todayIso();
const THIS_MONTH = toCompetence(TODAY);
const monthsAgo = (n: number) => addMonthsToCompetence(THIS_MONTH, -n);
const daysFromToday = (n: number) => addDaysToIso(TODAY, n);
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Months of history. The product launched a year and a bit ago. */
const MONTHS = 14;
const START = monthsAgo(20);
const LAUNCH = monthsAgo(MONTHS - 1);

/* -------------------------------------------------------------------------- */
/* Curves                                                                     */
/* -------------------------------------------------------------------------- */

type SalesMonth = {
  competence: string;
  recurringRevenue: number;
  newMrr: number;
  oneTimeRevenue: number;
  churnAmount: number;
  activeCustomers: number;
  newCustomers: number;
  churnedCustomers: number;
};

/**
 * A growing subscription, with a small wobble.
 *
 * Written out rather than randomised: the dashboard has to land on a specific
 * recommendation, and a random walk would move it between runs.
 */
function buildSales(): SalesMonth[] {
  const series: SalesMonth[] = [];
  let mrr = 38_000;
  let customers = 11;

  for (let index = 0; index < MONTHS; index += 1) {
    const nudge = 1 + (index % 3 === 1 ? 0.025 : index % 3 === 2 ? -0.02 : 0);
    const recurring = round2(mrr * nudge);
    const previous = series[series.length - 1];
    const churned = Math.round(customers * 0.02);
    const next = Math.max(1, Math.round(customers * 1.06));

    series.push({
      competence: monthsAgo(MONTHS - 1 - index),
      recurringRevenue: recurring,
      newMrr: previous ? Math.max(0, round2(recurring - previous.recurringRevenue)) : recurring,
      oneTimeRevenue: round2(recurring * 0.06),
      churnAmount: round2(recurring * 0.02),
      activeCustomers: customers,
      newCustomers: Math.max(0, next - customers + churned),
      churnedCustomers: churned,
    });

    mrr *= 1.07;
    customers = next;
  }

  return series;
}

type CostSpec = {
  typeCode: string;
  description: string;
  category: string;
  amount: number;
  from: string;
  months: number;
  drift?: number;
  supplier?: string;
  costCenter?: string;
};

const COSTS: CostSpec[] = [
  {
    typeCode: "capex",
    description: "Construção da plataforma",
    category: "Engenharia",
    amount: 180_000,
    from: START,
    months: 1,
    costCenter: "P&D",
  },
  {
    typeCode: "opex",
    description: "Infraestrutura de produção",
    category: "Infraestrutura",
    amount: 9_000,
    from: LAUNCH,
    months: MONTHS,
    drift: 1.03,
    supplier: "AWS",
    costCenter: "Operações",
  },
  {
    typeCode: "opex",
    description: "Squad de produto",
    category: "Pessoas",
    amount: 26_000,
    from: LAUNCH,
    months: MONTHS,
    drift: 1.01,
    costCenter: "P&D",
  },
  {
    typeCode: "direct_cost",
    description: "Onboarding e suporte dedicado",
    category: "Serviços",
    amount: 3_500,
    from: monthsAgo(9),
    months: 9,
    drift: 1.04,
    costCenter: "Operações",
  },
];

/* -------------------------------------------------------------------------- */
/* Seed                                                                       */
/* -------------------------------------------------------------------------- */

export async function seedExampleProduct(db: Database): Promise<string> {
  const enumRows = await db
    .select({ id: schema.enumValues.id, kind: schema.enumValues.kind, code: schema.enumValues.code })
    .from(schema.enumValues);
  const enumId = (kind: string, code: string) => {
    const found = enumRows.find((row) => row.kind === kind && row.code === code)?.id;
    if (!found) throw new Error(`enum ${kind}:${code} não encontrado — rode npm run db:migrate`);
    return found;
  };

  const [admin] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.login, "admin"))
    .limit(1);
  if (!admin) throw new Error("usuário admin não encontrado");

  // A fictional owner, so the example does not attribute invented revenue to a
  // real colleague. Inactive and with a password nobody holds, like the people
  // imported from Jira.
  const ownerEmail = "exemplo@portfolio.local";
  let [owner] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, ownerEmail))
    .limit(1);
  if (!owner) {
    [owner] = await db
      .insert(schema.users)
      .values({
        name: "Responsável de Exemplo",
        email: ownerEmail,
        login: "exemplo",
        passwordHash: bcrypt.hashSync(randomBytes(32).toString("base64"), BCRYPT_ROUNDS),
        role: "product_manager",
        active: false,
      })
      .returning({ id: schema.users.id });
  }

  // Re-runnable: the example is replaced, never duplicated. Everything hanging
  // off the product goes with it through the cascade.
  const [existing] = await db
    .select({ id: schema.products.id })
    .from(schema.products)
    .where(eq(schema.products.code, EXAMPLE_CODE))
    .limit(1);
  if (existing) {
    await db.delete(schema.products).where(eq(schema.products.id, existing.id));
    console.log("  exemplo anterior removido");
  }

  /* --- Product --------------------------------------------------------- */

  const [product] = await db
    .insert(schema.products)
    .values({
      code: EXAMPLE_CODE,
      name: EXAMPLE_NAME,
      shortDescription:
        "Produto de demonstração. Receita, custo, metas e Business Plan são inventados, para o painel executivo ter o que mostrar — os oito produtos vindos do Jira não têm esses dados.",
      ownerId: owner!.id,
      team: "Produtos",
      categoryId: enumId("product_category", "data"),
      phase: "growth",
      status: "active",
      startDate: START,
      plannedLaunchDate: LAUNCH,
      actualLaunchDate: addDaysToIso(LAUNCH, 11),
      segment: "Mid-market · exemplo",
      pricingModel: "Assinatura mensal por usuário",
      competitors: "—",
      tags: ["exemplo", "dados-ficticios"],
      createdBy: admin.id,
    })
    .returning({ id: schema.products.id });

  const productId = product!.id;

  await db.insert(schema.productPhaseHistory).values([
    { productId, phase: "conception", startedAt: START, endedAt: monthsAgo(18), changedBy: admin.id },
    { productId, phase: "development", startedAt: monthsAgo(18), endedAt: LAUNCH, changedBy: admin.id },
    { productId, phase: "launch", startedAt: LAUNCH, endedAt: monthsAgo(9), changedBy: admin.id },
    { productId, phase: "growth", startedAt: monthsAgo(9), endedAt: null, changedBy: admin.id },
  ]);

  /* --- Sales and costs -------------------------------------------------- */

  const sales = buildSales();
  await db.insert(schema.monthlySales).values(
    sales.map((month) => ({
      productId,
      competence: month.competence,
      newMrr: month.newMrr,
      recurringRevenue: month.recurringRevenue,
      oneTimeRevenue: month.oneTimeRevenue,
      churnAmount: month.churnAmount,
      churnRate: round2((month.churnedCustomers / month.activeCustomers) * 100),
      newCustomers: month.newCustomers,
      activeCustomers: month.activeCustomers,
      churnedCustomers: month.churnedCustomers,
      avgTicket: round2(month.recurringRevenue / month.activeCustomers),
      source: "manual" as const,
    })),
  );

  await db.insert(schema.financeEntries).values(
    COSTS.flatMap((spec) => {
      const rows = [];
      let amount = spec.amount;
      for (let index = 0; index < spec.months; index += 1) {
        rows.push({
          productId,
          entryTypeId: enumId("finance_entry_type", spec.typeCode),
          category: spec.category,
          description: spec.description,
          amount: round2(amount),
          currency: "BRL",
          competenceDate: addMonthsToCompetence(spec.from, index),
          isVariable: spec.typeCode !== "capex",
          recurring: spec.months > 1,
          recurrencePeriod: spec.months > 1 ? ("monthly" as const) : null,
          recurrenceEnd: spec.months > 1 ? addMonthsToCompetence(spec.from, spec.months - 1) : null,
          costCenter: spec.costCenter ?? null,
          supplier: spec.supplier ?? null,
          createdBy: admin.id,
        });
        amount *= spec.drift ?? 1;
      }
      return rows;
    }),
  );

  /* --- Goals ------------------------------------------------------------ */

  await db.insert(schema.productGoals).values([
    {
      productId,
      goalTypeId: enumId("goal_type", "new_mrr"),
      targetValue: 17_000,
      unit: "R$",
      period: "quarterly",
      deadline: daysFromToday(120),
      isPrimary: true,
    },
    {
      productId,
      goalTypeId: enumId("goal_type", "customers"),
      targetValue: 30,
      unit: "clientes",
      period: "monthly",
      deadline: daysFromToday(200),
      isPrimary: false,
    },
  ]);

  /* --- Tasks, from the "Novo Produto" package --------------------------- */

  const [pkg] = await db
    .select({ id: schema.taskPackages.id })
    .from(schema.taskPackages)
    .where(eq(schema.taskPackages.name, PACKAGE_NAME))
    .limit(1);
  if (!pkg) {
    throw new Error(`pacote "${PACKAGE_NAME}" não existe — rode npm run db:packages:jira antes`);
  }

  const templates = await db
    .select()
    .from(schema.taskTemplates)
    .where(eq(schema.taskTemplates.packageId, pkg.id));
  const templateDeps = await db
    .select()
    .from(schema.taskTemplateDependencies)
    .where(
      inArray(
        schema.taskTemplateDependencies.templateId,
        templates.map((template) => template.id),
      ),
    );

  const { tasks: planned } = planTasksFromPackage(
    templates.map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      categoryId: template.categoryId,
      defaultAssigneeId: template.defaultAssigneeId,
      priority: template.priority,
      initialStatus: template.initialStatus,
      estimatedHours: template.estimatedHours,
      anchor: template.anchor,
      startOffsetDays: template.startOffsetDays,
      endOffsetDays: template.endOffsetDays,
      orderIndex: template.orderIndex,
      parentTemplateId: template.parentTemplateId,
      dependsOn: templateDeps
        .filter((dep) => dep.templateId === template.id)
        .map((dep) => dep.dependsOnTemplateId),
    })),
    { startDate: START, plannedLaunchDate: LAUNCH },
  );

  // The package's dates land in the past, since the product launched a year
  // ago: everything whose deadline has passed is closed, the rest is in
  // flight. Two are left open and late, so the alerts have something real.
  const inserted = await db
    .insert(schema.tasks)
    .values(
      planned.map((task, index) => {
        const overdue = task.dueDate < TODAY;
        const late = overdue && index % 13 === 5;
        const done = overdue && !late;
        return {
          productId,
          name: task.name,
          description: task.description,
          categoryId: task.categoryId,
          assigneeId: owner!.id,
          status: done ? "done" : late ? "doing" : index % 4 === 0 ? "doing" : "todo",
          priority: task.priority,
          progress: done ? 100 : late ? 60 : index % 4 === 0 ? 35 : 0,
          startDate: task.startDate,
          dueDate: task.dueDate,
          doneDate: done ? task.dueDate : null,
          estimatedHours: 8 + (index % 5) * 8,
          boardOrder: index,
          originTemplateId: task.templateId,
        };
      }),
    )
    .returning({ id: schema.tasks.id, originTemplateId: schema.tasks.originTemplateId });

  const taskIdByTemplate = new Map(
    inserted.filter((row) => row.originTemplateId).map((row) => [row.originTemplateId!, row.id]),
  );
  const dependencyRows = planned.flatMap((task) =>
    task.dependsOn
      .map((templateId) => ({
        taskId: taskIdByTemplate.get(task.templateId),
        dependsOnTaskId: taskIdByTemplate.get(templateId),
      }))
      .filter((row) => row.taskId && row.dependsOnTaskId)
      .map((row) => ({ taskId: row.taskId!, dependsOnTaskId: row.dependsOnTaskId! })),
  );
  if (dependencyRows.length > 0) {
    await db.insert(schema.taskDependencies).values(dependencyRows);
  }

  /* --- Business plan ---------------------------------------------------- */

  const [plan] = await db
    .insert(schema.businessPlans)
    .values({
      productId,
      version: 1,
      approvedAt: LAUNCH,
      authorId: admin.id,
      assumptions:
        "Plano de exemplo: crescimento de 8% ao mês sobre a base instalada, custo de infraestrutura acompanhando o volume e squad estável. O realizado veio abaixo, e é esse desvio que dispara o plano de ação.",
      horizonMonths: 18,
      status: "active",
    })
    .returning({ id: schema.businessPlans.id });

  await db.insert(schema.businessPlanMonths).values(
    Array.from({ length: 18 }, (_, index) => {
      // Deliberately optimistic against the curve above, so the comparison has
      // a gap to show and the deviation trigger fires.
      const revenue = 46_000 * 1.08 ** index;
      const cost = 38_000 * 1.02 ** index;
      return {
        planId: plan!.id,
        competence: addMonthsToCompetence(LAUNCH, index),
        plannedRevenue: round2(revenue),
        plannedCost: round2(cost),
        plannedCustomers: 11 + index * 2,
        plannedMargin: round2(revenue - cost),
      };
    }),
  );

  await db.insert(schema.milestones).values([
    {
      planId: plan!.id,
      name: "Primeiros 10 contratos pagantes",
      targetDate: monthsAgo(10),
      acceptanceCriteria: "Dez contratos com faturamento reconhecido no mês.",
      status: "done",
      doneDate: addDaysToIso(monthsAgo(10), -6),
      orderIndex: 1,
    },
    {
      planId: plan!.id,
      name: "Integração com o Console",
      targetDate: monthsAgo(1),
      acceptanceCriteria: "Provisionamento pelo Console, sem ticket manual.",
      status: "in_progress",
      doneDate: null,
      orderIndex: 2,
    },
    {
      planId: plan!.id,
      name: "30 contratos ativos",
      targetDate: daysFromToday(150),
      acceptanceCriteria: "Trinta contratos ativos no fechamento do mês.",
      status: "pending",
      doneDate: null,
      orderIndex: 3,
    },
  ]);

  await db.insert(schema.actionPlans).values({
    productId,
    planId: plan!.id,
    name: "Recuperar o ritmo de aquisição",
    description:
      "Rever a oferta de entrada e reativar o canal de indicação, que respondia por um terço das oportunidades antes do último trimestre.",
    rootCause:
      "O plano assumia 8% de crescimento ao mês; o realizado ficou em torno de 7%, e a diferença acumulou ao longo do ano.",
    ownerId: owner!.id,
    dueDate: daysFromToday(-6),
    status: "in_progress",
    expectedResult: "Voltar ao ritmo de 8% ao mês em dois trimestres.",
    actualResult: null,
    triggerCompetence: monthsAgo(3),
    triggerDeviation: -17.2,
  });

  /* --- Insights --------------------------------------------------------- */

  await db.insert(schema.insights).values([
    {
      productId,
      title: "Exportação agendada por e-mail",
      description: "Pedido recorrente do time financeiro dos clientes maiores.",
      originId: enumId("insight_origin", "customer"),
      ownerId: owner!.id,
      insightDate: daysFromToday(-22),
      status: "approved",
      effort: 2,
      impact: 8,
    },
    {
      productId,
      title: "Provisionamento pelo Console",
      description: "Tira o ticket manual do caminho da ativação.",
      originId: enumId("insight_origin", "internal"),
      ownerId: owner!.id,
      insightDate: daysFromToday(-40),
      status: "in_progress",
      effort: 5,
      impact: 9,
    },
    {
      productId,
      title: "Painel de uso por cliente",
      description: "O time comercial pede para preparar a renovação.",
      originId: enumId("insight_origin", "sales"),
      ownerId: owner!.id,
      insightDate: daysFromToday(-14),
      status: "new",
      effort: 4,
      impact: 6,
    },
    {
      productId,
      title: "Reescrever o motor de regras",
      description: "Custo alto, ganho difuso — fica no radar, sem data.",
      originId: enumId("insight_origin", "internal"),
      ownerId: owner!.id,
      insightDate: daysFromToday(-65),
      status: "new",
      effort: 9,
      impact: 3,
    },
    {
      productId,
      title: "Tema escuro",
      description: "Pedido pontual, sem efeito em contrato.",
      originId: enumId("insight_origin", "customer"),
      ownerId: owner!.id,
      insightDate: daysFromToday(-70),
      status: "discarded",
      effort: 3,
      impact: 2,
    },
  ]);

  /* --- Decision and comments -------------------------------------------- */

  await db.insert(schema.productDecisions).values({
    productId,
    recommended: "keep",
    outcome: "accepted",
    justification:
      "Comitê aprovou manter o investimento por mais dois trimestres, condicionado à recuperação do ritmo de aquisição tratada no plano de ação.",
    metricsSnapshot: { health: 74, roi: 9.8, momGrowth: 6.9 },
    decidedBy: admin.id,
  });

  await db.insert(schema.productComments).values([
    {
      productId,
      authorId: owner!.id,
      categoryId: enumId("comment_category", "opportunity"),
      body: "Pediram exportação agendada por e-mail para o fechamento mensal do financeiro.",
      commentDate: daysFromToday(-31),
    },
    {
      productId,
      authorId: owner!.id,
      categoryId: enumId("comment_category", "customer_feedback"),
      body: "Outro cliente pediu exportação agendada, também para o fechamento do financeiro.",
      commentDate: daysFromToday(-12),
    },
    {
      productId,
      authorId: owner!.id,
      categoryId: enumId("comment_category", "risk"),
      body: "Ativação ainda depende de ticket manual e trava o provisionamento na primeira semana.",
      commentDate: daysFromToday(-26),
    },
    {
      productId,
      authorId: owner!.id,
      categoryId: enumId("comment_category", "risk"),
      body: "Provisionamento manual atrasou a ativação de novo, dois clientes na mesma semana.",
      commentDate: daysFromToday(-9),
    },
    {
      productId,
      authorId: owner!.id,
      categoryId: enumId("comment_category", "operational"),
      body: "Janela de manutenção antecipada sem aviso ao time de suporte.",
      commentDate: daysFromToday(-45),
    },
  ]);

  console.log(
    `  ${EXAMPLE_NAME}: ${sales.length} meses de venda, ${planned.length} tarefas do pacote "${PACKAGE_NAME}", plano, marcos, insights e comentários`,
  );

  return productId;
}
