CREATE TABLE "project" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"archived_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_slug_format_check" CHECK ("project"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "project" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"member_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_member_role_check" CHECK ("project_member"."role" in ('owner', 'admin', 'member', 'client'))
);
--> statement-breakpoint
ALTER TABLE "project_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_organization_slug_idx" ON "project" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "project_organization_idx" ON "project" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "project_organization_archived_idx" ON "project" USING btree ("organization_id","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_member_project_member_idx" ON "project_member" USING btree ("project_id","member_id");--> statement-breakpoint
CREATE INDEX "project_member_organization_idx" ON "project_member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "project_member_project_idx" ON "project_member" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_member_user_idx" ON "project_member" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "project" AS PERMISSIVE FOR ALL TO "app_tenant" USING ("project"."organization_id" = current_setting('app.current_org_id', true)) WITH CHECK ("project"."organization_id" = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "project_member" AS PERMISSIVE FOR ALL TO "app_tenant" USING ("project_member"."organization_id" = current_setting('app.current_org_id', true)) WITH CHECK ("project_member"."organization_id" = current_setting('app.current_org_id', true));