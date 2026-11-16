CREATE TABLE "milestone_scope_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"milestone_id" text NOT NULL,
	"kind" text NOT NULL,
	"round" integer,
	"title" text NOT NULL,
	"body" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"change_request_id" text,
	"status_period_id" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "milestone_scope_entry_kind_check" CHECK ("milestone_scope_entry"."kind" in ('change', 'test', 'review')),
	CONSTRAINT "milestone_scope_entry_round_check" CHECK (("milestone_scope_entry"."kind" = 'change' and "milestone_scope_entry"."round" is null) or ("milestone_scope_entry"."kind" in ('test', 'review') and "milestone_scope_entry"."round" is not null and "milestone_scope_entry"."round" > 0)),
	CONSTRAINT "milestone_scope_entry_period_check" CHECK (("milestone_scope_entry"."kind" = 'change' and "milestone_scope_entry"."status_period_id" is null) or ("milestone_scope_entry"."kind" in ('test', 'review') and "milestone_scope_entry"."status_period_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "milestone_scope_entry" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "milestone_status_period" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"milestone_id" text NOT NULL,
	"status" text NOT NULL,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exited_at" timestamp with time zone,
	"entered_by" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "milestone_status_period_status_check" CHECK ("milestone_status_period"."status" in ('todo', 'in_development', 'in_testing', 'ready', 'in_review', 'blocked', 'done', 'cancelled')),
	CONSTRAINT "milestone_status_period_range_check" CHECK ("milestone_status_period"."exited_at" is null or "milestone_status_period"."exited_at" >= "milestone_status_period"."entered_at")
);
--> statement-breakpoint
ALTER TABLE "milestone_status_period" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "milestone" DROP CONSTRAINT "milestone_status_check";--> statement-breakpoint
ALTER TABLE "milestone_scope_entry" ADD CONSTRAINT "milestone_scope_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_scope_entry" ADD CONSTRAINT "milestone_scope_entry_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_scope_entry" ADD CONSTRAINT "milestone_scope_entry_milestone_id_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_scope_entry" ADD CONSTRAINT "milestone_scope_entry_change_request_id_change_request_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_scope_entry" ADD CONSTRAINT "milestone_scope_entry_status_period_id_milestone_status_period_id_fk" FOREIGN KEY ("status_period_id") REFERENCES "public"."milestone_status_period"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_scope_entry" ADD CONSTRAINT "milestone_scope_entry_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_scope_entry" ADD CONSTRAINT "milestone_scope_entry_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_status_period" ADD CONSTRAINT "milestone_status_period_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_status_period" ADD CONSTRAINT "milestone_status_period_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_status_period" ADD CONSTRAINT "milestone_status_period_milestone_id_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_status_period" ADD CONSTRAINT "milestone_status_period_entered_by_user_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "milestone_scope_entry_milestone_idx" ON "milestone_scope_entry" USING btree ("milestone_id","created_at","id");--> statement-breakpoint
CREATE INDEX "milestone_scope_entry_organization_idx" ON "milestone_scope_entry" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "milestone_scope_entry_change_request_idx" ON "milestone_scope_entry" USING btree ("change_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "milestone_scope_entry_period_idx" ON "milestone_scope_entry" USING btree ("status_period_id") WHERE "milestone_scope_entry"."status_period_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "milestone_scope_entry_round_idx" ON "milestone_scope_entry" USING btree ("milestone_id","kind","round") WHERE "milestone_scope_entry"."round" is not null;--> statement-breakpoint
CREATE INDEX "milestone_status_period_milestone_idx" ON "milestone_status_period" USING btree ("milestone_id","entered_at");--> statement-breakpoint
CREATE INDEX "milestone_status_period_project_status_idx" ON "milestone_status_period" USING btree ("project_id","status","entered_at");--> statement-breakpoint
CREATE INDEX "milestone_status_period_organization_idx" ON "milestone_status_period" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "milestone_status_period_open_idx" ON "milestone_status_period" USING btree ("milestone_id") WHERE "milestone_status_period"."exited_at" is null;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_status_check" CHECK ("milestone"."status" in ('todo', 'in_development', 'in_testing', 'ready', 'in_review', 'blocked', 'done', 'cancelled'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "milestone_scope_entry" AS PERMISSIVE FOR ALL TO "app_tenant" USING ("milestone_scope_entry"."organization_id" = current_setting('app.current_org_id', true)) WITH CHECK ("milestone_scope_entry"."organization_id" = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "milestone_status_period" AS PERMISSIVE FOR ALL TO "app_tenant" USING ("milestone_status_period"."organization_id" = current_setting('app.current_org_id', true)) WITH CHECK ("milestone_status_period"."organization_id" = current_setting('app.current_org_id', true));