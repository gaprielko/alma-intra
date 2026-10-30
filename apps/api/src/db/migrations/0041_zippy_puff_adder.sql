CREATE TABLE "product_email_looks" (
	"product_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"logo_key" text,
	"header_style" text DEFAULT 'dark' NOT NULL,
	"brand_name" text DEFAULT 'Alma' NOT NULL,
	"header_text" text DEFAULT '' NOT NULL,
	"accent" text DEFAULT '#0f766e' NOT NULL,
	"footer_web" text DEFAULT '' NOT NULL,
	"footer_email" text DEFAULT '' NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "look_product_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "look_product_id" uuid;--> statement-breakpoint
ALTER TABLE "product_email_looks" ADD CONSTRAINT "product_email_looks_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_email_looks" ADD CONSTRAINT "product_email_looks_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_look_product_id_products_id_fk" FOREIGN KEY ("look_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_look_product_id_products_id_fk" FOREIGN KEY ("look_product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "product_email_looks" ("product_id", "enabled", "logo_key", "header_style", "brand_name", "header_text", "accent", "footer_web", "footer_email")
  SELECT p."id", true, l."logo_key", COALESCE(l."header_style", 'dark'), COALESCE(l."brand_name", 'Alma') || ' ADOS', COALESCE(l."header_text", ''), COALESCE(l."accent", '#0f766e'), COALESCE(l."footer_web", ''), COALESCE(l."footer_email", '')
  FROM "products" p LEFT JOIN "email_look" l ON l."id" = 1
  WHERE lower(p."name") = 'ados';
