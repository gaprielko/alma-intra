-- The company look starts with Alma's name, the general mailbox (D-17b) and its web; the rest is
-- filled in Settings › Vzhľad e-mailov. And the template categories of the designs.
INSERT INTO "email_look" ("id", "brand_name", "header_text", "footer_web", "footer_email")
VALUES (1, 'Alma', 'Domáca ošetrovateľská starostlivosť bez papierov', 'alma-care.eu', 'info@alma-care.eu')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "template_categories" ("name", "position")
SELECT name, position FROM (VALUES ('Ponuka', 1), ('Novinky', 2), ('Pozvánka', 3), ('Follow-up', 4)) AS v(name, position)
WHERE NOT EXISTS (SELECT 1 FROM "template_categories");
