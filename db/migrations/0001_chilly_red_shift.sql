CREATE TABLE "goal_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"competence" date NOT NULL,
	"value" numeric(14, 2) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goal_measurements" ADD CONSTRAINT "goal_measurements_goal_id_product_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."product_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "goal_measurements_competence" ON "goal_measurements" USING btree ("goal_id","competence");--> statement-breakpoint
CREATE INDEX "goal_measurements_goal_idx" ON "goal_measurements" USING btree ("goal_id","competence");