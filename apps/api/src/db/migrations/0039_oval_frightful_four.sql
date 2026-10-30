ALTER TABLE "users" ADD COLUMN "import_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "email_look" ADD COLUMN "import_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "import_key" text;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "import_direction" text;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "import_user_id" uuid;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_import_user_id_users_id_fk" FOREIGN KEY ("import_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_messages_import_key_unique" ON "inbound_messages" USING btree ("import_key") WHERE "inbound_messages"."import_key" is not null;