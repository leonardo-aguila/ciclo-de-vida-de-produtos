/**
 * Database schema.
 *
 * Conventions:
 * - Table and column names are snake_case English; the UI translates to pt-BR.
 * - Money is `numeric(14,2)` read as a JS number: exact in the database, cheap
 *   to compute with in the engine. Never `float`.
 * - Competence and deadlines are `date` read as "YYYY-MM-DD" strings, because a
 *   competence is a month, not an instant. Audit times are `timestamptz`.
 * - Fixed domains are pg enums. Domains the user administers live in
 *   `enum_values` instead, so they can be renamed without a migration.
 */
import { relations, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------- */
/* Fixed domains                                                              */
/* -------------------------------------------------------------------------- */

export const userRole = pgEnum("user_role", [
  "admin",
  "product_manager",
  "collaborator",
  "executive",
]);

export const lifecyclePhase = pgEnum("lifecycle_phase", [
  "conception",
  "development",
  "launch",
  "growth",
  "maturity",
  "decline",
  "discontinued",
]);

export const productStatus = pgEnum("product_status", ["active", "paused", "discontinued"]);

export const goalPeriod = pgEnum("goal_period", ["monthly", "quarterly", "annual"]);

export const taskPriority = pgEnum("task_priority", ["low", "medium", "high", "critical"]);

export const insightStatus = pgEnum("insight_status", [
  "new",
  "under_analysis",
  "approved",
  "in_progress",
  "done",
  "discarded",
]);

export const recurrencePeriod = pgEnum("recurrence_period", ["monthly", "quarterly", "annual"]);

export const taskAnchor = pgEnum("task_anchor", ["start_date", "planned_launch_date"]);

export const businessPlanStatus = pgEnum("business_plan_status", [
  "draft",
  "active",
  "superseded",
]);

export const milestoneStatus = pgEnum("milestone_status", ["pending", "in_progress", "done"]);

export const actionPlanStatus = pgEnum("action_plan_status", [
  "pending",
  "in_progress",
  "done",
  "cancelled",
]);

export const recommendationKind = pgEnum("recommendation_kind", [
  "scale",
  "keep",
  "watch",
  "pivot",
  "discontinue",
]);

export const decisionOutcome = pgEnum("decision_outcome", ["accepted", "rejected"]);

export const auditAction = pgEnum("audit_action", ["create", "update", "delete"]);

export const salesSource = pgEnum("sales_source", ["manual", "csv"]);

/** Domains the user administers on the settings page. */
export const enumKind = pgEnum("enum_kind", [
  "goal_type",
  "task_category",
  "kanban_column",
  "finance_entry_type",
  "comment_category",
  "product_category",
  "insight_origin",
]);

/* -------------------------------------------------------------------------- */
/* Access and governance                                                      */
/* -------------------------------------------------------------------------- */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    login: text("login").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRole("role").notNull().default("collaborator"),
    active: boolean("active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_login_key").on(sql`lower(${t.login})`),
    uniqueIndex("users_email_key").on(sql`lower(${t.email})`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_key").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
);

/** Every login attempt, successful or not. */
export const accessLogs = pgTable(
  "access_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    loginAttempted: text("login_attempted").notNull(),
    success: boolean("success").notNull(),
    reason: text("reason"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("access_logs_created_idx").on(t.createdAt)],
);

/**
 * Append-only audit trail: one row per changed field.
 * The application role has no UPDATE/DELETE grant here (scripts/grant-app.sql).
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    productId: uuid("product_id"),
    action: auditAction("action").notNull(),
    field: text("field"),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_product_idx").on(t.productId, t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

export type HealthWeights = {
  goal: number;
  financial: number;
  execution: number;
  businessPlan: number;
  risk: number;
};

export type SemaphoreThresholds = { green: number; amber: number };

export type RecommendationRules = {
  scale: { minHealth: number; minRoi: number; minMomGrowth: number };
  keep: { minHealth: number; maxHealth: number; minProjectedRoi: number };
  watch: { minHealth: number; maxHealth: number };
  pivot: { minNegativeMarginMonths: number };
  discontinue: { maxRoi: number; maxProjectedRoi: number; minDecliningMonths: number };
};

export type ProjectionSettings = { windowMonths: number; horizonMonths: number };

export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  healthWeights: jsonb("health_weights").$type<HealthWeights>().notNull(),
  semaphoreThresholds: jsonb("semaphore_thresholds").$type<SemaphoreThresholds>().notNull(),
  recommendationRules: jsonb("recommendation_rules").$type<RecommendationRules>().notNull(),
  projectionSettings: jsonb("projection_settings").$type<ProjectionSettings>().notNull(),
  /** Accumulated business-plan deviation that triggers an action plan, e.g. -15. */
  bpDeviationLimit: numeric("bp_deviation_limit", { precision: 6, scale: 2, mode: "number" })
    .notNull()
    .default(-15),
  defaultCurrency: text("default_currency").notNull().default("BRL"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
});

/**
 * User-administered domains. `meta` carries kind-specific flags, e.g.
 * `{ isDone: true }` on a kanban column, `{ isVariable: true }` on a finance type.
 */
export const enumValues = pgTable(
  "enum_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: enumKind("kind").notNull(),
    code: text("code").notNull(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    color: text("color"),
    active: boolean("active").notNull().default(true),
    /** System values cannot be deleted, only renamed or deactivated. */
    isSystem: boolean("is_system").notNull().default(false),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("enum_values_kind_code_key").on(t.kind, t.code)],
);

/* -------------------------------------------------------------------------- */
/* Product                                                                    */
/* -------------------------------------------------------------------------- */

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    shortDescription: text("short_description"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    team: text("team"),
    categoryId: uuid("category_id").references(() => enumValues.id, { onDelete: "set null" }),
    phase: lifecyclePhase("phase").notNull().default("conception"),
    status: productStatus("status").notNull().default("active"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    plannedLaunchDate: date("planned_launch_date", { mode: "string" }),
    actualLaunchDate: date("actual_launch_date", { mode: "string" }),
    segment: text("segment"),
    pricingModel: text("pricing_model"),
    competitors: text("competitors"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("products_code_key").on(sql`lower(${t.code})`),
    index("products_owner_idx").on(t.ownerId),
    index("products_phase_idx").on(t.phase),
  ],
);

/** Feeds the "time in each phase" timeline and the portfolio average. */
export const productPhaseHistory = pgTable(
  "product_phase_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    phase: lifecyclePhase("phase").notNull(),
    startedAt: date("started_at", { mode: "string" }).notNull(),
    endedAt: date("ended_at", { mode: "string" }),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("phase_history_product_idx").on(t.productId, t.startedAt)],
);

export const productGoals = pgTable(
  "product_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    goalTypeId: uuid("goal_type_id")
      .notNull()
      .references(() => enumValues.id, { onDelete: "restrict" }),
    targetValue: numeric("target_value", { precision: 14, scale: 2, mode: "number" }).notNull(),
    unit: text("unit"),
    period: goalPeriod("period").notNull().default("monthly"),
    deadline: date("deadline", { mode: "string" }),
    /** Exactly one primary goal per product; it drives the executive dashboard. */
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("product_goals_product_idx").on(t.productId),
    uniqueIndex("product_goals_one_primary")
      .on(t.productId)
      .where(sql`${t.isPrimary}`),
  ],
);

/**
 * A apuração manual de uma meta, uma por competência.
 *
 * Existe para os tipos de meta que a aplicação não sabe derivar sozinha. Novo
 * MRR, ARR, receita única, nº de clientes e redução de custo saem das vendas
 * mensais e dos lançamentos — para esses, digitar o realizado seria criar uma
 * segunda fonte que contradiz a primeira. NPS, market share, adoção e
 * qualquer tipo que o administrador cadastre depois não têm de onde sair, e
 * até aqui ficavam para sempre em "não medido": a meta podia ser criada e
 * nunca apurada.
 *
 * Uma linha por mês, e não um campo "realizado" na meta, porque a pergunta
 * que importa é a série — se o NPS subiu ou caiu — e um campo único só
 * guardaria a última resposta, apagando a anterior sem deixar rastro.
 */
export const goalMeasurements = pgTable(
  "goal_measurements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => productGoals.id, { onDelete: "cascade" }),
    competence: date("competence", { mode: "string" }).notNull(),
    value: numeric("value", { precision: 14, scale: 2, mode: "number" }).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("goal_measurements_competence").on(t.goalId, t.competence),
    index("goal_measurements_goal_idx").on(t.goalId, t.competence),
  ],
);

/** The user's decision on a recommendation, with the numbers that supported it. */
export const productDecisions = pgTable(
  "product_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    recommended: recommendationKind("recommended").notNull(),
    outcome: decisionOutcome("outcome").notNull(),
    justification: text("justification").notNull(),
    metricsSnapshot: jsonb("metrics_snapshot").$type<Record<string, unknown>>(),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("product_decisions_product_idx").on(t.productId, t.createdAt)],
);

export const productComments = pgTable(
  "product_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    categoryId: uuid("category_id").references(() => enumValues.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    commentDate: date("comment_date", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("product_comments_product_idx").on(t.productId, t.commentDate)],
);

/* -------------------------------------------------------------------------- */
/* Task packages (templates)                                                  */
/* -------------------------------------------------------------------------- */

export const taskPackages = pgTable("task_packages", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  targetPhase: lifecyclePhase("target_phase"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const taskTemplates = pgTable(
  "task_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    packageId: uuid("package_id")
      .notNull()
      .references(() => taskPackages.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    categoryId: uuid("category_id").references(() => enumValues.id, { onDelete: "set null" }),
    defaultAssigneeId: uuid("default_assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    priority: taskPriority("priority").notNull().default("medium"),
    initialStatus: text("initial_status").notNull().default("backlog"),
    estimatedHours: numeric("estimated_hours", { precision: 8, scale: 2, mode: "number" }),
    /** Offsets are counted in days from this anchor date on the product. */
    anchor: taskAnchor("anchor").notNull().default("start_date"),
    startOffsetDays: integer("start_offset_days").notNull().default(0),
    endOffsetDays: integer("end_offset_days").notNull().default(7),
    orderIndex: integer("order_index").notNull().default(0),
    parentTemplateId: uuid("parent_template_id").references((): AnyPgColumn => taskTemplates.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("task_templates_package_idx").on(t.packageId, t.orderIndex)],
);

export const taskTemplateDependencies = pgTable(
  "task_template_dependencies",
  {
    templateId: uuid("template_id")
      .notNull()
      .references(() => taskTemplates.id, { onDelete: "cascade" }),
    dependsOnTemplateId: uuid("depends_on_template_id")
      .notNull()
      .references(() => taskTemplates.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.dependsOnTemplateId] })],
);

/* -------------------------------------------------------------------------- */
/* Tasks                                                                      */
/* -------------------------------------------------------------------------- */

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    categoryId: uuid("category_id").references(() => enumValues.id, { onDelete: "set null" }),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    /** Matches an `enum_values` row of kind `kanban_column` by code. */
    status: text("status").notNull().default("backlog"),
    priority: taskPriority("priority").notNull().default("medium"),
    progress: integer("progress").notNull().default(0),
    startDate: date("start_date", { mode: "string" }),
    dueDate: date("due_date", { mode: "string" }),
    doneDate: date("done_date", { mode: "string" }),
    estimatedHours: numeric("estimated_hours", { precision: 8, scale: 2, mode: "number" }),
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "set null",
    }),
    /** Position inside its kanban column. */
    boardOrder: integer("board_order").notNull().default(0),
    originInsightId: uuid("origin_insight_id"),  // no FK: an insight may be deleted after conversion
    originTemplateId: uuid("origin_template_id").references(() => taskTemplates.id, {
      onDelete: "set null",
    }),
    isMilestone: boolean("is_milestone").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tasks_product_idx").on(t.productId),
    index("tasks_assignee_idx").on(t.assigneeId),
    index("tasks_status_idx").on(t.productId, t.status, t.boardOrder),
  ],
);

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnTaskId: uuid("depends_on_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.dependsOnTaskId] })],
);

export const taskComments = pgTable(
  "task_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("task_comments_task_idx").on(t.taskId)],
);

export const taskAttachments = pgTable(
  "task_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    url: text("url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("task_attachments_task_idx").on(t.taskId)],
);

/* -------------------------------------------------------------------------- */
/* Insights                                                                   */
/* -------------------------------------------------------------------------- */

export const insights = pgTable(
  "insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    originId: uuid("origin_id").references(() => enumValues.id, { onDelete: "set null" }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    insightDate: date("insight_date", { mode: "string" }).notNull(),
    status: insightStatus("status").notNull().default("new"),
    /** 1..10 each; score = impact / effort, computed in the engine. */
    effort: integer("effort").notNull(),
    impact: integer("impact").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("insights_product_idx").on(t.productId, t.status)],
);

/* -------------------------------------------------------------------------- */
/* Finance                                                                    */
/* -------------------------------------------------------------------------- */

export const financeEntries = pgTable(
  "finance_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    entryTypeId: uuid("entry_type_id")
      .notNull()
      .references(() => enumValues.id, { onDelete: "restrict" }),
    category: text("category"),
    description: text("description").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    currency: text("currency").notNull().default("BRL"),
    competenceDate: date("competence_date", { mode: "string" }).notNull(),
    /** Variable costs are the ones subtracted in the contribution margin. */
    isVariable: boolean("is_variable").notNull().default(false),
    recurring: boolean("recurring").notNull().default(false),
    recurrencePeriod: recurrencePeriod("recurrence_period"),
    recurrenceEnd: date("recurrence_end", { mode: "string" }),
    /** Set on installments generated from a recurring parent entry. */
    parentEntryId: uuid("parent_entry_id").references((): AnyPgColumn => financeEntries.id, {
      onDelete: "cascade",
    }),
    costCenter: text("cost_center"),
    supplier: text("supplier"),
    receiptUrl: text("receipt_url"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Soft delete: the audit trail must keep pointing at a row that exists. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("finance_entries_product_idx").on(t.productId, t.competenceDate),
    index("finance_entries_parent_idx").on(t.parentEntryId),
  ],
);

export const monthlySales = pgTable(
  "monthly_sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Always the first day of the month. */
    competence: date("competence", { mode: "string" }).notNull(),
    newMrr: numeric("new_mrr", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    recurringRevenue: numeric("recurring_revenue", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    oneTimeRevenue: numeric("one_time_revenue", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    churnAmount: numeric("churn_amount", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    churnRate: numeric("churn_rate", { precision: 6, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    newCustomers: integer("new_customers").notNull().default(0),
    activeCustomers: integer("active_customers").notNull().default(0),
    churnedCustomers: integer("churned_customers").notNull().default(0),
    avgTicket: numeric("avg_ticket", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    source: salesSource("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("monthly_sales_product_competence_key").on(t.productId, t.competence)],
);

/* -------------------------------------------------------------------------- */
/* Business plan                                                              */
/* -------------------------------------------------------------------------- */

export const businessPlans = pgTable(
  "business_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    approvedAt: date("approved_at", { mode: "string" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    assumptions: text("assumptions"),
    horizonMonths: integer("horizon_months").notNull().default(12),
    status: businessPlanStatus("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("business_plans_product_version_key").on(t.productId, t.version)],
);

export const businessPlanMonths = pgTable(
  "business_plan_months",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => businessPlans.id, { onDelete: "cascade" }),
    competence: date("competence", { mode: "string" }).notNull(),
    plannedRevenue: numeric("planned_revenue", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    plannedCost: numeric("planned_cost", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    plannedCustomers: integer("planned_customers").notNull().default(0),
    plannedMargin: numeric("planned_margin", { precision: 14, scale: 2, mode: "number" })
      .notNull()
      .default(0),
  },
  (t) => [uniqueIndex("business_plan_months_key").on(t.planId, t.competence)],
);

export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => businessPlans.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    targetDate: date("target_date", { mode: "string" }).notNull(),
    acceptanceCriteria: text("acceptance_criteria"),
    status: milestoneStatus("status").notNull().default("pending"),
    doneDate: date("done_date", { mode: "string" }),
    orderIndex: integer("order_index").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("milestones_plan_idx").on(t.planId, t.targetDate)],
);

export const actionPlans = pgTable(
  "action_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").references(() => businessPlans.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    rootCause: text("root_cause"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    status: actionPlanStatus("status").notNull().default("pending"),
    expectedResult: text("expected_result"),
    actualResult: text("actual_result"),
    /** The deviation that triggered this plan, kept for traceability. */
    triggerCompetence: date("trigger_competence", { mode: "string" }),
    triggerDeviation: numeric("trigger_deviation", { precision: 8, scale: 2, mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("action_plans_product_idx").on(t.productId, t.status)],
);

/* -------------------------------------------------------------------------- */
/* Health snapshots                                                           */
/* -------------------------------------------------------------------------- */

export type HealthComponents = {
  goal: { raw: number; weighted: number; weight: number; detail: string };
  financial: { raw: number; weighted: number; weight: number; detail: string };
  execution: { raw: number; weighted: number; weight: number; detail: string };
  businessPlan: { raw: number; weighted: number; weight: number; detail: string };
  risk: { raw: number; weighted: number; weight: number; detail: string };
};

/** One row per product per month: what makes "vs. last month" possible. */
export const healthSnapshots = pgTable(
  "health_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    competence: date("competence", { mode: "string" }).notNull(),
    score: numeric("score", { precision: 6, scale: 2, mode: "number" }).notNull(),
    components: jsonb("components").$type<HealthComponents>().notNull(),
    roi: numeric("roi", { precision: 10, scale: 2, mode: "number" }),
    projectedRoi: numeric("projected_roi", { precision: 10, scale: 2, mode: "number" }),
    accumulatedRevenue: numeric("accumulated_revenue", {
      precision: 14,
      scale: 2,
      mode: "number",
    }).notNull(),
    accumulatedCost: numeric("accumulated_cost", {
      precision: 14,
      scale: 2,
      mode: "number",
    }).notNull(),
    recommendation: recommendationKind("recommendation"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("health_snapshots_product_competence_key").on(t.productId, t.competence)],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                  */
/* -------------------------------------------------------------------------- */

export const usersRelations = relations(users, ({ many }) => ({
  ownedProducts: many(products),
  sessions: many(sessions),
  assignedTasks: many(tasks),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  owner: one(users, { fields: [products.ownerId], references: [users.id] }),
  category: one(enumValues, { fields: [products.categoryId], references: [enumValues.id] }),
  goals: many(productGoals),
  tasks: many(tasks),
  insights: many(insights),
  financeEntries: many(financeEntries),
  sales: many(monthlySales),
  plans: many(businessPlans),
  comments: many(productComments),
  decisions: many(productDecisions),
  phaseHistory: many(productPhaseHistory),
  actionPlans: many(actionPlans),
  snapshots: many(healthSnapshots),
}));

export const productGoalsRelations = relations(productGoals, ({ one, many }) => ({
  product: one(products, { fields: [productGoals.productId], references: [products.id] }),
  goalType: one(enumValues, { fields: [productGoals.goalTypeId], references: [enumValues.id] }),
  measurements: many(goalMeasurements),
}));

export const goalMeasurementsRelations = relations(goalMeasurements, ({ one }) => ({
  goal: one(productGoals, {
    fields: [goalMeasurements.goalId],
    references: [productGoals.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  product: one(products, { fields: [tasks.productId], references: [products.id] }),
  assignee: one(users, { fields: [tasks.assigneeId], references: [users.id] }),
  category: one(enumValues, { fields: [tasks.categoryId], references: [enumValues.id] }),
  comments: many(taskComments),
  attachments: many(taskAttachments),
}));

export const insightsRelations = relations(insights, ({ one }) => ({
  product: one(products, { fields: [insights.productId], references: [products.id] }),
  origin: one(enumValues, { fields: [insights.originId], references: [enumValues.id] }),
  owner: one(users, { fields: [insights.ownerId], references: [users.id] }),
}));

export const financeEntriesRelations = relations(financeEntries, ({ one }) => ({
  product: one(products, { fields: [financeEntries.productId], references: [products.id] }),
  entryType: one(enumValues, {
    fields: [financeEntries.entryTypeId],
    references: [enumValues.id],
  }),
}));

export const businessPlansRelations = relations(businessPlans, ({ one, many }) => ({
  product: one(products, { fields: [businessPlans.productId], references: [products.id] }),
  months: many(businessPlanMonths),
  milestones: many(milestones),
}));

export const productCommentsRelations = relations(productComments, ({ one }) => ({
  product: one(products, { fields: [productComments.productId], references: [products.id] }),
  author: one(users, { fields: [productComments.authorId], references: [users.id] }),
  category: one(enumValues, { fields: [productComments.categoryId], references: [enumValues.id] }),
}));

/* -------------------------------------------------------------------------- */
/* Inferred types                                                             */
/* -------------------------------------------------------------------------- */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type EnumValue = typeof enumValues.$inferSelect;
export type AppSettings = typeof appSettings.$inferSelect;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductGoal = typeof productGoals.$inferSelect;
export type ProductComment = typeof productComments.$inferSelect;
export type ProductDecision = typeof productDecisions.$inferSelect;
export type PhaseHistoryRow = typeof productPhaseHistory.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskPackage = typeof taskPackages.$inferSelect;
export type TaskTemplate = typeof taskTemplates.$inferSelect;
export type Insight = typeof insights.$inferSelect;
export type FinanceEntry = typeof financeEntries.$inferSelect;
export type MonthlySale = typeof monthlySales.$inferSelect;
export type BusinessPlan = typeof businessPlans.$inferSelect;
export type BusinessPlanMonth = typeof businessPlanMonths.$inferSelect;
export type Milestone = typeof milestones.$inferSelect;
export type ActionPlan = typeof actionPlans.$inferSelect;
export type HealthSnapshot = typeof healthSnapshots.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type AccessLog = typeof accessLogs.$inferSelect;

export type LifecyclePhase = (typeof lifecyclePhase.enumValues)[number];
export type ProductStatusValue = (typeof productStatus.enumValues)[number];
export type UserRole = (typeof userRole.enumValues)[number];
export type TaskPriorityValue = (typeof taskPriority.enumValues)[number];
export type InsightStatusValue = (typeof insightStatus.enumValues)[number];
export type RecommendationValue = (typeof recommendationKind.enumValues)[number];
export type EnumKind = (typeof enumKind.enumValues)[number];
