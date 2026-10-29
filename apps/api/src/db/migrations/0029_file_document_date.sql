ALTER TABLE "file_versions" ADD COLUMN "document_date" date;--> statement-breakpoint
CREATE INDEX "file_versions_document_date_idx" ON "file_versions" USING btree ("document_date");--> statement-breakpoint
-- The versions so far are dated by the day they were uploaded (Bratislava time).
UPDATE "file_versions" SET "document_date" = ("created_at" AT TIME ZONE 'Europe/Bratislava')::date WHERE "document_date" IS NULL;
