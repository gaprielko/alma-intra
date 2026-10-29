CREATE TABLE "contact_links" (
	"contact_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"position" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_links_contact_id_organization_id_pk" PRIMARY KEY("contact_id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_person_named";--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_organization_id_organizations_id_fk";
--> statement-breakpoint
DROP INDEX "contacts_organization_idx";--> statement-breakpoint
DROP INDEX "contacts_primary_unique";--> statement-breakpoint
DROP INDEX "contacts_email_unique";--> statement-breakpoint
ALTER TABLE "contact_links" ADD CONSTRAINT "contact_links_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_links" ADD CONSTRAINT "contact_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_links_organization_idx" ON "contact_links" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_links_primary_unique" ON "contact_links" USING btree ("organization_id") WHERE "contact_links"."is_primary";--> statement-breakpoint
-- Data (docs/contacts-redesign.md, stage O2). 1. Today's persons keep their one organization.
INSERT INTO "contact_links" ("contact_id", "organization_id", "position", "is_primary", "created_at")
SELECT "id", "organization_id", "position", "is_primary" AND "deleted_at" IS NULL, "created_at" FROM "contacts";--> statement-breakpoint
-- 2. A private person becomes a person of its own, the primary contact of its record; the e-mails
-- sent to it and received from it now name that person.
ALTER TABLE "contacts" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "individual_of" uuid;--> statement-breakpoint
INSERT INTO "contacts" ("title_before", "first_name", "last_name", "title_after", "gender", "salutation", "email", "phone", "email_status", "unsubscribed_at", "unsubscribe_source", "created_at", "updated_at", "deleted_at", "individual_of")
SELECT "title_before", "first_name", "last_name", "title_after", "gender", "salutation", "email", "phone", "email_status", "unsubscribed_at", "unsubscribe_source", "created_at", "updated_at", "deleted_at", "id"
FROM "organizations" WHERE "kind" = 'individual';--> statement-breakpoint
INSERT INTO "contact_links" ("contact_id", "organization_id", "is_primary", "created_at")
SELECT "id", "individual_of", true, "created_at" FROM "contacts" WHERE "individual_of" IS NOT NULL;--> statement-breakpoint
UPDATE "campaign_messages" m SET "contact_id" = c."id" FROM "contacts" c
WHERE c."individual_of" = m."organization_id" AND m."contact_id" IS NULL;--> statement-breakpoint
UPDATE "inbound_messages" i SET "contact_id" = c."id" FROM "contacts" c
WHERE c."individual_of" = i."organization_id" AND i."contact_id" IS NULL;--> statement-breakpoint
UPDATE "organizations" SET "email" = NULL, "phone" = NULL WHERE "kind" = 'individual';--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "individual_of";--> statement-breakpoint
-- 3. One person per e-mail (D-7): live persons sharing an address merge into the oldest of them,
-- which takes over their organizations, activities and e-mails; the others are soft deleted.
CREATE TABLE "contact_merge" AS
SELECT c."id" AS "dup", k."id" AS "keep" FROM "contacts" c
JOIN LATERAL (
  SELECT k."id" FROM "contacts" k
  WHERE k."deleted_at" IS NULL AND lower(k."email") = lower(c."email")
  ORDER BY k."created_at", k."id" LIMIT 1
) k ON true
WHERE c."deleted_at" IS NULL AND c."email" IS NOT NULL AND k."id" <> c."id";--> statement-breakpoint
CREATE TABLE "contact_merge_primary" AS
SELECT m."keep", l."organization_id" FROM "contact_links" l JOIN "contact_merge" m ON m."dup" = l."contact_id"
WHERE l."is_primary";--> statement-breakpoint
INSERT INTO "contact_links" ("contact_id", "organization_id", "position", "is_primary", "created_at")
SELECT m."keep", l."organization_id", l."position", false, l."created_at"
FROM "contact_links" l JOIN "contact_merge" m ON m."dup" = l."contact_id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
DELETE FROM "contact_links" WHERE "contact_id" IN (SELECT "dup" FROM "contact_merge");--> statement-breakpoint
UPDATE "contact_links" l SET "is_primary" = true FROM "contact_merge_primary" p
WHERE l."contact_id" = p."keep" AND l."organization_id" = p."organization_id"
AND NOT EXISTS (SELECT 1 FROM "contact_links" o WHERE o."organization_id" = p."organization_id" AND o."is_primary");--> statement-breakpoint
DELETE FROM "activity_participants" a USING "contact_merge" m
WHERE a."contact_id" = m."dup" AND EXISTS (
  SELECT 1 FROM "activity_participants" b WHERE b."activity_id" = a."activity_id" AND b."contact_id" = m."keep");--> statement-breakpoint
UPDATE "activity_participants" a SET "contact_id" = m."keep" FROM "contact_merge" m WHERE a."contact_id" = m."dup";--> statement-breakpoint
UPDATE "campaign_messages" c SET "contact_id" = m."keep" FROM "contact_merge" m
WHERE c."contact_id" = m."dup" AND NOT EXISTS (
  SELECT 1 FROM "campaign_messages" o WHERE o."campaign_id" = c."campaign_id"
  AND o."organization_id" = c."organization_id" AND o."contact_id" = m."keep");--> statement-breakpoint
UPDATE "inbound_messages" i SET "contact_id" = m."keep" FROM "contact_merge" m WHERE i."contact_id" = m."dup";--> statement-breakpoint
UPDATE "contacts" SET "deleted_at" = now() WHERE "id" IN (SELECT "dup" FROM "contact_merge");--> statement-breakpoint
DROP TABLE "contact_merge_primary";--> statement-breakpoint
DROP TABLE "contact_merge";--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_email_unique" ON "contacts" USING btree (lower("email")) WHERE "contacts"."deleted_at" is null and "contacts"."email" is not null;--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "organization_id";--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "position";--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "is_primary";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "title_before";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "first_name";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "last_name";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "title_after";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "gender";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "salutation";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "email_status";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "unsubscribed_at";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "unsubscribe_source";