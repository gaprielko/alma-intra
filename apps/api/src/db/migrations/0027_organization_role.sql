CREATE TYPE "public"."organization_role" AS ENUM('customer', 'partner');--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "role" "organization_role";--> statement-breakpoint
-- A record of the contact type „Zákazník“ is a customer, any other a partner (stage O2).
UPDATE "organizations" SET "role" = CASE WHEN "contact_type_id" IN (
  SELECT "id" FROM "contact_types" WHERE "system_key" = 'customer') THEN 'customer' ELSE 'partner' END::"organization_role";--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "role" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "organizations_role_idx" ON "organizations" USING btree ("role");