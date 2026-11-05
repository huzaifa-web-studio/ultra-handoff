ALTER TABLE "comment" ADD COLUMN "kind" text DEFAULT 'comment' NOT NULL;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "event_type" text;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "event_from" text;--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "event_to" text;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_kind_check" CHECK ("comment"."kind" in ('comment', 'event'));--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_event_check" CHECK ((
				"comment"."kind" = 'comment'
				and "comment"."event_type" is null
				and "comment"."event_from" is null
				and "comment"."event_to" is null
			) or (
				"comment"."kind" = 'event'
				and "comment"."event_type" in ('status', 'start_date', 'due_date')
			));--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_event_parent_check" CHECK ("comment"."kind" = 'comment' or "comment"."parent_id" is null);