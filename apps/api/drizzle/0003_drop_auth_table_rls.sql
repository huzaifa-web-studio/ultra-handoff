ALTER TABLE "invitation" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY "tenant_isolation" ON "invitation" CASCADE;--> statement-breakpoint
DROP POLICY "tenant_isolation" ON "member" CASCADE;--> statement-breakpoint
DROP POLICY "tenant_isolation" ON "organization" CASCADE;