-- The audit trail is append-only: the runtime role may insert and read, never change or remove.
-- The role is created by apps/api/db/init/01-roles.sql locally and in CI, and by the runbook in
-- every other environment, before the first migration.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_events" FROM intra_app;
