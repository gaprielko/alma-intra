CREATE TYPE "public"."customer_kind" AS ENUM('organization', 'individual');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('lead', 'contacted', 'interested', 'customer', 'former_customer', 'not_interested');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('ok', 'bounced', 'complained');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TYPE "public"."region" AS ENUM('bratislava', 'trnava', 'trencin', 'nitra', 'zilina', 'banska_bystrica', 'presov', 'kosice');--> statement-breakpoint
CREATE TYPE "public"."unsubscribe_source" AS ENUM('manual', 'link');--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"title_before" text,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"title_after" text,
	"gender" "gender",
	"salutation" text,
	"position" text,
	"email" text,
	"phone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"email_status" "email_status" DEFAULT 'ok' NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"unsubscribe_source" "unsubscribe_source",
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "customer_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_tags" (
	"customer_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "customer_tags_customer_id_tag_id_pk" PRIMARY KEY("customer_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "customer_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "customer_kind" NOT NULL,
	"type_id" uuid,
	"name" text NOT NULL,
	"ico" text,
	"dic" text,
	"ic_dph" text,
	"status" "customer_status" DEFAULT 'lead' NOT NULL,
	"street" text,
	"postal_code" text,
	"city" text,
	"region" "region",
	"web" text,
	"email" text,
	"phone" text,
	"owner_user_id" uuid,
	"source_id" uuid,
	"note" text,
	"alma_organization_id" text,
	"title_before" text,
	"first_name" text,
	"last_name" text,
	"title_after" text,
	"gender" "gender",
	"salutation" text,
	"email_status" "email_status" DEFAULT 'ok' NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"unsubscribe_source" "unsubscribe_source",
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "customers_name_length" CHECK (char_length("customers"."name") between 1 and 200),
	CONSTRAINT "customers_person_named" CHECK ("customers"."kind" = 'organization' or ("customers"."first_name" is not null and "customers"."last_name" is not null))
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_type_id_customer_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."customer_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_source_id_customer_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."customer_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_customer_idx" ON "contacts" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_primary_unique" ON "contacts" USING btree ("customer_id") WHERE "contacts"."is_primary" and "contacts"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_email_unique" ON "contacts" USING btree ("customer_id",lower("email")) WHERE "contacts"."deleted_at" is null and "contacts"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_sources_name_unique" ON "customer_sources" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "customer_tags_tag_idx" ON "customer_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_types_name_unique" ON "customer_types" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "customers_ico_unique" ON "customers" USING btree ("ico") WHERE "customers"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "customers_status_idx" ON "customers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "customers_type_idx" ON "customers" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "customers_owner_idx" ON "customers" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_unique" ON "tags" USING btree (lower("name"));