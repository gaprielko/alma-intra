CREATE TYPE "public"."product_item_kind" AS ENUM('role', 'other');--> statement-breakpoint
ALTER TABLE "product_items" ADD COLUMN "kind" "product_item_kind" DEFAULT 'role' NOT NULL;--> statement-breakpoint
ALTER TABLE "product_items" ADD COLUMN "apps" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- R-20, R-21: an item paid only once in all its price lists is no role; the others are roles whose
-- application is not known, so they start with the web one, to be corrected by hand.
UPDATE "product_items" i SET "kind" = 'other'
WHERE EXISTS (SELECT 1 FROM "product_price_items" p WHERE p."item_id" = i."id")
  AND NOT EXISTS (SELECT 1 FROM "product_price_items" p WHERE p."item_id" = i."id" AND p."billing" <> 'once');--> statement-breakpoint
UPDATE "product_items" SET "apps" = ARRAY['web'] WHERE "kind" = 'role';--> statement-breakpoint
ALTER TABLE "product_items" ADD CONSTRAINT "product_items_apps" CHECK (("product_items"."kind" = 'role' and cardinality("product_items"."apps") > 0) or ("product_items"."kind" = 'other' and cardinality("product_items"."apps") = 0));