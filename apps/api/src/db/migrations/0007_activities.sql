CREATE TYPE "public"."activity_kind" AS ENUM('call', 'meeting', 'video_call', 'note');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" "activity_kind" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"duration_min" integer,
	"subject" text,
	"body" jsonb,
	"body_text" text,
	"next_step_text" text,
	"next_step_due" date,
	"next_step_user_id" uuid,
	"next_step_done_at" timestamp with time zone,
	"next_step_done_by_user_id" uuid,
	"author_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "activities_duration_positive" CHECK ("activities"."duration_min" is null or "activities"."duration_min" between 1 and 1440)
);
--> statement-breakpoint
CREATE TABLE "activity_attachments" (
	"activity_id" uuid NOT NULL,
	"file_version_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "activity_attachments_activity_id_file_version_id_pk" PRIMARY KEY("activity_id","file_version_id")
);
--> statement-breakpoint
CREATE TABLE "activity_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"contact_id" uuid,
	"user_id" uuid,
	CONSTRAINT "activity_participants_one" CHECK (("activity_participants"."contact_id" is null) <> ("activity_participants"."user_id" is null))
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_next_step_user_id_users_id_fk" FOREIGN KEY ("next_step_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_next_step_done_by_user_id_users_id_fk" FOREIGN KEY ("next_step_done_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_attachments" ADD CONSTRAINT "activity_attachments_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_attachments" ADD CONSTRAINT "activity_attachments_file_version_id_file_versions_id_fk" FOREIGN KEY ("file_version_id") REFERENCES "public"."file_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_participants" ADD CONSTRAINT "activity_participants_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_participants" ADD CONSTRAINT "activity_participants_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_participants" ADD CONSTRAINT "activity_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_customer_idx" ON "activities" USING btree ("customer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activities_next_step_idx" ON "activities" USING btree ("next_step_user_id","next_step_due") WHERE "activities"."next_step_text" is not null and "activities"."next_step_done_at" is null and "activities"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "activity_attachments_version_idx" ON "activity_attachments" USING btree ("file_version_id");--> statement-breakpoint
CREATE INDEX "activity_participants_activity_idx" ON "activity_participants" USING btree ("activity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_participants_contact_unique" ON "activity_participants" USING btree ("activity_id","contact_id") WHERE "activity_participants"."contact_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_participants_user_unique" ON "activity_participants" USING btree ("activity_id","user_id") WHERE "activity_participants"."user_id" is not null;