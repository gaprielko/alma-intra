-- Runs once when the local Postgres volume is created (docker-compose) and in CI.
-- intra_admin (superuser here, owner in production) runs migrations.
-- intra_app is the runtime role: it owns nothing, so the privileges revoked from it hold
-- (the audit trail is append-only, migration 0001).
CREATE ROLE intra_app LOGIN PASSWORD 'intra' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE alma_intra TO intra_app;
GRANT USAGE ON SCHEMA public TO intra_app;
ALTER DEFAULT PRIVILEGES FOR ROLE intra_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO intra_app;
ALTER DEFAULT PRIVILEGES FOR ROLE intra_admin IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO intra_app;
