ALTER TABLE "comment" DROP CONSTRAINT "comment_event_check";--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_event_check" CHECK ((
				"comment"."kind" = 'comment'
				and "comment"."event_type" is null
				and "comment"."event_from" is null
				and "comment"."event_to" is null
			) or (
				"comment"."kind" = 'event'
				and "comment"."event_type" in ('status', 'start_date', 'due_date', 'assignee_added', 'assignee_removed', 'estimate_minutes')
			));