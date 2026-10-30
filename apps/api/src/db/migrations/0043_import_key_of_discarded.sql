-- A discarded imported e-mail no longer blocks adding the same original again. Only rows a user
-- discarded: an imported e-mail that went to „Odoslané“ is also discarded here, with its
-- organization set, and keeps its key because it still exists there.
UPDATE "inbound_messages"
SET "import_key" = NULL
WHERE "status" = 'discarded'
  AND "import_key" IS NOT NULL
  AND ("import_direction" = 'received' OR "organization_id" IS NULL);
