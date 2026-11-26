DROP INDEX "conversation_org_group_title_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_org_group_title_idx" ON "conversation" USING btree ("organization_id",lower("title"),"visibility") WHERE "conversation"."scope" = 'group' and "conversation"."archived_at" is null;--> statement-breakpoint
ALTER POLICY "conversation_participant_insert" ON "conversation_participant" TO app_tenant WITH CHECK ("conversation_participant"."organization_id" = current_setting('app.current_org_id', true)
				and "conversation_participant"."user_id" = current_setting('app.current_user_id', true));