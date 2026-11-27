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
					or (
						"conversation"."scope" = 'project'
						and exists (
		select 1
		from "project_member" project_member
		where project_member."project_id" = "conversation"."project_id"
			and project_member."user_id" = current_setting('app.current_user_id', true)
			and project_member."organization_id" = current_setting('app.current_org_id', true)
	)
					)
				));