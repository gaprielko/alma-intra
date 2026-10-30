CREATE TYPE "public"."lead_activity_source" AS ENUM('email', 'app');--> statement-breakpoint
CREATE TABLE "activity_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"confirm_label" text,
	"asks_product" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "app_feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"what_doing" text NOT NULL,
	"expected" text DEFAULT '' NOT NULL,
	"reporter_user_id" uuid,
	"reporter_name" text NOT NULL,
	"reporter_email" text NOT NULL,
	"reporter_role" text,
	"source_organization_id" uuid NOT NULL,
	"source_organization_name" text,
	"app" jsonb NOT NULL,
	"device" jsonb NOT NULL,
	"place" jsonb,
	"trail" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"api_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending_sync" integer,
	"screenshot_key" text,
	"sent_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_feedback_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"feedback_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text,
	"works" boolean,
	"status_after" text,
	"resolved_event_id" text,
	"sent_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_activities" ALTER COLUMN "type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_activities" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_activities" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
-- The seeded types; the app relies on these ids (docs/activity-types.md).
INSERT INTO "activity_types" ("id", "name", "confirm_label", "asks_product", "position") VALUES
  ('00000000-0000-4000-8000-0000000000b1', 'Záujem o produkt', 'Áno, mám vážny záujem', true, 1),
  ('00000000-0000-4000-8000-0000000000b2', 'Podnet', NULL, false, 2);--> statement-breakpoint
ALTER TABLE "lead_activities" ADD COLUMN "type_id" uuid;--> statement-breakpoint
UPDATE "lead_activities" SET "type_id" = '00000000-0000-4000-8000-0000000000b1';--> statement-breakpoint
ALTER TABLE "lead_activities" ALTER COLUMN "type_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD COLUMN "source" "lead_activity_source" DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD COLUMN "app_feedback_id" uuid;--> statement-breakpoint
ALTER TABLE "app_feedback_events" ADD CONSTRAINT "app_feedback_events_feedback_id_app_feedback_id_fk" FOREIGN KEY ("feedback_id") REFERENCES "public"."app_feedback"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_feedback_events_feedback_idx" ON "app_feedback_events" USING btree ("feedback_id");--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_type_id_activity_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."activity_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_app_feedback_id_app_feedback_id_fk" FOREIGN KEY ("app_feedback_id") REFERENCES "public"."app_feedback"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_app_feedback_id_unique" UNIQUE("app_feedback_id");