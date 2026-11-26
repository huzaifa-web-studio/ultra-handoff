ALTER POLICY "conversation_participant_select" ON "conversation_participant" TO app_tenant USING ("conversation_participant"."organization_id" = current_setting('app.current_org_id', true)
				and (
					exists (
		select 1
		from "conversation_participant" participant
		where participant."conversation_id" = "conversation_participant"."conversation_id"
			and participant."user_id" = current_setting('app.current_user_id', true)
			and participant."organization_id" = current_setting('app.current_org_id', true)
			and participant."left_at" is null
	)
					or "conversation_participant"."user_id" = current_setting('app.current_user_id', true)
				));