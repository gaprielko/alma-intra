CREATE TABLE "company_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"ico" text DEFAULT '' NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_settings_single_row" CHECK ("company_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "email_looks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"product_id" uuid,
	"enabled" boolean DEFAULT false NOT NULL,
	"logo_key" text,
	"header_style" text DEFAULT 'dark' NOT NULL,
	"brand_name" text DEFAULT 'Alma' NOT NULL,
	"header_doc" jsonb,
	"sender_name_doc" jsonb,
	"signature_doc" jsonb,
	"footer_doc" jsonb,
	"accent" text DEFAULT '#0f766e' NOT NULL,
	"footer_web" text DEFAULT '' NOT NULL,
	"footer_email" text DEFAULT '' NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_looks_kind_product_unique" UNIQUE NULLS NOT DISTINCT("kind","product_id")
);
--> statement-breakpoint
CREATE TABLE "email_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"reply_mode" text DEFAULT 'company' NOT NULL,
	"reply_to_address" text DEFAULT 'info@alma-care.eu' NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_settings_single_row" CHECK ("email_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "look_kind" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "look_kind" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_looks" ADD CONSTRAINT "email_looks_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_looks" ADD CONSTRAINT "email_looks_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_settings" ADD CONSTRAINT "email_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- What was one look becomes the same look for both types of e-mail (D-57): what has been sent so far stays personal.
INSERT INTO "company_settings" ("id", "name", "ico")
SELECT 1, "footer_company", "footer_ico" FROM "email_look";--> statement-breakpoint
INSERT INTO "email_settings" ("id", "reply_mode", "reply_to_address")
SELECT 1, "reply_mode", "reply_to_address" FROM "email_look";--> statement-breakpoint
INSERT INTO "email_looks" ("kind", "product_id", "enabled", "logo_key", "header_style", "brand_name", "header_doc", "sender_name_doc", "accent", "footer_web", "footer_email", "updated_by_user_id", "updated_at")
SELECT k."kind", NULL, true, l."logo_key", l."header_style", l."brand_name", l."header_doc", l."sender_name_doc", l."accent", l."footer_web", l."footer_email", l."updated_by_user_id", l."updated_at"
FROM "email_look" l CROSS JOIN (VALUES ('personal'), ('team')) AS k("kind");--> statement-breakpoint
INSERT INTO "email_looks" ("kind", "product_id", "enabled", "logo_key", "header_style", "brand_name", "header_doc", "sender_name_doc", "accent", "footer_web", "footer_email", "updated_by_user_id", "updated_at")
SELECT k."kind", p."product_id", p."enabled", p."logo_key", p."header_style", p."brand_name", p."header_doc", p."sender_name_doc", p."accent", p."footer_web", p."footer_email", p."updated_by_user_id", p."updated_at"
FROM "product_email_looks" p CROSS JOIN (VALUES ('personal'), ('team')) AS k("kind");
