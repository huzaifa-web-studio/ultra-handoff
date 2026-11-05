CREATE INDEX "milestone_title_trgm_idx" ON "milestone" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "project_name_trgm_idx" ON "project" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "user_name_trgm_idx" ON "user" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "user_email_trgm_idx" ON "user" USING gin ("email" gin_trgm_ops);