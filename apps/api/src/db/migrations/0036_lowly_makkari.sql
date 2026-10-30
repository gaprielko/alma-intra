ALTER TABLE "organization_products" ADD COLUMN "discount_steps" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "organization_products"
  SET "discount_steps" = jsonb_build_array(jsonb_build_object('percent', "discount_percent", 'months', "discount_months"))
  WHERE "discount_percent" IS NOT NULL;
