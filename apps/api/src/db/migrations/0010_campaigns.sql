CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'scheduled', 'sending', 'sent', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('draft', 'skipped', 'queued', 'sent', 'delivered', 'bounced', 'complained', 'failed');--> statement-breakpoint
CREATE TABLE "campaign_attachments" (
	"campaign_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "campaign_attachments_campaign_id_file_id_pk" PRIMARY KEY("campaign_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "campaign_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"contact_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"own_file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"body_override" jsonb,
	"status" "message_status" DEFAULT 'draft' NOT NULL,
	"skip_reason" text,
	"to_email" text,
	"to_name" text,
	"subject" text,
	"html" text,
	"text" text,
	"total_bytes" integer,
	"unsubscribe_token_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"leased_until" timestamp with time zone,
	"provider_message_id" text,
	"error_code" text,
	"queued_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"bounced_at" timestamp with time zone,
	"complained_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"template_id" uuid,
	"subject" jsonb,
	"body" jsonb,
	"custom_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"common_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"subject_text" text,
	"sender_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid,
	"provider_event_id" text NOT NULL,
	"type" text NOT NULL,
	"detail" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_events_provider_event_id_unique" UNIQUE("provider_event_id")
);
--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"message_id" uuid NOT NULL,
	"file_version_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "message_attachments_message_id_file_version_id_pk" PRIMARY KEY("message_id","file_version_id")
);
--> statement-breakpoint
ALTER TABLE "campaign_attachments" ADD CONSTRAINT "campaign_attachments_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_attachments" ADD CONSTRAINT "campaign_attachments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_messages" ADD CONSTRAINT "campaign_messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_messages" ADD CONSTRAINT "campaign_messages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_messages" ADD CONSTRAINT "campaign_messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_message_id_campaign_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."campaign_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_campaign_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."campaign_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_file_version_id_file_versions_id_fk" FOREIGN KEY ("file_version_id") REFERENCES "public"."file_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_messages_campaign_idx" ON "campaign_messages" USING btree ("campaign_id","position");--> statement-breakpoint
CREATE INDEX "campaign_messages_customer_idx" ON "campaign_messages" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "campaign_messages_queue_idx" ON "campaign_messages" USING btree ("next_attempt_at") WHERE "campaign_messages"."status" = 'queued';--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_messages_recipient_unique" ON "campaign_messages" USING btree ("campaign_id","customer_id",coalesce("contact_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_messages_provider_unique" ON "campaign_messages" USING btree ("provider_message_id") WHERE "campaign_messages"."provider_message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_messages_unsubscribe_unique" ON "campaign_messages" USING btree ("unsubscribe_token_hash") WHERE "campaign_messages"."unsubscribe_token_hash" is not null;--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "email_events_message_idx" ON "email_events" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "message_attachments_version_idx" ON "message_attachments" USING btree ("file_version_id");