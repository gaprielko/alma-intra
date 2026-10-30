ALTER TABLE "campaign_messages" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign_messages" ADD COLUMN "recipient_role" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "kind" text DEFAULT 'bulk' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "direct_recipients" jsonb DEFAULT '[]'::jsonb NOT NULL;