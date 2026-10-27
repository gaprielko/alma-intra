CREATE TABLE "customer_products" (
	"customer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	CONSTRAINT "customer_products_customer_id_product_id_pk" PRIMARY KEY("customer_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_products" ADD CONSTRAINT "customer_products_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_products" ADD CONSTRAINT "customer_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_products_product_idx" ON "customer_products" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_name_unique" ON "products" USING btree (lower("name"));--> statement-breakpoint
-- The customer types become products, ids kept (the audit trail names them by id), and a record's
-- one type becomes its first product. DOS and Stacionár join ADOS.
INSERT INTO "products" ("id", "name", "active", "position", "created_at")
SELECT "id", "name", "active", "position", "created_at" FROM "customer_types";
--> statement-breakpoint
INSERT INTO "products" ("name", "position")
SELECT v.name, (SELECT coalesce(max("position"), 0) FROM "products") + v.n
FROM (VALUES ('DOS', 1), ('Stacionár', 2)) AS v(name, n)
WHERE NOT EXISTS (SELECT 1 FROM "products" p WHERE lower(p."name") = lower(v.name));
--> statement-breakpoint
INSERT INTO "customer_products" ("customer_id", "product_id")
SELECT "id", "type_id" FROM "customers" WHERE "type_id" IS NOT NULL;
