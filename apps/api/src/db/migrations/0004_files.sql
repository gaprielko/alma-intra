CREATE TYPE "public"."file_version_source" AS ENUM('web', 'mcp', 'generated', 'inbound');--> statement-breakpoint
CREATE TYPE "public"."file_version_status" AS ENUM('pending', 'uploaded');--> statement-breakpoint
CREATE TABLE "file_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"number" integer,
	"status" "file_version_status" DEFAULT 'pending' NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"note" text,
	"created_via" "file_version_source" DEFAULT 'web' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folder_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"current_version_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" uuid,
	CONSTRAINT "files_name_length" CHECK (char_length("files"."name") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"customer_id" uuid,
	"name" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folders_named" CHECK (("folders"."parent_id" is null and "folders"."customer_id" is not null and "folders"."name" is null) or "folders"."name" is not null)
);
--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_versions_file_idx" ON "file_versions" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_versions_number_unique" ON "file_versions" USING btree ("file_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "file_versions_key_unique" ON "file_versions" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "files_folder_idx" ON "files" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "files_deleted_idx" ON "files" USING btree ("deleted_at") WHERE "files"."deleted_at" is not null;--> statement-breakpoint
CREATE INDEX "folders_parent_idx" ON "folders" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "folders_customer_idx" ON "folders" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "folders_customer_root_unique" ON "folders" USING btree ("customer_id") WHERE "folders"."parent_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "folders_company_root_unique" ON "folders" USING btree (("parent_id" is null)) WHERE "folders"."parent_id" is null and "folders"."customer_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "folders_name_unique" ON "folders" USING btree ("parent_id",lower("name")) WHERE "folders"."parent_id" is not null;