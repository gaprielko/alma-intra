ALTER TYPE "public"."notification_kind" ADD VALUE 'next_step';--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "next_step_reminded_for" date;