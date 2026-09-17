CREATE TYPE "public"."action_plan_status" AS ENUM('pending', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."business_plan_status" AS ENUM('draft', 'active', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."decision_outcome" AS ENUM('accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."enum_kind" AS ENUM('goal_type', 'task_category', 'kanban_column', 'finance_entry_type', 'comment_category', 'product_category', 'insight_origin');--> statement-breakpoint
CREATE TYPE "public"."goal_period" AS ENUM('monthly', 'quarterly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."insight_status" AS ENUM('new', 'under_analysis', 'approved', 'in_progress', 'done', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_phase" AS ENUM('conception', 'development', 'launch', 'growth', 'maturity', 'decline', 'discontinued');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('pending', 'in_progress', 'done');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('active', 'paused', 'discontinued');--> statement-breakpoint
CREATE TYPE "public"."recommendation_kind" AS ENUM('scale', 'keep', 'watch', 'pivot', 'discontinue');--> statement-breakpoint
CREATE TYPE "public"."recurrence_period" AS ENUM('monthly', 'quarterly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."sales_source" AS ENUM('manual', 'csv');--> statement-breakpoint
CREATE TYPE "public"."task_anchor" AS ENUM('start_date', 'planned_launch_date');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'product_manager', 'collaborator', 'executive');--> statement-breakpoint
CREATE TABLE "access_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"login_attempted" text NOT NULL,
	"success" boolean NOT NULL,
	"reason" text,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"plan_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"root_cause" text,
	"owner_id" uuid,
	"due_date" date NOT NULL,
	"status" "action_plan_status" DEFAULT 'pending' NOT NULL,
	"expected_result" text,
	"actual_result" text,
	"trigger_competence" date,
	"trigger_deviation" numeric(8, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"health_weights" jsonb NOT NULL,
	"semaphore_thresholds" jsonb NOT NULL,
	"recommendation_rules" jsonb NOT NULL,
	"projection_settings" jsonb NOT NULL,
	"bp_deviation_limit" numeric(6, 2) DEFAULT -15 NOT NULL,
	"default_currency" text DEFAULT 'BRL' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"product_id" uuid,
	"action" "audit_action" NOT NULL,
	"field" text,
	"old_value" text,
	"new_value" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_plan_months" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"competence" date NOT NULL,
	"planned_revenue" numeric(14, 2) DEFAULT 0 NOT NULL,
	"planned_cost" numeric(14, 2) DEFAULT 0 NOT NULL,
	"planned_customers" integer DEFAULT 0 NOT NULL,
	"planned_margin" numeric(14, 2) DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"approved_at" date,
	"author_id" uuid,
	"assumptions" text,
	"horizon_months" integer DEFAULT 12 NOT NULL,
	"status" "business_plan_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enum_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "enum_kind" NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"color" text,
	"active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"entry_type_id" uuid NOT NULL,
	"category" text,
	"description" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"competence_date" date NOT NULL,
	"is_variable" boolean DEFAULT false NOT NULL,
	"recurring" boolean DEFAULT false NOT NULL,
	"recurrence_period" "recurrence_period",
	"recurrence_end" date,
	"parent_entry_id" uuid,
	"cost_center" text,
	"supplier" text,
	"receipt_url" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "health_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"competence" date NOT NULL,
	"score" numeric(6, 2) NOT NULL,
	"components" jsonb NOT NULL,
	"roi" numeric(10, 2),
	"projected_roi" numeric(10, 2),
	"accumulated_revenue" numeric(14, 2) NOT NULL,
	"accumulated_cost" numeric(14, 2) NOT NULL,
	"recommendation" "recommendation_kind",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"origin_id" uuid,
	"owner_id" uuid,
	"insight_date" date NOT NULL,
	"status" "insight_status" DEFAULT 'new' NOT NULL,
	"effort" integer NOT NULL,
	"impact" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_date" date NOT NULL,
	"acceptance_criteria" text,
	"status" "milestone_status" DEFAULT 'pending' NOT NULL,
	"done_date" date,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"competence" date NOT NULL,
	"new_mrr" numeric(14, 2) DEFAULT 0 NOT NULL,
	"recurring_revenue" numeric(14, 2) DEFAULT 0 NOT NULL,
	"one_time_revenue" numeric(14, 2) DEFAULT 0 NOT NULL,
	"churn_amount" numeric(14, 2) DEFAULT 0 NOT NULL,
	"churn_rate" numeric(6, 2) DEFAULT 0 NOT NULL,
	"new_customers" integer DEFAULT 0 NOT NULL,
	"active_customers" integer DEFAULT 0 NOT NULL,
	"churned_customers" integer DEFAULT 0 NOT NULL,
	"avg_ticket" numeric(14, 2) DEFAULT 0 NOT NULL,
	"source" "sales_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"author_id" uuid,
	"category_id" uuid,
	"body" text NOT NULL,
	"comment_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"recommended" "recommendation_kind" NOT NULL,
	"outcome" "decision_outcome" NOT NULL,
	"justification" text NOT NULL,
	"metrics_snapshot" jsonb,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"goal_type_id" uuid NOT NULL,
	"target_value" numeric(14, 2) NOT NULL,
	"unit" text,
	"period" "goal_period" DEFAULT 'monthly' NOT NULL,
	"deadline" date,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_phase_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"phase" "lifecycle_phase" NOT NULL,
	"started_at" date NOT NULL,
	"ended_at" date,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"short_description" text,
	"owner_id" uuid,
	"team" text,
	"category_id" uuid,
	"phase" "lifecycle_phase" DEFAULT 'conception' NOT NULL,
	"status" "product_status" DEFAULT 'active' NOT NULL,
	"start_date" date NOT NULL,
	"planned_launch_date" date,
	"actual_launch_date" date,
	"segment" text,
	"pricing_model" text,
	"competitors" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"task_id" uuid NOT NULL,
	"depends_on_task_id" uuid NOT NULL,
	CONSTRAINT "task_dependencies_task_id_depends_on_task_id_pk" PRIMARY KEY("task_id","depends_on_task_id")
);
--> statement-breakpoint
CREATE TABLE "task_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"target_phase" "lifecycle_phase",
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_template_dependencies" (
	"template_id" uuid NOT NULL,
	"depends_on_template_id" uuid NOT NULL,
	CONSTRAINT "task_template_dependencies_template_id_depends_on_template_id_pk" PRIMARY KEY("template_id","depends_on_template_id")
);
--> statement-breakpoint
CREATE TABLE "task_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category_id" uuid,
	"default_assignee_id" uuid,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"initial_status" text DEFAULT 'backlog' NOT NULL,
	"estimated_hours" numeric(8, 2),
	"anchor" "task_anchor" DEFAULT 'start_date' NOT NULL,
	"start_offset_days" integer DEFAULT 0 NOT NULL,
	"end_offset_days" integer DEFAULT 7 NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"parent_template_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category_id" uuid,
	"assignee_id" uuid,
	"status" text DEFAULT 'backlog' NOT NULL,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"start_date" date,
	"due_date" date,
	"done_date" date,
	"estimated_hours" numeric(8, 2),
	"parent_task_id" uuid,
	"board_order" integer DEFAULT 0 NOT NULL,
	"origin_insight_id" uuid,
	"origin_template_id" uuid,
	"is_milestone" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"login" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'collaborator' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_plan_id_business_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."business_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_plans" ADD CONSTRAINT "action_plans_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_plan_months" ADD CONSTRAINT "business_plan_months_plan_id_business_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."business_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_plans" ADD CONSTRAINT "business_plans_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_plans" ADD CONSTRAINT "business_plans_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_entry_type_id_enum_values_id_fk" FOREIGN KEY ("entry_type_id") REFERENCES "public"."enum_values"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_parent_entry_id_finance_entries_id_fk" FOREIGN KEY ("parent_entry_id") REFERENCES "public"."finance_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_snapshots" ADD CONSTRAINT "health_snapshots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_origin_id_enum_values_id_fk" FOREIGN KEY ("origin_id") REFERENCES "public"."enum_values"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_plan_id_business_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."business_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_sales" ADD CONSTRAINT "monthly_sales_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_comments" ADD CONSTRAINT "product_comments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_comments" ADD CONSTRAINT "product_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_comments" ADD CONSTRAINT "product_comments_category_id_enum_values_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."enum_values"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_decisions" ADD CONSTRAINT "product_decisions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_decisions" ADD CONSTRAINT "product_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_goals" ADD CONSTRAINT "product_goals_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_goals" ADD CONSTRAINT "product_goals_goal_type_id_enum_values_id_fk" FOREIGN KEY ("goal_type_id") REFERENCES "public"."enum_values"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_phase_history" ADD CONSTRAINT "product_phase_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_phase_history" ADD CONSTRAINT "product_phase_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_enum_values_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."enum_values"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_tasks_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_template_dependencies" ADD CONSTRAINT "task_template_dependencies_template_id_task_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."task_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_template_dependencies" ADD CONSTRAINT "task_template_dependencies_depends_on_template_id_task_templates_id_fk" FOREIGN KEY ("depends_on_template_id") REFERENCES "public"."task_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_package_id_task_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."task_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_category_id_enum_values_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."enum_values"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_default_assignee_id_users_id_fk" FOREIGN KEY ("default_assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_parent_template_id_task_templates_id_fk" FOREIGN KEY ("parent_template_id") REFERENCES "public"."task_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_category_id_enum_values_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."enum_values"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_origin_template_id_task_templates_id_fk" FOREIGN KEY ("origin_template_id") REFERENCES "public"."task_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_logs_created_idx" ON "access_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "action_plans_product_idx" ON "action_plans" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_product_idx" ON "audit_logs" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "business_plan_months_key" ON "business_plan_months" USING btree ("plan_id","competence");--> statement-breakpoint
CREATE UNIQUE INDEX "business_plans_product_version_key" ON "business_plans" USING btree ("product_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "enum_values_kind_code_key" ON "enum_values" USING btree ("kind","code");--> statement-breakpoint
CREATE INDEX "finance_entries_product_idx" ON "finance_entries" USING btree ("product_id","competence_date");--> statement-breakpoint
CREATE INDEX "finance_entries_parent_idx" ON "finance_entries" USING btree ("parent_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "health_snapshots_product_competence_key" ON "health_snapshots" USING btree ("product_id","competence");--> statement-breakpoint
CREATE INDEX "insights_product_idx" ON "insights" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "milestones_plan_idx" ON "milestones" USING btree ("plan_id","target_date");--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_sales_product_competence_key" ON "monthly_sales" USING btree ("product_id","competence");--> statement-breakpoint
CREATE INDEX "product_comments_product_idx" ON "product_comments" USING btree ("product_id","comment_date");--> statement-breakpoint
CREATE INDEX "product_decisions_product_idx" ON "product_decisions" USING btree ("product_id","created_at");--> statement-breakpoint
CREATE INDEX "product_goals_product_idx" ON "product_goals" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_goals_one_primary" ON "product_goals" USING btree ("product_id") WHERE "product_goals"."is_primary";--> statement-breakpoint
CREATE INDEX "phase_history_product_idx" ON "product_phase_history" USING btree ("product_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_code_key" ON "products" USING btree (lower("code"));--> statement-breakpoint
CREATE INDEX "products_owner_idx" ON "products" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "products_phase_idx" ON "products" USING btree ("phase");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_attachments_task_idx" ON "task_attachments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_comments_task_idx" ON "task_comments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_templates_package_idx" ON "task_templates" USING btree ("package_id","order_index");--> statement-breakpoint
CREATE INDEX "tasks_product_idx" ON "tasks" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_idx" ON "tasks" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("product_id","status","board_order");--> statement-breakpoint
CREATE UNIQUE INDEX "users_login_key" ON "users" USING btree (lower("login"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));