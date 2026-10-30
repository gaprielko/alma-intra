CREATE TYPE "public"."lead_activity_type" AS ENUM('product_interest');--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'interest';--> statement-breakpoint
CREATE TABLE "lead_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "lead_activity_type" NOT NULL,
	"product_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid,
	"campaign_message_id" uuid,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_campaign_message_id_campaign_messages_id_fk" FOREIGN KEY ("campaign_message_id") REFERENCES "public"."campaign_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_activities_created_idx" ON "lead_activities" USING btree ("created_at") WHERE "lead_activities"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "lead_activities_organization_idx" ON "lead_activities" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "lead_activities_contact_idx" ON "lead_activities" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_activities_one_alive" ON "lead_activities" USING btree ("type","organization_id",coalesce("contact_id", '00000000-0000-0000-0000-000000000000'::uuid),"product_id") WHERE "lead_activities"."deleted_at" is null;