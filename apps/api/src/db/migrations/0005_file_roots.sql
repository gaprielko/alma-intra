-- The roots of the Files module (spec 7.1): „Firemné dokumenty“ with a fixed id the web and the
-- seed point at, and a folder for every customer that exists already (new customers get theirs
-- when they are created).
INSERT INTO "folders" ("id", "name")
VALUES ('00000000-0000-4000-8000-0000000000f0', 'Firemné dokumenty')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "folders" ("customer_id")
SELECT "id" FROM "customers"
WHERE NOT EXISTS (
  SELECT 1 FROM "folders" f WHERE f."customer_id" = "customers"."id" AND f."parent_id" IS NULL
);
