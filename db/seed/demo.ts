/**
 * Demo data — five products, each at a different point of the lifecycle.
 *
 * The set exists to exercise the whole application with numbers that behave
 * like real ones, and to make the interesting cases reachable without typing:
 *
 *   SKY-LAKE    maturidade, saudável        → deve recomendar "escalar"
 *   SKY-SHIELD  crescimento, ainda pagando  → deve recomendar "manter"
 *   SKY-VM      declínio, ROI negativo      → deve recomendar "descontinuar"
 *   SKY-AIOPS   pré-lançamento, sem venda   → metas e projeção sem medição
 *   SKY-COPILOT recém-criado, sem histórico → o caso vazio, de ponta a ponta
 *
 * Everything is anchored to the current month, so the seed stays current
 * however long after it was written the database is rebuilt. The revenue
 * curves are written by hand rather than randomised: the recommendation engine
 * has to land on a specific answer for each product, and a random walk would
 * flip it from one run to the next.
 */
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { planTasksFromPackage } from "../../src/lib/engine/schedule";
import { addDaysToIso, addMonthsToCompetence, toCompetence, todayIso } from "../../src/lib/format";
import * as schema from "../schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

const TODAY = todayIso();
const THIS_MONTH = toCompetence(TODAY);

/** Competence n months before the current one. */
const monthsAgo = (n: number) => addMonthsToCompetence(THIS_MONTH, -n);
/** A date n days from today, for deadlines and done dates. */
const daysFromToday = (n: number) => addDaysToIso(TODAY, n);

const round2 = (value: number) => Math.round(value * 100) / 100;

/* -------------------------------------------------------------------------- */
/* Revenue curves                                                             */
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
 * Builds a monthly series from a starting MRR and a per-month multiplier.
 *
 * `wobble` shifts alternating months by a small amount so the chart does not
 * look like a drawn line — real revenue is never perfectly geometric, and a
 * perfectly smooth series would make the stability indicator meaningless.
 */
function buildSeries(options: {
  months: number;
  startMrr: number;
  monthlyGrowth: number;
  startCustomers: number;
  customerGrowth: number;
  ticketOneTimeShare?: number;
  churnShare?: number;
  wobble?: number;
}): SalesMonth[] {
  const {
    months,
    startMrr,
    monthlyGrowth,
    startCustomers,
    customerGrowth,
    ticketOneTimeShare = 0,
    churnShare = 0.02,
    wobble = 0.02,
  } = options;

  const series: SalesMonth[] = [];
  let mrr = startMrr;
  let customers = startCustomers;

  for (let index = 0; index < months; index += 1) {
    const competence = monthsAgo(months - 1 - index);
    const nudge = 1 + (index % 3 === 1 ? wobble : index % 3 === 2 ? -wobble : 0);
    const recurring = round2(mrr * nudge);
    const previous = series[series.length - 1];
    const newMrr = previous ? Math.max(0, round2(recurring - previous.recurringRevenue)) : recurring;
    const churnedCustomers = Math.round(customers * churnShare);
    const nextCustomers = Math.max(1, Math.round(customers * customerGrowth));

    series.push({
      competence,
      recurringRevenue: recurring,
      newMrr,
      oneTimeRevenue: round2(recurring * ticketOneTimeShare),
      churnAmount: round2(recurring * churnShare),
      activeCustomers: customers,
      newCustomers: Math.max(0, nextCustomers - customers + churnedCustomers),
      churnedCustomers,
    });

    mrr *= monthlyGrowth;
    customers = nextCustomers;
  }

  return series;
}

/* -------------------------------------------------------------------------- */
/* Lookups                                                                     */
/* -------------------------------------------------------------------------- */

type Lookups = {
  users: Map<string, string>;
  enums: Map<string, string>;
  packages: Map<string, string>;
};

async function loadLookups(db: Database): Promise<Lookups> {
  const userRows = await db
    .select({ id: schema.users.id, login: schema.users.login })
    .from(schema.users);
  const enumRows = await db
    .select({ id: schema.enumValues.id, kind: schema.enumValues.kind, code: schema.enumValues.code })
    .from(schema.enumValues);
  const packageRows = await db
    .select({ id: schema.taskPackages.id, name: schema.taskPackages.name })
    .from(schema.taskPackages);

  return {
    users: new Map(userRows.map((row) => [row.login, row.id])),
    // Keyed by "kind:code" — codes repeat across kinds ("other", "support").
    enums: new Map(enumRows.map((row) => [`${row.kind}:${row.code}`, row.id])),
    packages: new Map(packageRows.map((row) => [row.name, row.id])),
  };
}

const need = <T>(map: Map<string, T>, key: string): T => {
  const value = map.get(key);
  if (value === undefined) throw new Error(`seed: não encontrei "${key}"`);
  return value;
};

/* -------------------------------------------------------------------------- */
/* Writers                                                                     */
/* -------------------------------------------------------------------------- */

async function writeSales(db: Database, productId: string, series: SalesMonth[]) {
  if (series.length === 0) return;
  await db.insert(schema.monthlySales).values(
    series.map((month) => ({
      productId,
      competence: month.competence,
      newMrr: month.newMrr,
      recurringRevenue: month.recurringRevenue,
      oneTimeRevenue: month.oneTimeRevenue,
      churnAmount: month.churnAmount,
      churnRate:
        month.activeCustomers > 0
          ? round2((month.churnedCustomers / month.activeCustomers) * 100)
          : 0,
      newCustomers: month.newCustomers,
      activeCustomers: month.activeCustomers,
      churnedCustomers: month.churnedCustomers,
      avgTicket:
        month.activeCustomers > 0
          ? round2(month.recurringRevenue / month.activeCustomers)
          : 0,
      source: "manual" as const,
    })),
  );
}

type CostSpec = {
  typeCode: string;
  description: string;
  category?: string;
  amount: number;
  from: string;
  months: number;
  /** Per-month multiplier, for costs that grow or shrink with the operation. */
  drift?: number;
  isVariable?: boolean;
  costCenter?: string;
  supplier?: string;
};

async function writeCosts(
  db: Database,
  productId: string,
  lookups: Lookups,
  actorId: string,
  specs: CostSpec[],
) {
  const rows = specs.flatMap((spec) => {
    const entries = [];
    let amount = spec.amount;
    for (let index = 0; index < spec.months; index += 1) {
      entries.push({
        productId,
        entryTypeId: need(lookups.enums, `finance_entry_type:${spec.typeCode}`),
        category: spec.category ?? null,
        description: spec.description,
        amount: round2(amount),
        currency: "BRL",
        competenceDate: addMonthsToCompetence(spec.from, index),
        isVariable: spec.isVariable ?? (spec.typeCode === "opex" || spec.typeCode === "direct_cost"),
        recurring: spec.months > 1,
        recurrencePeriod: spec.months > 1 ? ("monthly" as const) : null,
        recurrenceEnd: spec.months > 1 ? addMonthsToCompetence(spec.from, spec.months - 1) : null,
        costCenter: spec.costCenter ?? null,
        supplier: spec.supplier ?? null,
        createdBy: actorId,
      });
      amount *= spec.drift ?? 1;
    }
    return entries;
  });

  if (rows.length > 0) await db.insert(schema.financeEntries).values(rows);
}

type TaskSpec = {
  /** Fraction of the package applied, from the first template onwards. */
  applyShare: number;
  /** How many of the applied tasks are finished, from the first onwards. */
  doneShare: number;
  /** Of the remainder, how many are in progress. */
  doingCount: number;
  /** Tasks deliberately left past their due date, counted from the first open one. */
  lateCount?: number;
};

/**
 * Applies a task package to a product and then ages it: the first tasks are
 * done, the next are in progress, the rest are waiting. That is what a real
 * board looks like, and it is what makes the S-curve and the critical path
 * show something other than a flat line.
 */
async function writeTasksFromPackage(
  db: Database,
  productId: string,
  packageId: string,
  anchors: { startDate: string; plannedLaunchDate: string | null },
  assignees: string[],
  spec: TaskSpec,
) {
  const templates = await db
    .select()
    .from(schema.taskTemplates)
    .where(eq(schema.taskTemplates.packageId, packageId));

  const dependencies = await db.select().from(schema.taskTemplateDependencies);
  const depsByTemplate = new Map<string, string[]>();
  for (const dep of dependencies) {
    const list = depsByTemplate.get(dep.templateId) ?? [];
    list.push(dep.dependsOnTemplateId);
    depsByTemplate.set(dep.templateId, list);
  }

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
      dependsOn: depsByTemplate.get(template.id) ?? [],
    })),
    anchors,
  );

  const applied = planned.slice(0, Math.max(1, Math.round(planned.length * spec.applyShare)));
  const doneCount = Math.round(applied.length * spec.doneShare);
  const lateCount = spec.lateCount ?? 0;

  const rows = applied.map((task, index) => {
    const isDone = index < doneCount;
    const isDoing = !isDone && index < doneCount + spec.doingCount;
    const isLate = !isDone && index < doneCount + lateCount;

    return {
      productId,
      name: task.name,
      description: task.description,
      categoryId: task.categoryId,
      assigneeId: assignees[index % assignees.length] ?? null,
      status: isDone ? "done" : isDoing ? "doing" : index === applied.length - 1 ? "backlog" : "todo",
      priority: task.priority,
      progress: isDone ? 100 : isDoing ? 40 + ((index * 17) % 40) : 0,
      startDate: task.startDate,
      // A late task is one whose due date has already passed while it is open.
      dueDate: isLate ? daysFromToday(-7 - index) : task.dueDate,
      doneDate: isDone ? task.dueDate : null,
      estimatedHours: task.estimatedHours,
      boardOrder: index,
      originTemplateId: task.templateId,
    };
  });

  const inserted = await db
    .insert(schema.tasks)
    .values(rows)
    .returning({ id: schema.tasks.id, originTemplateId: schema.tasks.originTemplateId });

  const taskIdByTemplate = new Map(
    inserted.filter((row) => row.originTemplateId).map((row) => [row.originTemplateId!, row.id]),
  );

  const dependencyRows = applied.flatMap((task) =>
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

  return inserted.length;
}

/* -------------------------------------------------------------------------- */
/* The products                                                                */
/* -------------------------------------------------------------------------- */

export async function seedDemoData(db: Database): Promise<void> {
  const lookups = await loadLookups(db);
  const admin = need(lookups.users, "admin");
  const marina = need(lookups.users, "marina");
  const rafael = need(lookups.users, "rafael");
  const camila = need(lookups.users, "camila");

  const launchPackage = need(lookups.packages, "Lançamento de produto SaaS");
  const discoveryPackage = need(lookups.packages, "Descoberta / validação");

  console.log("gravando produtos demonstrativos...");

  /* ---------------------------------------------------------------------- */
  /* 1. SKY-LAKE — maturidade, saudável                                      */
  /* ---------------------------------------------------------------------- */

  const [lake] = await db
    .insert(schema.products)
    .values({
      code: "SKY-LAKE",
      name: "Nimbus Data Lake",
      shortDescription:
        "Plataforma gerenciada de data lake com ingestão, catálogo e governança para clientes enterprise.",
      ownerId: marina,
      team: "Dados & Analytics",
      categoryId: need(lookups.enums, "product_category:data"),
      phase: "maturity",
      status: "active",
      startDate: monthsAgo(30),
      plannedLaunchDate: addDaysToIso(monthsAgo(24), 0),
      actualLaunchDate: addDaysToIso(monthsAgo(24), 12),
      segment: "Enterprise · varejo e indústria",
      pricingModel: "Assinatura mensal por volume ingerido, com piso contratual",
      competitors: "Databricks, Snowflake, AWS Lake Formation",
      tags: ["dados", "enterprise", "governança"],
      createdBy: admin,
    })
    .returning({ id: schema.products.id });

  const lakeId = lake!.id;

  await db.insert(schema.productPhaseHistory).values([
    { productId: lakeId, phase: "conception", startedAt: monthsAgo(30), endedAt: monthsAgo(28), changedBy: admin },
    { productId: lakeId, phase: "development", startedAt: monthsAgo(28), endedAt: monthsAgo(24), changedBy: marina },
    { productId: lakeId, phase: "launch", startedAt: monthsAgo(24), endedAt: monthsAgo(20), changedBy: marina },
    { productId: lakeId, phase: "growth", startedAt: monthsAgo(20), endedAt: monthsAgo(6), changedBy: marina },
    { productId: lakeId, phase: "maturity", startedAt: monthsAgo(6), endedAt: null, changedBy: marina },
  ]);

  const lakeSales = buildSeries({
    months: 24,
    startMrr: 62_000,
    monthlyGrowth: 1.055,
    startCustomers: 9,
    customerGrowth: 1.05,
    ticketOneTimeShare: 0.08,
    churnShare: 0.015,
  });
  await writeSales(db, lakeId, lakeSales);

  await writeCosts(db, lakeId, lookups, admin, [
    {
      typeCode: "capex",
      description: "Construção da plataforma e do catálogo de dados",
      category: "Engenharia",
      amount: 310_000,
      from: monthsAgo(28),
      months: 1,
      costCenter: "P&D",
    },
    {
      typeCode: "opex",
      description: "Infraestrutura de processamento e armazenamento",
      category: "Infraestrutura",
      amount: 21_000,
      from: monthsAgo(24),
      months: 24,
      drift: 1.02,
      supplier: "AWS",
      costCenter: "Operações",
    },
    {
      typeCode: "opex",
      description: "Squad de sustentação e evolução",
      category: "Pessoas",
      amount: 33_000,
      from: monthsAgo(24),
      months: 24,
      drift: 1.008,
      costCenter: "P&D",
    },
    {
      typeCode: "direct_cost",
      description: "Suporte dedicado aos contratos enterprise",
      category: "Suporte",
      amount: 7_000,
      from: monthsAgo(18),
      months: 18,
      drift: 1.01,
      costCenter: "Operações",
    },
  ]);

  await db.insert(schema.productGoals).values([
    {
      productId: lakeId,
      goalTypeId: need(lookups.enums, "goal_type:new_mrr"),
      targetValue: 34_000,
      unit: "R$",
      period: "quarterly",
      deadline: daysFromToday(400),
      isPrimary: true,
    },
    {
      productId: lakeId,
      goalTypeId: need(lookups.enums, "goal_type:customers"),
      targetValue: 26,
      unit: "clientes",
      period: "monthly",
      deadline: daysFromToday(190),
      isPrimary: false,
    },
    {
      productId: lakeId,
      goalTypeId: need(lookups.enums, "goal_type:nps"),
      targetValue: 60,
      unit: "pontos",
      period: "quarterly",
      deadline: daysFromToday(100),
      isPrimary: false,
    },
  ]);

  await writeTasksFromPackage(
    db,
    lakeId,
    launchPackage,
    { startDate: monthsAgo(28), plannedLaunchDate: monthsAgo(24) },
    [marina, camila, rafael],
    { applyShare: 1, doneShare: 0.9, doingCount: 1, lateCount: 1 },
  );

  await db.insert(schema.insights).values([
    {
      productId: lakeId,
      title: "Conector nativo para SAP BW",
      description:
        "Três contas enterprise pedem ingestão direta do SAP BW sem passar por arquivo intermediário.",
      originId: need(lookups.enums, "insight_origin:customer"),
      ownerId: marina,
      insightDate: daysFromToday(-40),
      status: "approved" as const,
      effort: 6,
      impact: 9,
    },
    {
      productId: lakeId,
      title: "Catálogo com busca semântica",
      description: "Encontrar tabela por descrição, não por nome técnico.",
      originId: need(lookups.enums, "insight_origin:research"),
      ownerId: marina,
      insightDate: daysFromToday(-25),
      status: "new" as const,
      effort: 8,
      impact: 7,
    },
    {
      productId: lakeId,
      title: "Alerta de custo por projeto",
      description: "Avisar o cliente quando o consumo do mês ultrapassar o piso contratado.",
      originId: need(lookups.enums, "insight_origin:support"),
      ownerId: camila,
      insightDate: daysFromToday(-12),
      status: "new" as const,
      effort: 2,
      impact: 8,
    },
    {
      productId: lakeId,
      title: "Tema escuro no portal",
      description: "Pedido recorrente, sem impacto em contrato.",
      originId: need(lookups.enums, "insight_origin:customer"),
      ownerId: camila,
      insightDate: daysFromToday(-60),
      status: "discarded" as const,
      effort: 3,
      impact: 2,
    },
    {
      productId: lakeId,
      title: "Reescrever a engine de linhagem",
      description: "Custo alto e ganho difuso — mantido no radar, sem data.",
      originId: need(lookups.enums, "insight_origin:internal"),
      ownerId: marina,
      insightDate: daysFromToday(-75),
      status: "new" as const,
      effort: 9,
      impact: 4,
    },
  ]);

  /* ---------------------------------------------------------------------- */
  /* 2. SKY-SHIELD — crescimento, ainda pagando o investimento               */
  /* ---------------------------------------------------------------------- */

  const [shield] = await db
    .insert(schema.products)
    .values({
      code: "SKY-SHIELD",
      name: "Nimbus Shield",
      shortDescription:
        "Postura de segurança em nuvem: inventário de ativos, detecção de desvio e resposta guiada.",
      ownerId: rafael,
      team: "Segurança",
      categoryId: need(lookups.enums, "product_category:security"),
      phase: "growth",
      status: "active",
      startDate: monthsAgo(20),
      plannedLaunchDate: monthsAgo(14),
      actualLaunchDate: addDaysToIso(monthsAgo(14), 26),
      segment: "Mid-market · serviços financeiros",
      pricingModel: "Assinatura por conta de nuvem monitorada",
      competitors: "Wiz, Prisma Cloud, Defender for Cloud",
      tags: ["segurança", "nuvem", "compliance"],
      createdBy: admin,
    })
    .returning({ id: schema.products.id });

  const shieldId = shield!.id;

  await db.insert(schema.productPhaseHistory).values([
    { productId: shieldId, phase: "conception", startedAt: monthsAgo(20), endedAt: monthsAgo(18), changedBy: admin },
    { productId: shieldId, phase: "development", startedAt: monthsAgo(18), endedAt: monthsAgo(13), changedBy: rafael },
    { productId: shieldId, phase: "launch", startedAt: monthsAgo(13), endedAt: monthsAgo(9), changedBy: rafael },
    { productId: shieldId, phase: "growth", startedAt: monthsAgo(9), endedAt: null, changedBy: rafael },
  ]);

  const shieldSales = buildSeries({
    months: 13,
    startMrr: 26_000,
    monthlyGrowth: 1.115,
    startCustomers: 6,
    customerGrowth: 1.1,
    ticketOneTimeShare: 0.05,
    churnShare: 0.03,
  });
  await writeSales(db, shieldId, shieldSales);

  await writeCosts(db, shieldId, lookups, admin, [
    {
      typeCode: "capex",
      description: "Desenvolvimento do motor de detecção",
      category: "Engenharia",
      amount: 265_000,
      from: monthsAgo(18),
      months: 1,
      costCenter: "P&D",
    },
    {
      typeCode: "capex",
      description: "Certificação ISO 27001 do produto",
      category: "Compliance",
      amount: 74_000,
      from: monthsAgo(12),
      months: 1,
      costCenter: "Jurídico",
    },
    {
      typeCode: "opex",
      description: "Infraestrutura de coleta e análise",
      category: "Infraestrutura",
      amount: 9_000,
      from: monthsAgo(13),
      months: 13,
      drift: 1.035,
      supplier: "Azure",
      costCenter: "Operações",
    },
    {
      typeCode: "opex",
      description: "Squad de produto",
      category: "Pessoas",
      amount: 22_000,
      from: monthsAgo(13),
      months: 13,
      drift: 1.012,
      costCenter: "P&D",
    },
    {
      typeCode: "direct_cost",
      description: "Onboarding assistido dos novos contratos",
      category: "Serviços",
      amount: 4_000,
      from: monthsAgo(9),
      months: 9,
      drift: 1.05,
      costCenter: "Operações",
    },
  ]);

  await db.insert(schema.productGoals).values([
    {
      productId: shieldId,
      goalTypeId: need(lookups.enums, "goal_type:new_mrr"),
      targetValue: 9_000,
      unit: "R$",
      period: "monthly",
      deadline: daysFromToday(330),
      isPrimary: true,
    },
    {
      productId: shieldId,
      goalTypeId: need(lookups.enums, "goal_type:customers"),
      targetValue: 40,
      unit: "clientes",
      period: "monthly",
      deadline: daysFromToday(260),
      isPrimary: false,
    },
  ]);

  await writeTasksFromPackage(
    db,
    shieldId,
    launchPackage,
    { startDate: monthsAgo(18), plannedLaunchDate: monthsAgo(14) },
    [rafael, camila],
    { applyShare: 1, doneShare: 0.8, doingCount: 1, lateCount: 1 },
  );

  await db.insert(schema.insights).values([
    {
      productId: shieldId,
      title: "Resposta automática para bucket público",
      description: "Fechar o bucket e abrir chamado, com aprovação do cliente.",
      originId: need(lookups.enums, "insight_origin:customer"),
      ownerId: rafael,
      insightDate: daysFromToday(-30),
      status: "in_progress" as const,
      effort: 4,
      impact: 9,
    },
    {
      productId: shieldId,
      title: "Relatório pronto para auditoria do Bacen",
      description: "Exportação já no formato que o regulador pede.",
      originId: need(lookups.enums, "insight_origin:sales"),
      ownerId: rafael,
      insightDate: daysFromToday(-18),
      status: "approved" as const,
      effort: 3,
      impact: 10,
    },
    {
      productId: shieldId,
      title: "Suporte a Oracle Cloud",
      description: "Um prospect grande usa OCI; ninguém mais pediu até agora.",
      originId: need(lookups.enums, "insight_origin:competition"),
      ownerId: rafael,
      insightDate: daysFromToday(-50),
      status: "new" as const,
      effort: 9,
      impact: 5,
    },
  ]);

  /* ---------------------------------------------------------------------- */
  /* 3. SKY-VM — declínio, o caso que precisa disparar "descontinuar"        */
  /* ---------------------------------------------------------------------- */

  const [vm] = await db
    .insert(schema.products)
    .values({
      code: "SKY-VM",
      name: "Nimbus VM Legado",
      shortDescription:
        "Hospedagem de máquinas virtuais em datacenter próprio, contratada antes da migração para nuvem pública.",
      ownerId: rafael,
      team: "Cloud & Infraestrutura",
      categoryId: need(lookups.enums, "product_category:cloud"),
      phase: "decline",
      status: "active",
      startDate: monthsAgo(62),
      plannedLaunchDate: monthsAgo(56),
      actualLaunchDate: monthsAgo(55),
      segment: "Mid-market · base histórica",
      pricingModel: "Contrato anual por vCPU e GB de memória",
      competitors: "AWS EC2, Azure VM, Locaweb",
      tags: ["legado", "datacenter", "sunset"],
      createdBy: admin,
    })
    .returning({ id: schema.products.id });

  const vmId = vm!.id;

  await db.insert(schema.productPhaseHistory).values([
    { productId: vmId, phase: "development", startedAt: monthsAgo(62), endedAt: monthsAgo(55), changedBy: admin },
    { productId: vmId, phase: "launch", startedAt: monthsAgo(55), endedAt: monthsAgo(50), changedBy: rafael },
    { productId: vmId, phase: "growth", startedAt: monthsAgo(50), endedAt: monthsAgo(32), changedBy: rafael },
    { productId: vmId, phase: "maturity", startedAt: monthsAgo(32), endedAt: monthsAgo(11), changedBy: rafael },
    { productId: vmId, phase: "decline", startedAt: monthsAgo(11), endedAt: null, changedBy: rafael },
  ]);

  // Falling for the whole window, and steeply for the last stretch: the
  // discontinue rule needs at least three consecutive months of decline, and
  // the projection has to stay negative on top of an already negative ROI.
  const vmSales = buildSeries({
    months: 24,
    startMrr: 186_000,
    monthlyGrowth: 0.962,
    startCustomers: 74,
    customerGrowth: 0.965,
    churnShare: 0.05,
    wobble: 0,
  });
  await writeSales(db, vmId, vmSales);

  await writeCosts(db, vmId, lookups, admin, [
    {
      typeCode: "capex",
      description: "Tentativa de replataforma do hypervisor",
      category: "Engenharia",
      amount: 380_000,
      from: monthsAgo(22),
      months: 1,
      costCenter: "P&D",
    },
    {
      typeCode: "opex",
      description: "Datacenter, energia e links dedicados",
      category: "Infraestrutura",
      amount: 96_000,
      from: monthsAgo(24),
      months: 24,
      drift: 1.006,
      supplier: "Equinix",
      costCenter: "Operações",
    },
    {
      typeCode: "opex",
      description: "Time de sustentação do legado",
      category: "Pessoas",
      amount: 58_000,
      from: monthsAgo(24),
      months: 24,
      drift: 1.004,
      costCenter: "Operações",
    },
    {
      typeCode: "indirect_cost",
      description: "Licenças de virtualização e backup",
      category: "Licenças",
      amount: 21_000,
      from: monthsAgo(24),
      months: 24,
      drift: 1.01,
      supplier: "Broadcom",
      costCenter: "Operações",
    },
  ]);

  await db.insert(schema.productGoals).values([
    {
      productId: vmId,
      goalTypeId: need(lookups.enums, "goal_type:new_mrr"),
      targetValue: 15_000,
      unit: "R$",
      period: "monthly",
      deadline: daysFromToday(45),
      isPrimary: true,
    },
    {
      productId: vmId,
      goalTypeId: need(lookups.enums, "goal_type:cost_reduction"),
      targetValue: 40_000,
      unit: "R$",
      period: "monthly",
      deadline: daysFromToday(120),
      isPrimary: false,
    },
  ]);

  await writeTasksFromPackage(
    db,
    vmId,
    launchPackage,
    { startDate: monthsAgo(22), plannedLaunchDate: monthsAgo(18) },
    [rafael, camila],
    { applyShare: 0.6, doneShare: 0.5, doingCount: 1, lateCount: 2 },
  );

  await db.insert(schema.insights).values([
    {
      productId: vmId,
      title: "Rota de migração assistida para nuvem pública",
      description:
        "Transformar a saída em oferta: migrar o cliente para o Shield/Data Lake em vez de perdê-lo.",
      originId: need(lookups.enums, "insight_origin:internal"),
      ownerId: rafael,
      insightDate: daysFromToday(-20),
      status: "approved" as const,
      effort: 5,
      impact: 9,
    },
    {
      productId: vmId,
      title: "Renegociar contrato de datacenter",
      description: "O contrato vence em seis meses e hoje é o maior item de custo.",
      originId: need(lookups.enums, "insight_origin:internal"),
      ownerId: rafael,
      insightDate: daysFromToday(-35),
      status: "in_progress" as const,
      effort: 2,
      impact: 7,
    },
  ]);

  /* ---------------------------------------------------------------------- */
  /* 4. SKY-AIOPS — pré-lançamento                                           */
  /* ---------------------------------------------------------------------- */

  const [aiops] = await db
    .insert(schema.products)
    .values({
      code: "SKY-AIOPS",
      name: "Nimbus AIOps",
      shortDescription:
        "Correlação de alertas e diagnóstico assistido por modelo de linguagem sobre a telemetria do cliente.",
      ownerId: marina,
      team: "Inteligência artificial",
      categoryId: need(lookups.enums, "product_category:ai"),
      phase: "development",
      status: "active",
      startDate: monthsAgo(8),
      plannedLaunchDate: daysFromToday(75),
      actualLaunchDate: null,
      segment: "Enterprise · operações de TI",
      pricingModel: "Assinatura por host monitorado, em definição",
      competitors: "Dynatrace Davis, New Relic AI, BigPanda",
      tags: ["ia", "observabilidade", "pré-lançamento"],
      createdBy: admin,
    })
    .returning({ id: schema.products.id });

  const aiopsId = aiops!.id;

  await db.insert(schema.productPhaseHistory).values([
    { productId: aiopsId, phase: "conception", startedAt: monthsAgo(8), endedAt: monthsAgo(5), changedBy: marina },
    { productId: aiopsId, phase: "development", startedAt: monthsAgo(5), endedAt: null, changedBy: marina },
  ]);

  await writeCosts(db, aiopsId, lookups, admin, [
    {
      typeCode: "capex",
      description: "Desenvolvimento do motor de correlação",
      category: "Engenharia",
      amount: 58_000,
      from: monthsAgo(5),
      months: 5,
      drift: 1.06,
      costCenter: "P&D",
    },
    {
      typeCode: "opex",
      description: "Inferência de modelo e ambiente de testes",
      category: "Infraestrutura",
      amount: 11_000,
      from: monthsAgo(4),
      months: 4,
      drift: 1.18,
      supplier: "Anthropic / AWS Bedrock",
      costCenter: "P&D",
    },
    {
      typeCode: "investment",
      description: "Pesquisa com clientes-piloto",
      category: "Pesquisa",
      amount: 36_000,
      from: monthsAgo(6),
      months: 1,
      costCenter: "Produto",
    },
  ]);

  await db.insert(schema.productGoals).values([
    {
      productId: aiopsId,
      goalTypeId: need(lookups.enums, "goal_type:new_mrr"),
      targetValue: 18_000,
      unit: "R$",
      period: "monthly",
      deadline: daysFromToday(260),
      isPrimary: true,
    },
    {
      productId: aiopsId,
      goalTypeId: need(lookups.enums, "goal_type:customers"),
      targetValue: 12,
      unit: "clientes",
      period: "monthly",
      deadline: daysFromToday(320),
      isPrimary: false,
    },
  ]);

  await writeTasksFromPackage(
    db,
    aiopsId,
    launchPackage,
    { startDate: monthsAgo(5), plannedLaunchDate: daysFromToday(75) },
    [marina, camila],
    { applyShare: 1, doneShare: 0.3, doingCount: 2 },
  );

  await db.insert(schema.insights).values([
    {
      productId: aiopsId,
      title: "Explicação em português do diagnóstico",
      description: "O piloto pediu o porquê em texto, não só o alerta correlacionado.",
      originId: need(lookups.enums, "insight_origin:research"),
      ownerId: marina,
      insightDate: daysFromToday(-15),
      status: "approved" as const,
      effort: 3,
      impact: 8,
    },
    {
      productId: aiopsId,
      title: "Conector para Zabbix",
      description: "Metade dos pilotos usa Zabbix como fonte de telemetria.",
      originId: need(lookups.enums, "insight_origin:customer"),
      ownerId: camila,
      insightDate: daysFromToday(-9),
      status: "new" as const,
      effort: 4,
      impact: 7,
    },
  ]);

  /* ---------------------------------------------------------------------- */
  /* 5. SKY-COPILOT — recém-criado, sem nada                                 */
  /* ---------------------------------------------------------------------- */

  const [copilot] = await db
    .insert(schema.products)
    .values({
      code: "SKY-COPILOT",
      name: "Nimbus Copilot de Integração",
      shortDescription:
        "Ideia em validação: assistente que escreve e mantém integrações entre ERPs a partir de descrição em linguagem natural.",
      ownerId: marina,
      team: "Integração",
      categoryId: need(lookups.enums, "product_category:integration"),
      phase: "conception",
      status: "active",
      startDate: daysFromToday(-9),
      plannedLaunchDate: daysFromToday(300),
      actualLaunchDate: null,
      segment: "A definir",
      pricingModel: null,
      competitors: "Workato, Tray.io, n8n",
      tags: ["ia", "integração", "descoberta"],
      createdBy: marina,
    })
    .returning({ id: schema.products.id });

  const copilotId = copilot!.id;

  await db.insert(schema.productPhaseHistory).values([
    { productId: copilotId, phase: "conception", startedAt: daysFromToday(-9), endedAt: null, changedBy: marina },
  ]);

  await db.insert(schema.productGoals).values([
    {
      productId: copilotId,
      goalTypeId: need(lookups.enums, "goal_type:new_mrr"),
      targetValue: 25_000,
      unit: "R$",
      period: "monthly",
      deadline: daysFromToday(420),
      isPrimary: true,
    },
  ]);

  await writeTasksFromPackage(
    db,
    copilotId,
    discoveryPackage,
    { startDate: daysFromToday(-9), plannedLaunchDate: daysFromToday(300) },
    [marina],
    { applyShare: 1, doneShare: 0.12, doingCount: 1 },
  );

  /* ---------------------------------------------------------------------- */
  /* Business plans                                                          */
  /* ---------------------------------------------------------------------- */

  console.log("gravando business plans...");

  // SKY-LAKE: a superseded version and the active one, so the comparison
  // between versions has something to compare.
  const [lakePlanV1] = await db
    .insert(schema.businessPlans)
    .values({
      productId: lakeId,
      version: 1,
      approvedAt: monthsAgo(24),
      authorId: marina,
      assumptions:
        "Primeira versão, aprovada no lançamento. Assumia 6 contratos novos por trimestre e ticket médio de R$ 4.500.",
      horizonMonths: 12,
      status: "superseded",
    })
    .returning({ id: schema.businessPlans.id });

  await db.insert(schema.businessPlanMonths).values(
    Array.from({ length: 12 }, (_, index) => {
      const revenue = 52_000 * 1.06 ** index;
      const cost = 70_000 * 1.01 ** index;
      return {
        planId: lakePlanV1!.id,
        competence: addMonthsToCompetence(monthsAgo(24), index),
        plannedRevenue: round2(revenue),
        plannedCost: round2(cost),
        plannedCustomers: 9 + index,
        plannedMargin: round2(revenue - cost),
      };
    }),
  );

  const [lakePlan] = await db
    .insert(schema.businessPlans)
    .values({
      productId: lakeId,
      version: 2,
      approvedAt: monthsAgo(12),
      authorId: marina,
      assumptions:
        "Revisão após o primeiro ano. Crescimento de 5% ao mês sobre a base instalada, custo de infraestrutura subindo 2% ao mês e squad estável. Não considera o conector SAP, que ainda depende de decisão.",
      horizonMonths: 18,
      status: "active",
    })
    .returning({ id: schema.businessPlans.id });

  const lakePlanId = lakePlan!.id;

  await db.insert(schema.businessPlanMonths).values(
    Array.from({ length: 18 }, (_, index) => {
      const revenue = 108_000 * 1.05 ** index;
      const cost = 82_000 * 1.017 ** index;
      return {
        planId: lakePlanId,
        competence: addMonthsToCompetence(monthsAgo(12), index),
        plannedRevenue: round2(revenue),
        plannedCost: round2(cost),
        plannedCustomers: 17 + index,
        plannedMargin: round2(revenue - cost),
      };
    }),
  );

  await db.insert(schema.milestones).values([
    {
      planId: lakePlanId,
      name: "Catálogo de dados em produção",
      targetDate: monthsAgo(8),
      acceptanceCriteria: "Todos os clientes ativos com catálogo habilitado e busca funcionando.",
      status: "done",
      doneDate: addDaysToIso(monthsAgo(8), -4),
      orderIndex: 1,
    },
    {
      planId: lakePlanId,
      name: "Certificação SOC 2 Tipo II",
      targetDate: monthsAgo(2),
      acceptanceCriteria: "Relatório emitido pelo auditor, sem exceção relevante.",
      status: "done",
      doneDate: addDaysToIso(monthsAgo(2), 9),
      orderIndex: 2,
    },
    {
      planId: lakePlanId,
      name: "Conector SAP BW disponível",
      targetDate: daysFromToday(70),
      acceptanceCriteria: "Ingestão direta validada em dois clientes, sem arquivo intermediário.",
      status: "in_progress",
      doneDate: null,
      orderIndex: 3,
    },
    {
      planId: lakePlanId,
      name: "30 contratos ativos",
      targetDate: daysFromToday(160),
      acceptanceCriteria: "30 contratos com faturamento reconhecido no mês.",
      status: "pending",
      doneDate: null,
      orderIndex: 4,
    },
  ]);

  // SKY-VM: the plan the reality broke. This is what puts the deviation
  // trigger and the action plan on screen.
  const [vmPlan] = await db
    .insert(schema.businessPlans)
    .values({
      productId: vmId,
      version: 1,
      approvedAt: monthsAgo(13),
      authorId: rafael,
      assumptions:
        "Plano de sustentação aprovado junto com a replataforma: previa estabilizar a receita em torno de R$ 150 mil e reduzir custo de datacenter em 15% no segundo semestre. A replataforma não entregou, e nenhuma das duas coisas aconteceu.",
      horizonMonths: 12,
      status: "active",
    })
    .returning({ id: schema.businessPlans.id });

  const vmPlanId = vmPlan!.id;

  await db.insert(schema.businessPlanMonths).values(
    Array.from({ length: 12 }, (_, index) => {
      const revenue = 152_000 * 0.998 ** index;
      const cost = 168_000 * 0.985 ** index;
      return {
        planId: vmPlanId,
        competence: addMonthsToCompetence(monthsAgo(12), index),
        plannedRevenue: round2(revenue),
        plannedCost: round2(cost),
        plannedCustomers: Math.max(40, 60 - index),
        plannedMargin: round2(revenue - cost),
      };
    }),
  );

  await db.insert(schema.milestones).values([
    {
      planId: vmPlanId,
      name: "Replataforma do hypervisor concluída",
      targetDate: monthsAgo(6),
      acceptanceCriteria: "100% dos hosts migrados para a nova versão, sem janela de indisponibilidade.",
      status: "pending",
      doneDate: null,
      orderIndex: 1,
    },
    {
      planId: vmPlanId,
      name: "Renegociação do contrato de datacenter",
      targetDate: daysFromToday(40),
      acceptanceCriteria: "Contrato assinado com redução mínima de 15% no custo mensal.",
      status: "in_progress",
      doneDate: null,
      orderIndex: 2,
    },
  ]);

  await db.insert(schema.actionPlans).values([
    {
      productId: vmId,
      planId: vmPlanId,
      name: "Conter o churn da base de contratos anuais",
      description:
        "Contato ativo com os 12 maiores contratos antes da renovação, com proposta de migração assistida para a nuvem pública.",
      rootCause:
        "A replataforma atrasou, os clientes perceberam a estagnação do produto e passaram a avaliar alternativas na renovação.",
      ownerId: rafael,
      dueDate: daysFromToday(-12),
      status: "in_progress",
      expectedResult: "Reduzir o churn mensal de 5% para 2% em três meses.",
      actualResult: null,
      triggerCompetence: monthsAgo(4),
      triggerDeviation: -21.4,
    },
    {
      productId: vmId,
      planId: vmPlanId,
      name: "Cortar custo fixo de datacenter",
      description:
        "Consolidar racks, desligar o ambiente de contingência ocioso e renegociar o contrato de licenças.",
      rootCause: "Custo fixo dimensionado para uma base 40% maior do que a atual.",
      ownerId: rafael,
      dueDate: daysFromToday(55),
      status: "pending",
      expectedResult: "Reduzir R$ 40 mil por mês no custo de operação.",
      actualResult: null,
      triggerCompetence: monthsAgo(2),
      triggerDeviation: -18.9,
    },
  ]);

  // SKY-SHIELD: a plan being met, so the comparison is not all red.
  const [shieldPlan] = await db
    .insert(schema.businessPlans)
    .values({
      productId: shieldId,
      version: 1,
      approvedAt: monthsAgo(13),
      authorId: rafael,
      assumptions:
        "Crescimento de 10% ao mês sobre a base, custo de infraestrutura acompanhando o volume monitorado e squad estável até o fim do horizonte.",
      horizonMonths: 18,
      status: "active",
    })
    .returning({ id: schema.businessPlans.id });

  await db.insert(schema.businessPlanMonths).values(
    Array.from({ length: 18 }, (_, index) => {
      const revenue = 23_000 * 1.1 ** index;
      const cost = 48_000 * 1.02 ** index;
      return {
        planId: shieldPlan!.id,
        competence: addMonthsToCompetence(monthsAgo(13), index),
        plannedRevenue: round2(revenue),
        plannedCost: round2(cost),
        plannedCustomers: 6 + index * 2,
        plannedMargin: round2(revenue - cost),
      };
    }),
  );

  await db.insert(schema.milestones).values([
    {
      planId: shieldPlan!.id,
      name: "ISO 27001 do produto",
      targetDate: monthsAgo(4),
      acceptanceCriteria: "Certificado emitido e publicado no portal de confiança.",
      status: "done",
      doneDate: addDaysToIso(monthsAgo(4), -11),
      orderIndex: 1,
    },
    {
      planId: shieldPlan!.id,
      name: "Resposta automática em disponibilidade geral",
      targetDate: daysFromToday(50),
      acceptanceCriteria: "Três ações de resposta disponíveis para todos os clientes.",
      status: "in_progress",
      doneDate: null,
      orderIndex: 2,
    },
  ]);

  // SKY-AIOPS: a draft plan, because the product has not launched.
  const [aiopsPlan] = await db
    .insert(schema.businessPlans)
    .values({
      productId: aiopsId,
      version: 1,
      approvedAt: null,
      authorId: marina,
      assumptions:
        "Rascunho para o comitê: assume lançamento no trimestre que vem, 4 clientes-piloto convertidos e custo de inferência caindo 8% ao mês com cache de contexto.",
      horizonMonths: 12,
      status: "draft",
    })
    .returning({ id: schema.businessPlans.id });

  await db.insert(schema.businessPlanMonths).values(
    Array.from({ length: 12 }, (_, index) => {
      const revenue = index < 2 ? 0 : 14_000 * 1.22 ** (index - 2);
      const cost = 39_000 * 1.03 ** index;
      return {
        planId: aiopsPlan!.id,
        competence: addMonthsToCompetence(THIS_MONTH, index),
        plannedRevenue: round2(revenue),
        plannedCost: round2(cost),
        plannedCustomers: index < 2 ? 0 : index,
        plannedMargin: round2(revenue - cost),
      };
    }),
  );

  await db.insert(schema.milestones).values([
    {
      planId: aiopsPlan!.id,
      name: "Piloto fechado com 3 clientes",
      targetDate: daysFromToday(20),
      acceptanceCriteria: "Três contratos de piloto assinados, com telemetria conectada.",
      status: "in_progress",
      doneDate: null,
      orderIndex: 1,
    },
    {
      planId: aiopsPlan!.id,
      name: "Go-live comercial",
      targetDate: daysFromToday(75),
      acceptanceCriteria: "Produto disponível para contratação, com preço publicado.",
      status: "pending",
      doneDate: null,
      orderIndex: 2,
    },
  ]);

  /* ---------------------------------------------------------------------- */
  /* Decisions already recorded                                             */
  /* ---------------------------------------------------------------------- */

  await db.insert(schema.productDecisions).values([
    {
      productId: vmId,
      recommended: "watch",
      outcome: "rejected",
      justification:
        "O comitê optou por seguir com a replataforma em vez de apenas observar, apostando que a nova versão do hypervisor recuperaria a base. A aposta não se confirmou e o custo entrou como CAPEX no mesmo trimestre.",
      metricsSnapshot: { health: 58, roi: -4.2, decliningMonths: 2 },
      decidedBy: admin,
    },
    {
      productId: lakeId,
      recommended: "scale",
      outcome: "accepted",
      justification:
        "Aprovado o aumento de investimento em squad, condicionado à manutenção da margem de contribuição acima de 35% da receita.",
      metricsSnapshot: { health: 81, roi: 44.5, momGrowth: 5.2 },
      decidedBy: admin,
    },
  ]);

  /* ---------------------------------------------------------------------- */
  /* Comments — the input for the suggestion engine                          */
  /* ---------------------------------------------------------------------- */

  console.log("gravando comentários...");

  const risk = need(lookups.enums, "comment_category:risk");
  const opportunity = need(lookups.enums, "comment_category:opportunity");
  const feedback = need(lookups.enums, "comment_category:customer_feedback");
  const operational = need(lookups.enums, "comment_category:operational");
  const competition = need(lookups.enums, "comment_category:competition");

  await db.insert(schema.productComments).values([
    // Theme: SAP integration is slow (crosses two products, trending up).
    {
      productId: lakeId,
      authorId: marina,
      categoryId: risk,
      body: "A integração com SAP está lenta e trava nos relatórios grandes do fechamento.",
      commentDate: daysFromToday(-52),
    },
    {
      productId: lakeId,
      authorId: camila,
      categoryId: feedback,
      body: "Cliente reclamou de lentidão na integração SAP outra vez, agora no relatório consolidado.",
      commentDate: daysFromToday(-21),
    },
    {
      productId: lakeId,
      authorId: marina,
      categoryId: risk,
      body: "A integração SAP demora para sincronizar e derruba o relatório noturno.",
      commentDate: daysFromToday(-6),
    },

    // Theme: spreadsheet export (opportunity, two products).
    {
      productId: lakeId,
      authorId: camila,
      categoryId: opportunity,
      body: "Pediram exportação em planilha para o financeiro fechar o mês sem retrabalho.",
      commentDate: daysFromToday(-28),
    },
    {
      productId: shieldId,
      authorId: rafael,
      categoryId: opportunity,
      body: "Novo pedido de exportação em planilha, agora do financeiro de uma conta grande.",
      commentDate: daysFromToday(-11),
    },

    // Theme: legacy maintenance cost (risk, SKY-VM).
    {
      productId: vmId,
      authorId: rafael,
      categoryId: risk,
      body: "Manutenção do legado consumindo orçamento caro sem receita que justifique.",
      commentDate: daysFromToday(-40),
    },
    {
      productId: vmId,
      authorId: rafael,
      categoryId: risk,
      body: "Custo de manutenção do legado alto para a receita que ele ainda gera.",
      commentDate: daysFromToday(-13),
    },

    // Theme: audit report (opportunity, Shield).
    {
      productId: shieldId,
      authorId: rafael,
      categoryId: opportunity,
      body: "Prospect pediu relatório de auditoria no formato do regulador para fechar o contrato.",
      commentDate: daysFromToday(-24),
    },
    {
      productId: shieldId,
      authorId: camila,
      categoryId: feedback,
      body: "Outro cliente pediu relatório de auditoria pronto, hoje montam na mão toda vez.",
      commentDate: daysFromToday(-8),
    },

    // Singles: real context, below the frequency threshold on purpose.
    {
      productId: vmId,
      authorId: camila,
      categoryId: operational,
      body: "Janela de manutenção do datacenter remarcada duas vezes no mês passado.",
      commentDate: daysFromToday(-17),
    },
    {
      productId: shieldId,
      authorId: rafael,
      categoryId: competition,
      body: "Wiz baixou preço no mid-market e apareceu em duas concorrências nossas.",
      commentDate: daysFromToday(-33),
    },
    {
      productId: aiopsId,
      authorId: marina,
      categoryId: feedback,
      body: "Piloto elogiou o diagnóstico, mas quer ver o raciocínio antes de confiar na ação sugerida.",
      commentDate: daysFromToday(-14),
    },
  ]);

  const counts = {
    produtos: 5,
    vendas: lakeSales.length + shieldSales.length + vmSales.length,
  };
  console.log(
    `dados demonstrativos: ${counts.produtos} produtos, ${counts.vendas} meses de venda, planos, tarefas, insights e comentários.`,
  );
}
