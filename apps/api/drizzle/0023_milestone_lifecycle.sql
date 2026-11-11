CREATE TABLE "change_request" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"milestone_id" text NOT NULL,
	"title" text NOT NULL,
	"body" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"requested_by" text,
	"decided_by" text,
	"decided_at" timestamp,
	"decision_note" text,
	"target_milestone_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "change_request_status_check" CHECK ("change_request"."status" in ('open', 'accepted', 'declined', 'moved', 'withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "change_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "comment" DROP CONSTRAINT "comment_event_check";--> statement-breakpoint
ALTER TABLE "milestone" DROP CONSTRAINT "milestone_status_check";--> statement-breakpoint
ALTER TABLE "comment" ADD COLUMN "event_note" text;--> statement-breakpoint
ALTER TABLE "milestone" ADD COLUMN "locked_at" timestamp;--> statement-breakpoint
ALTER TABLE "milestone" ADD COLUMN "locked_by" text;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_milestone_id_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestone"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_target_milestone_id_milestone_id_fk" FOREIGN KEY ("target_milestone_id") REFERENCES "public"."milestone"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_request_organization_idx" ON "change_request" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "change_request_project_milestone_status_idx" ON "change_request" USING btree ("project_id","milestone_id","status");--> statement-breakpoint
CREATE INDEX "change_request_target_milestone_idx" ON "change_request" USING btree ("target_milestone_id");--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_locked_by_user_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_event_check" CHECK ((
				"comment"."kind" = 'comment'
				and "comment"."event_type" is null
				and "comment"."event_from" is null
				and "comment"."event_to" is null
				and "comment"."event_note" is null
			) or (
				"comment"."kind" = 'event'
				and "comment"."event_type" in (
					'status', 'start_date', 'due_date', 'assignee_added',
					'assignee_removed', 'estimate_minutes', 'milestone_locked',
					'milestone_unlocked', 'change_request_created',
					'change_request_accepted', 'change_request_declined',
					'change_request_moved', 'change_request_withdrawn'
				)
			));--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_lock_check" CHECK (("milestone"."locked_at" is null) = ("milestone"."locked_by" is null));--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_status_check" CHECK ("milestone"."status" in ('todo', 'in_development', 'in_testing', 'in_review', 'blocked', 'done', 'cancelled'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "change_request" AS PERMISSIVE FOR ALL TO "app_tenant" USING ("change_request"."organization_id" = current_setting('app.current_org_id', true)) WITH CHECK ("change_request"."organization_id" = current_setting('app.current_org_id', true));