CREATE TYPE "public"."item_billing" AS ENUM('recurring', 'once');--> statement-breakpoint
CREATE TYPE "public"."product_period" AS ENUM('month', 'year');--> statement-breakpoint
CREATE TABLE "pricing_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT 23 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"unit" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_price_items" (
	"product_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"included" integer DEFAULT 0 NOT NULL,
	"unit_price" numeric(10, 2),
	"unit_price_gross" numeric(10, 2),
	"max" integer,
	"billing" "item_billing" DEFAULT 'recurring' NOT NULL,
	"by_workload" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_price_items_product_id_item_id_pk" PRIMARY KEY("product_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "base_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "base_price_gross" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "period" "product_period" DEFAULT 'month' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "workload_step" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "product_price_items" ADD CONSTRAINT "product_price_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_price_items" ADD CONSTRAINT "product_price_items_item_id_product_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."product_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_items_name_unique" ON "product_items" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "product_price_items_item_idx" ON "product_price_items" USING btree ("item_id");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_workload_step" CHECK ("products"."workload_step" between 1 and 100);--> statement-breakpoint
-- Nastavenia › Ceny a DPH starts at the Slovak standard rate.
INSERT INTO "pricing_settings" ("id", "vat_rate") VALUES (1, 23) ON CONFLICT DO NOTHING;
