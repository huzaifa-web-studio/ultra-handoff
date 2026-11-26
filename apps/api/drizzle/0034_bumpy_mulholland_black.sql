CREATE TABLE "conversation_thread_read" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"root_message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp DEFAULT now() NOT NULL,
	"last_read_message_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_thread_read" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_message" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "conversation_thread_read" ADD CONSTRAINT "conversation_thread_read_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_thread_read" ADD CONSTRAINT "conversation_thread_read_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_thread_read" ADD CONSTRAINT "conversation_thread_read_root_message_id_conversation_message_id_fk" FOREIGN KEY ("root_message_id") REFERENCES "public"."conversation_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_thread_read" ADD CONSTRAINT "conversation_thread_read_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_thread_read" ADD CONSTRAINT "conversation_thread_read_last_read_message_id_conversation_message_id_fk" FOREIGN KEY ("last_read_message_id") REFERENCES "public"."conversation_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_thread_read_root_user_idx" ON "conversation_thread_read" USING btree ("root_message_id","user_id");--> statement-breakpoint
CREATE INDEX "conversation_thread_read_user_conversation_idx" ON "conversation_thread_read" USING btree ("user_id","conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_thread_read_organization_idx" ON "conversation_thread_read" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_parent_id_conversation_message_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."conversation_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_message_thread_idx" ON "conversation_message" USING btree ("conversation_id","parent_id","created_at","id");--> statement-breakpoint
ALTER TABLE "conversation_message" ADD CONSTRAINT "conversation_message_parent_check" CHECK ("conversation_message"."parent_id" is null or "conversation_message"."parent_id" <> "conversation_message"."id");--> statement-breakpoint
CREATE POLICY "conversation_thread_read_select" ON "conversation_thread_read" AS PERMISSIVE FOR SELECT TO "app_tenant" USING ("conversation_thread_read"."organization_id" = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "conversation_thread_read_insert" ON "conversation_thread_read" AS PERMISSIVE FOR INSERT TO "app_tenant" WITH CHECK ("conversation_thread_read"."organization_id" = current_setting('app.current_org_id', true)
				and "conversation_thread_read"."user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "conversation_thread_read_update" ON "conversation_thread_read" AS PERMISSIVE FOR UPDATE TO "app_tenant" USING ("conversation_thread_read"."organization_id" = current_setting('app.current_org_id', true)
				and "conversation_thread_read"."user_id" = current_setting('app.current_user_id', true)) WITH CHECK ("conversation_thread_read"."organization_id" = current_setting('app.current_org_id', true)
				and "conversation_thread_read"."user_id" = current_setting('app.current_user_id', true));--> statement-breakpoint
CREATE POLICY "conversation_thread_read_delete" ON "conversation_thread_read" AS PERMISSIVE FOR DELETE TO "app_tenant" USING ("conversation_thread_read"."organization_id" = current_setting('app.current_org_id', true)
				and "conversation_thread_read"."user_id" = current_setting('app.current_user_id', true));