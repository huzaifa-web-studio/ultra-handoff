CREATE TABLE "project_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"pinned_at" timestamp,
	"last_opened_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_activity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_activity" ADD CONSTRAINT "project_activity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_activity" ADD CONSTRAINT "project_activity_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_activity" ADD CONSTRAINT "project_activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_activity_project_user_idx" ON "project_activity" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_activity_organization_user_idx" ON "project_activity" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "project_activity" AS PERMISSIVE FOR ALL TO "app_tenant" USING ("project_activity"."organization_id" = current_setting('app.current_org_id', true)) WITH CHECK ("project_activity"."organization_id" = current_setting('app.current_org_id', true));