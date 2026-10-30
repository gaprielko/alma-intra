ALTER TABLE "inbound_messages" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
UPDATE "inbound_messages" SET "read_at" = "received_at";
