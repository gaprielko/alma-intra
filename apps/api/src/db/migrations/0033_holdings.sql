CREATE TYPE "public"."product_pricing" AS ENUM('list', 'discount', 'fixed');--> statement-breakpoint
CREATE TABLE "organization_product_counts" (
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "organization_product_counts_organization_id_product_id_item_id_pk" PRIMARY KEY("organization_id","product_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "organization_product_workloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"persons" integer NOT NULL,
	"percent" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_products" ADD COLUMN "valid_from" date DEFAULT current_date NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_products" ADD COLUMN "valid_to" date;--> statement-breakpoint
ALTER TABLE "organization_products" ADD COLUMN "pricing" "product_pricing" DEFAULT 'list' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_products" ADD COLUMN "discount_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "organization_products" ADD COLUMN "discount_months" integer;--> statement-breakpoint
ALTER TABLE "organization_products" ADD COLUMN "fixed_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "organization_products" ADD COLUMN "fixed_price_gross" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "organization_products" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "organization_products" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_product_counts" ADD CONSTRAINT "organization_product_counts_item_id_product_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."product_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_product_counts" ADD CONSTRAINT "organization_product_counts_holding_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."organization_products"("organization_id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_product_workloads" ADD CONSTRAINT "organization_product_workloads_item_id_product_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."product_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_product_workloads" ADD CONSTRAINT "organization_product_workloads_holding_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."organization_products"("organization_id","product_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_product_workloads_holding_idx" ON "organization_product_workloads" USING btree ("organization_id","product_id");