CREATE TYPE "public"."inbound_status" AS ENUM('assigned', 'unassigned', 'discarded');--> statement-breakpoint
CREATE TABLE "inbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_email_id" text NOT NULL,
	"message_id" uuid,
	"customer_id" uuid,
	"contact_id" uuid,
	"user_id" uuid,
	"status" "inbound_status" NOT NULL,
	"from_email" text NOT NULL,
	"from_name" text,
	"to_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cc_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"html" text,
	"text" text,
	"header_message_id" text,
	"in_reply_to" text,
	"references" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"assigned_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_messages_provider_email_id_unique" UNIQUE("provider_email_id")
);
--> statement-breakpoint
ALTER TABLE "campaign_messages" ADD COLUMN "reply_token" text;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_message_id_campaign_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."campaign_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_assigned_by_user_id_users_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbound_messages_customer_idx" ON "inbound_messages" USING btree ("customer_id","received_at");--> statement-breakpoint
CREATE INDEX "inbound_messages_message_idx" ON "inbound_messages" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "inbound_messages_unassigned_idx" ON "inbound_messages" USING btree ("received_at") WHERE "inbound_messages"."status" = 'unassigned';--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_messages_reply_token_unique" ON "campaign_messages" USING btree ("reply_token") WHERE "campaign_messages"."reply_token" is not null;