-- The one customer type every installation starts with (spec 4.1, D-3); more are added in
-- Settings › Číselníky. A fixed id, so the development seed can point at it.
INSERT INTO "customer_types" ("id", "name", "active", "position")
VALUES ('00000000-0000-4000-8000-0000000000a1', 'ADOS', true, 1)
ON CONFLICT DO NOTHING;
