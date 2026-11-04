CREATE TABLE "link_preview" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"url" text NOT NULL,
	"url_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"title" text,
	"description" text,
	"site_name" text,
	"image_key" text,
	"image_width" integer,
	"image_height" integer,
	"favicon_key" text,
	"error_code" text,
	"fetched_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "link_preview_status_check" CHECK ("link_preview"."status" in ('pending', 'ready', 'unavailable', 'blocked'))
);
--> statement-breakpoint
ALTER TABLE "link_preview" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "link_preview" ADD CONSTRAINT "link_preview_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "link_preview_organization_url_idx" ON "link_preview" USING btree ("organization_id","url_hash");--> statement-breakpoint
CREATE INDEX "link_preview_organization_idx" ON "link_preview" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "link_preview_organization_fetched_idx" ON "link_preview" USING btree ("organization_id","fetched_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "link_preview" AS PERMISSIVE FOR ALL TO "app_tenant" USING ("link_preview"."organization_id" = current_setting('app.current_org_id', true)) WITH CHECK ("link_preview"."organization_id" = current_setting('app.current_org_id', true));