-- Customers and partners have a role (0027); the contact types go (docs/contacts-redesign.md,
-- stage O4). A partner's type (Dodávateľ, Spolupracovník, …) becomes a tag of the same name (D-4);
-- a partner has no status and no owner (D-10, the history of changes keeps them).
INSERT INTO "tags" ("name")
SELECT DISTINCT t."name" FROM "contact_types" t JOIN "organizations" o ON o."contact_type_id" = t."id"
WHERE t."system_key" IS DISTINCT FROM 'customer'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "organization_tags" ("organization_id", "tag_id")
SELECT o."id", g."id" FROM "organizations" o
JOIN "contact_types" t ON t."id" = o."contact_type_id"
JOIN "tags" g ON lower(g."name") = lower(t."name")
WHERE t."system_key" IS DISTINCT FROM 'customer'
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "organizations" SET "status" = NULL, "owner_user_id" = NULL WHERE "role" = 'partner';--> statement-breakpoint
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_contact_type_id_contact_types_id_fk";--> statement-breakpoint
DROP INDEX "organizations_contact_type_idx";--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "contact_type_id";--> statement-breakpoint
DROP TABLE "contact_types";
