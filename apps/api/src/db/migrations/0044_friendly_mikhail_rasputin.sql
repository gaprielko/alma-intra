ALTER TABLE "campaigns" ADD COLUMN "reply_to_inbound_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "reply_mode" text;