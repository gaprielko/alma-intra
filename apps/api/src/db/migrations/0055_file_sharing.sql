CREATE TYPE "public"."file_change_decision" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."file_change_kind" AS ENUM('edited', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."file_draft_state" AS ENUM('waiting', 'merged', 'finished', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."file_share_mode" AS ENUM('read', 'comment', 'edit');--> statement-breakpoint
ALTER TYPE "public"."file_version_source" ADD VALUE 'share';--> statement-breakpoint
ALTER TYPE "public"."lead_activity_source" ADD VALUE 'share';--> statement-breakpoint
CREATE TABLE "file_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"parent_id" uuid,
	"anchor" jsonb,
	"body" text NOT NULL,
	"visitor_id" uuid,
	"user_id" uuid,
	"session_id" uuid,
	"author_name" text NOT NULL,
	"agreed_at" timestamp with time zone,
	"agreed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "file_draft_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"block" integer NOT NULL,
	"kind" "file_change_kind" NOT NULL,
	"old_html" text NOT NULL,
	"new_html" text,
	"author_name" text NOT NULL,
	"decision" "file_change_decision" DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "file_draft_comments" (
	"draft_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	CONSTRAINT "file_draft_comments_draft_id_comment_id_pk" PRIMARY KEY("draft_id","comment_id")
);
--> statement-breakpoint
CREATE TABLE "file_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"base_version_id" uuid NOT NULL,
	"visitor_id" uuid,
	"session_id" uuid,
	"author_names" text[] NOT NULL,
	"state" "file_draft_state" DEFAULT 'waiting' NOT NULL,
	"merged_into_id" uuid,
	"version_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "file_share_visitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"share_id" uuid,
	"name" text NOT NULL,
	"device_token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_encrypted" text NOT NULL,
	"mode" "file_share_mode" DEFAULT 'read' NOT NULL,
	"password_hash" text,
	"password_generation" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_shares_password_required" CHECK ("file_shares"."mode" = 'read' or "file_shares"."password_hash" is not null)
);
--> statement-breakpoint
ALTER TABLE "file_versions" ADD COLUMN "external_author" text;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD COLUMN "file_draft_id" uuid;--> statement-breakpoint
ALTER TABLE "file_comments" ADD CONSTRAINT "file_comments_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_comments" ADD CONSTRAINT "file_comments_version_id_file_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."file_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_comments" ADD CONSTRAINT "file_comments_parent_id_file_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."file_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_comments" ADD CONSTRAINT "file_comments_visitor_id_file_share_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."file_share_visitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_comments" ADD CONSTRAINT "file_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_comments" ADD CONSTRAINT "file_comments_agreed_by_user_id_users_id_fk" FOREIGN KEY ("agreed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_draft_changes" ADD CONSTRAINT "file_draft_changes_draft_id_file_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."file_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_draft_changes" ADD CONSTRAINT "file_draft_changes_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_draft_comments" ADD CONSTRAINT "file_draft_comments_draft_id_file_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."file_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_draft_comments" ADD CONSTRAINT "file_draft_comments_comment_id_file_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."file_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_drafts" ADD CONSTRAINT "file_drafts_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_drafts" ADD CONSTRAINT "file_drafts_base_version_id_file_versions_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "public"."file_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_drafts" ADD CONSTRAINT "file_drafts_visitor_id_file_share_visitors_id_fk" FOREIGN KEY ("visitor_id") REFERENCES "public"."file_share_visitors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_drafts" ADD CONSTRAINT "file_drafts_merged_into_id_file_drafts_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."file_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_drafts" ADD CONSTRAINT "file_drafts_version_id_file_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."file_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_drafts" ADD CONSTRAINT "file_drafts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_share_visitors" ADD CONSTRAINT "file_share_visitors_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_share_visitors" ADD CONSTRAINT "file_share_visitors_share_id_file_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."file_shares"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_shares" ADD CONSTRAINT "file_shares_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_shares" ADD CONSTRAINT "file_shares_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_comments_file_idx" ON "file_comments" USING btree ("file_id","created_at");--> statement-breakpoint
CREATE INDEX "file_comments_parent_idx" ON "file_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "file_draft_changes_draft_idx" ON "file_draft_changes" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "file_drafts_file_idx" ON "file_drafts" USING btree ("file_id","created_at");--> statement-breakpoint
CREATE INDEX "file_drafts_session_idx" ON "file_drafts" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_share_visitors_device_unique" ON "file_share_visitors" USING btree ("device_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "file_shares_file_unique" ON "file_shares" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_shares_token_unique" ON "file_shares" USING btree ("token_hash");--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_file_draft_id_file_drafts_id_fk" FOREIGN KEY ("file_draft_id") REFERENCES "public"."file_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "activity_types" ("id", "name", "confirm_label", "asks_product", "position") VALUES
  ('00000000-0000-4000-8000-0000000000b3', 'Zmena dokumentu', NULL, false, 3);
