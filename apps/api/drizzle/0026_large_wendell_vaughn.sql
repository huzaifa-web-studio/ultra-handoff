CREATE TABLE "comment_thread_read" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"milestone_id" text NOT NULL,
	"root_comment_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp NOT NULL,
	"last_read_comment_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comment_thread_read" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"actor_user_id" text,
	"type" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"project_id" text,
	"milestone_id" text,
	"comment_id" text,
	"change_request_id" text,
	"scope_entry_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_type_check" CHECK ("notification"."type" in ('mention', 'comment_reply', 'comment_new', 'milestone_assigned', 'milestone_status', 'scope_locked', 'scope_unlocked', 'change_request_created', 'change_request_decided', 'change_request_withdrawn', 'project_member_added', 'project_role_changed', 'member_joined', 'milestone_due_soon', 'milestone_overdue', 'org_role_changed', 'project_archived', 'project_unarchived'))
);
--> statement-breakpoint
ALTER TABLE "notification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_subscription" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "comment_thread_read" ADD CONSTRAINT "comment_thread_read_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_thread_read" ADD CONSTRAINT "comment_thread_read_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_thread_read" ADD CONSTRAINT "comment_thread_read_milestone_id_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_thread_read" ADD CONSTRAINT "comment_thread_read_root_comment_id_comment_id_fk" FOREIGN KEY ("root_comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_thread_read" ADD CONSTRAINT "comment_thread_read_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_thread_read" ADD CONSTRAINT "comment_thread_read_last_read_comment_id_comment_id_fk" FOREIGN KEY ("last_read_comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_milestone_id_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_change_request_id_change_request_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_scope_entry_id_milestone_scope_entry_id_fk" FOREIGN KEY ("scope_entry_id") REFERENCES "public"."milestone_scope_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comment_thread_read_root_user_idx" ON "comment_thread_read" USING btree ("root_comment_id","user_id");--> statement-breakpoint
CREATE INDEX "comment_thread_read_user_milestone_idx" ON "comment_thread_read" USING btree ("user_id","milestone_id");--> statement-breakpoint
CREATE INDEX "comment_thread_read_organization_idx" ON "comment_thread_read" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "comment_thread_read_project_idx" ON "comment_thread_read" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_recipient_dedupe_idx" ON "notification" USING btree ("recipient_user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_recipient_created_idx" ON "notification" USING btree ("recipient_user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "notification_recipient_unread_idx" ON "notification" USING btree ("recipient_user_id","created_at") WHERE "notification"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notification_recipient_project_unread_idx" ON "notification" USING btree ("recipient_user_id","project_id") WHERE "notification"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notification_organization_idx" ON "notification" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "notification_project_idx" ON "notification" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "notification_milestone_idx" ON "notification" USING btree ("milestone_id");--> statement-breakpoint
CREATE INDEX "notification_comment_idx" ON "notification" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "notification_change_request_idx" ON "notification" USING btree ("change_request_id");--> statement-breakpoint
CREATE INDEX "notification_scope_entry_idx" ON "notification" USING btree ("scope_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscription_endpoint_idx" ON "push_subscription" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscription_user_idx" ON "push_subscription" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "milestone_organization_due_idx" ON "milestone" USING btree ("organization_id","due_date");--> statement-breakpoint
CREATE POLICY "user_isolation" ON "comment_thread_read" AS PERMISSIVE FOR ALL TO "app_tenant" USING ("comment_thread_read"."user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("comment_thread_read"."user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "notification_select" ON "notification" AS PERMISSIVE FOR SELECT TO "app_tenant" USING ("notification"."organization_id" = current_setting('app.current_org_id', true) and "notification"."recipient_user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "notification_insert" ON "notification" AS PERMISSIVE FOR INSERT TO "app_tenant" WITH CHECK ("notification"."organization_id" = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "notification_update" ON "notification" AS PERMISSIVE FOR UPDATE TO "app_tenant" USING ("notification"."organization_id" = current_setting('app.current_org_id', true) and "notification"."recipient_user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("notification"."organization_id" = current_setting('app.current_org_id', true) and "notification"."recipient_user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "notification_delete" ON "notification" AS PERMISSIVE FOR DELETE TO "app_tenant" USING ("notification"."organization_id" = current_setting('app.current_org_id', true) and "notification"."recipient_user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "user_isolation" ON "push_subscription" AS PERMISSIVE FOR ALL TO "app_tenant" USING ("push_subscription"."user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("push_subscription"."user_id" = current_setting('app.current_user_id', true));