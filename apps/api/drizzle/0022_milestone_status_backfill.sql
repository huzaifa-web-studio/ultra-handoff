-- Backfill the removed `in_progress` status before the final check is applied.
--
-- Why this runs as its own custom migration: the generated diff drops the old
-- check and adds the final one in a single statement pair. Existing rows that
-- still hold `in_progress` would violate the new check before the data could be
-- rewritten. This migration widens the check just enough to accept both
-- vocabularies, rewrites the rows, and the next generated migration tightens it
-- again.
ALTER TABLE "milestone" DROP CONSTRAINT "milestone_status_check";--> statement-breakpoint
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_status_check" CHECK ("milestone"."status" in ('todo', 'in_progress', 'in_development', 'in_testing', 'in_review', 'blocked', 'done', 'cancelled'));--> statement-breakpoint
UPDATE "milestone" SET "status" = 'in_development' WHERE "status" = 'in_progress';--> statement-breakpoint
-- Historical status events point at the old value too. Without this, the
-- timeline would try to render a badge for a status that no longer exists.
UPDATE "comment" SET "event_from" = 'in_development' WHERE "event_type" = 'status' AND "event_from" = 'in_progress';--> statement-breakpoint
UPDATE "comment" SET "event_to" = 'in_development' WHERE "event_type" = 'status' AND "event_to" = 'in_progress';
