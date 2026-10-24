CREATE TABLE "milestone" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"description" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description_text" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"start_date" date,
	"due_date" date,
	"estimate_minutes" integer,
	"completed_at" timestamp,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "milestone_status_check" CHECK ("milestone"."status" in ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
	CONSTRAINT "milestone_estimate_check" CHECK ("milestone"."estimate_minutes" is null or ("milestone"."estimate_minutes" > 0 and "milestone"."estimate_minutes" <= 60000)),
	CONSTRAINT "milestone_dates_check" CHECK ("milestone"."start_date" is null or "milestone"."due_date" is null or "milestone"."start_date" <= "milestone"."due_date")
);
--> statement-breakpoint
ALTER TABLE "milestone" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "milestone_assignee" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"milestone_id" text NOT NULL,
	"project_member_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "milestone_assignee" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_assignee" ADD CONSTRAINT "milestone_assignee_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_assignee" ADD CONSTRAINT "milestone_assignee_milestone_id_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_assignee" ADD CONSTRAINT "milestone_assignee_project_member_id_project_member_id_fk" FOREIGN KEY ("project_member_id") REFERENCES "public"."project_member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "milestone_project_status_due_idx" ON "milestone" USING btree ("project_id","status","due_date");--> statement-breakpoint
CREATE INDEX "milestone_organization_idx" ON "milestone" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "milestone_assignee_milestone_member_idx" ON "milestone_assignee" USING btree ("milestone_id","project_member_id");--> statement-breakpoint
CREATE INDEX "milestone_assignee_organization_idx" ON "milestone_assignee" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "milestone_assignee_milestone_idx" ON "milestone_assignee" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "milestone_assignee_member_idx" ON "milestone_assignee" USING btree ("project_member_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "milestone" AS PERMISSIVE FOR ALL TO "app_tenant" USING ("milestone"."organization_id" = current_setting('app.current_org_id', true)) WITH CHECK ("milestone"."organization_id" = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "milestone_assignee" AS PERMISSIVE FOR ALL TO "app_tenant" USING ("milestone_assignee"."organization_id" = current_setting('app.current_org_id', true)) WITH CHECK ("milestone_assignee"."organization_id" = current_setting('app.current_org_id', true));