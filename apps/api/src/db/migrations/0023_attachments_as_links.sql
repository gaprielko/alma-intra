ALTER TABLE "campaigns" ADD COLUMN "attachments_as_links" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD COLUMN "as_link" boolean DEFAULT false NOT NULL;