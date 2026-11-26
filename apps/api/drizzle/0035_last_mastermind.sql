ALTER TABLE "notification" DROP CONSTRAINT "notification_type_check";--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "member_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_org_group_title_idx" ON "conversation" USING btree ("organization_id",lower("title")) WHERE "conversation"."scope" = 'group' and "conversation"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "conversation_org_scope_visibility_idx" ON "conversation" USING btree ("organization_id","scope","visibility");--> statement-breakpoint
CREATE INDEX "conversation_org_scope_created_idx" ON "conversation" USING btree ("organization_id","scope","created_at");--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_group_check" CHECK ("conversation"."scope" <> 'group'
				or (
					"conversation"."title" is not null
					and "conversation"."visibility" in ('public', 'private')
				));--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_type_check" CHECK ("notification"."type" in ('mention', 'comment_reply', 'comment_new', 'milestone_assigned', 'milestone_status', 'scope_locked', 'scope_unlocked', 'change_request_created', 'change_request_decided', 'change_request_withdrawn', 'project_member_added', 'project_role_changed', 'member_joined', 'milestone_due_soon', 'milestone_overdue', 'org_role_changed', 'project_archived', 'project_unarchived', 'direct_message', 'group_message'));--> statement-breakpoint
CREATE POLICY "conversation_participant_owner_update" ON "conversation_participant" AS PERMISSIVE FOR UPDATE TO "app_tenant" USING ("conversation_participant"."organization_id" = current_setting('app.current_org_id', true)
				and exists (
		select 1
		from "conversation_participant" participant
		where participant."conversation_id" = "conversation_participant"."conversation_id"
			and participant."user_id" = current_setting('app.current_user_id', true)
			and participant."organization_id" = current_setting('app.current_org_id', true)
			and participant."role" = 'owner'
			and participant."left_at" is null
	)) WITH CHECK ("conversation_participant"."organization_id" = current_setting('app.current_org_id', true)
				and exists (
		select 1
		from "conversation_participant" participant
		where participant."conversation_id" = "conversation_participant"."conversation_id"
			and participant."user_id" = current_setting('app.current_user_id', true)
			and participant."organization_id" = current_setting('app.current_org_id', true)
			and participant."role" = 'owner'
			and participant."left_at" is null
	));--> statement-breakpoint
ALTER POLICY "conversation_select" ON "conversation" TO app_tenant USING ("conversation"."organization_id" = current_setting('app.current_org_id', true)
				and (
					(
						"conversation"."scope" = 'direct'
						and "conversation"."created_by" = current_setting('app.current_user_id', true)
					)
					or exists (
		select 1
		from "conversation_participant" participant
		where participant."conversation_id" = "conversation"."id"
			and participant."user_id" = current_setting('app.current_user_id', true)
			and participant."organization_id" = current_setting('app.current_org_id', true)
			and participant."left_at" is null
	)
					or (
						"conversation"."scope" = 'group'
						and "conversation"."visibility" = 'public'
						and "conversation"."archived_at" is null
					)
				));--> statement-breakpoint
ALTER POLICY "conversation_update" ON "conversation" TO app_tenant USING ("conversation"."organization_id" = current_setting('app.current_org_id', true)
				and (
					(
						"conversation"."scope" = 'direct'
						and "conversation"."created_by" = current_setting('app.current_user_id', true)
					)
					or exists (
		select 1
		from "conversation_participant" participant
		where participant."conversation_id" = "conversation"."id"
			and participant."user_id" = current_setting('app.current_user_id', true)
			and participant."organization_id" = current_setting('app.current_org_id', true)
			and participant."left_at" is null
	)
				)) WITH CHECK ("conversation"."organization_id" = current_setting('app.current_org_id', true)
				and (
					(
						"conversation"."scope" = 'direct'
						and "conversation"."created_by" = current_setting('app.current_user_id', true)
					)
					or exists (
		select 1
		from "conversation_participant" participant
		where participant."conversation_id" = "conversation"."id"
			and participant."user_id" = current_setting('app.current_user_id', true)
			and participant."organization_id" = current_setting('app.current_org_id', true)
			and participant."left_at" is null
	)
				));--> statement-breakpoint
ALTER POLICY "conversation_message_select" ON "conversation_message" TO app_tenant USING ("conversation_message"."organization_id" = current_setting('app.current_org_id', true)
				and exists (
		select 1
		from "conversation_participant" participant
		where participant."conversation_id" = "conversation_message"."conversation_id"
			and participant."user_id" = current_setting('app.current_user_id', true)
			and participant."organization_id" = current_setting('app.current_org_id', true)
			and participant."left_at" is null
	));--> statement-breakpoint
ALTER POLICY "conversation_message_insert" ON "conversation_message" TO app_tenant WITH CHECK ("conversation_message"."organization_id" = current_setting('app.current_org_id', true)
				and exists (
		select 1
		from "conversation_participant" participant
		where participant."conversation_id" = "conversation_message"."conversation_id"
			and participant."user_id" = current_setting('app.current_user_id', true)
			and participant."organization_id" = current_setting('app.current_org_id', true)
			and participant."left_at" is null
	));--> statement-breakpoint
ALTER POLICY "conversation_participant_select" ON "conversation_participant" TO app_tenant USING ("conversation_participant"."organization_id" = current_setting('app.current_org_id', true)
				and exists (
		select 1
		from "conversation_participant" participant
		where participant."conversation_id" = "conversation_participant"."conversation_id"
			and participant."user_id" = current_setting('app.current_user_id', true)
			and participant."organization_id" = current_setting('app.current_org_id', true)
			and participant."left_at" is null
	));--> statement-breakpoint
ALTER POLICY "conversation_thread_read_select" ON "conversation_thread_read" TO app_tenant USING ("conversation_thread_read"."organization_id" = current_setting('app.current_org_id', true)
				and exists (
		select 1
		from "conversation_participant" participant
		where participant."conversation_id" = "conversation_thread_read"."conversation_id"
			and participant."user_id" = current_setting('app.current_user_id', true)
			and participant."organization_id" = current_setting('app.current_org_id', true)
			and participant."left_at" is null
	));