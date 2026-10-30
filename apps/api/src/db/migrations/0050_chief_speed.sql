DROP INDEX "lead_activities_one_alive";--> statement-breakpoint
CREATE UNIQUE INDEX "lead_activities_one_from_email" ON "lead_activities" USING btree ("type_id","organization_id",coalesce("contact_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("product_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "lead_activities"."deleted_at" is null and "lead_activities"."source" = 'email';--> statement-breakpoint
ALTER TABLE "lead_activities" DROP COLUMN "type";--> statement-breakpoint
DROP TYPE "public"."lead_activity_type";