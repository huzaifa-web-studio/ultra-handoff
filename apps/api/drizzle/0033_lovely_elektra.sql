CREATE TABLE "conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"scope" text DEFAULT 'direct' NOT NULL,
	"project_id" text,
	"title" text,
	"pair_key" text,
	"created_by" text,
	"last_message_at" timestamp,
	"last_message_id" text,
	"last_message_author_id" text,
	"last_message_preview" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_scope_check" CHECK ("conversation"."scope" in ('direct', 'group', 'project')),
	CONSTRAINT "conversation_pair_check" CHECK (("conversation"."scope" = 'direct' and "conversation"."pair_key" is not null)
				or ("conversation"."scope" <> 'direct' and "conversation"."pair_key" is null))
);
--> statement-breakpoint
ALTER TABLE "conversation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversation_message" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"author_id" text,
	"body" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"client_nonce" text NOT NULL,
	"edited_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversation_participant" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"last_read_at" timestamp DEFAULT now() NOT NULL,
	"last_read_message_id" text,
	"left_at" timestamp,
	"muted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_participant_role_check" CHECK ("conversation_participant"."role" in ('owner', 'member'))
);
--> statement-breakpoint
ALTER TABLE "conversation_participant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification" DROP CONSTRAINT "notification_type_check";--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "conversation_id" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_last_message_author_id_user_id_fk" FOREIGN KEY ("last_message_author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_org_pair_idx" ON "conversation" USING btree ("organization_id","pair_key") WHERE "conversation"."pair_key" is not null;--> statement-breakpoint
CREATE INDEX "conversation_org_activity_idx" ON "conversation" USING btree ("organization_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversation_project_idx" ON "conversation" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "conversation_message_conversation_created_idx" ON "conversation_message" USING btree ("conversation_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_message_nonce_idx" ON "conversation_message" USING btree ("conversation_id","author_id","client_nonce");--> statement-breakpoint
CREATE INDEX "conversation_message_organization_idx" ON "conversation_message" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "conversation_message_body_trgm_idx" ON "conversation_message" USING gin ("body_text" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_participant_conversation_user_idx" ON "conversation_participant" USING btree ("conversation_id","user_id");--> statement-breakpoint
CREATE INDEX "conversation_participant_user_idx" ON "conversation_participant" USING btree ("user_id","conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_participant_organization_idx" ON "conversation_participant" USING btree ("organization_id","conversation_id");--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_body_trgm_idx" ON "comment" USING gin ("body_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "notification_conversation_idx" ON "notification" USING btree ("conversation_id");--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_type_check" CHECK ("notification"."type" in ('mention', 'comment_reply', 'comment_new', 'milestone_assigned', 'milestone_status', 'scope_locked', 'scope_unlocked', 'change_request_created', 'change_request_decided', 'change_request_withdrawn', 'project_member_added', 'project_role_changed', 'member_joined', 'milestone_due_soon', 'milestone_overdue', 'org_role_changed', 'project_archived', 'project_unarchived', 'direct_message'));--> statement-breakpoint
CREATE POLICY "conversation_insert" ON "conversation" AS PERMISSIVE FOR INSERT TO "app_tenant" WITH CHECK ("conversation"."organization_id" = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "conversation_select" ON "conversation" AS PERMISSIVE FOR SELECT TO "app_tenant" USING ("conversation"."organization_id" = current_setting('app.current_org_id', true)
				and (
					"conversation"."created_by" = current_setting('app.current_user_id', true)
					or exists (
		select 1
		from "conversation_participant" participant
		where participant."conversation_id" = "conversation"."id"
			and participant."user_id" = current_setting('app.current_user_id', true)
			and participant."organization_id" = current_setting('app.current_org_id', true)
	)
				));--> statement-breakpoint
CREATE POLICY "conversation_update" ON "conversation" AS PERMISSIVE FOR UPDATE TO "app_tenant" USING ("conversation"."organization_id" = current_setting('app.current_org_id', true)
				and (
					"conversation"."created_by" = current_setting('app.current_user_id', true)
					or exists (
		select 1
		from "conversation_participant" participant
		where participant."conversation_id" = "conversation"."id"
			and participant."user_id" = current_setting('app.current_user_id', true)
			and participant."organization_id" = current_setting('app.current_org_id', true)
	)
				)) WITH CHECK ("conversation"."organization_id" = current_setting('app.current_org_id', true)
				and (
					"conversation"."created_by" = current_setting('app.current_user_id', true)
					or exists (
		select 1
		from "conversation_participant" participant
		where participant."conversation_id" = "conversation"."id"
			and participant."user_id" = current_setting('app.current_user_id', true)
			and participant."organization_id" = current_setting('app.current_org_id', true)
	)
				));--> statement-breakpoint
CREATE POLICY "conversation_message_select" ON "conversation_message" AS PERMISSIVE FOR SELECT TO "app_tenant" USING ("conversation_message"."organization_id" = current_setting('app.current_org_id', true)
				and exists (
		select 1
		from "conversation_participant" participant
		where participant."conversation_id" = "conversation_message"."conversation_id"
			and participant."user_id" = current_setting('app.current_user_id', true)
			and participant."organization_id" = current_setting('app.current_org_id', true)
	));--> statement-breakpoint
CREATE POLICY "conversation_message_insert" ON "conversation_message" AS PERMISSIVE FOR INSERT TO "app_tenant" WITH CHECK ("conversation_message"."organization_id" = current_setting('app.current_org_id', true)
				and exists (
		select 1
		from "conversation_participant" participant
		where participant."conversation_id" = "conversation_message"."conversation_id"
			and participant."user_id" = current_setting('app.current_user_id', true)
			and participant."organization_id" = current_setting('app.current_org_id', true)
	));--> statement-breakpoint
CREATE POLICY "conversation_message_update" ON "conversation_message" AS PERMISSIVE FOR UPDATE TO "app_tenant" USING ("conversation_message"."organization_id" = current_setting('app.current_org_id', true)
				and "conversation_message"."author_id" = current_setting('app.current_user_id', true)) WITH CHECK ("conversation_message"."organization_id" = current_setting('app.current_org_id', true)
				and "conversation_message"."author_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "conversation_message_delete" ON "conversation_message" AS PERMISSIVE FOR DELETE TO "app_tenant" USING ("conversation_message"."organization_id" = current_setting('app.current_org_id', true)
				and "conversation_message"."author_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "conversation_participant_select" ON "conversation_participant" AS PERMISSIVE FOR SELECT TO "app_tenant" USING ("conversation_participant"."organization_id" = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "conversation_participant_insert" ON "conversation_participant" AS PERMISSIVE FOR INSERT TO "app_tenant" WITH CHECK ("conversation_participant"."organization_id" = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "conversation_participant_update" ON "conversation_participant" AS PERMISSIVE FOR UPDATE TO "app_tenant" USING ("conversation_participant"."organization_id" = current_setting('app.current_org_id', true)
				and "conversation_participant"."user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("conversation_participant"."organization_id" = current_setting('app.current_org_id', true)
				and "conversation_participant"."user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "conversation_participant_delete" ON "conversation_participant" AS PERMISSIVE FOR DELETE TO "app_tenant" USING ("conversation_participant"."organization_id" = current_setting('app.current_org_id', true)
				and "conversation_participant"."user_id" = current_setting('app.current_user_id', true));