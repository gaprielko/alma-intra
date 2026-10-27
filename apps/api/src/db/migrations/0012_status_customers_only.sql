ALTER TABLE "customers" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "status" DROP NOT NULL;--> statement-breakpoint
-- Only a „Zákazník“ has a sales status: the other types lose theirs; customers keep what they have.
UPDATE "customers" SET "status" = NULL
WHERE "contact_type_id" NOT IN (SELECT "id" FROM "contact_types" WHERE "system_key" = 'customer');
