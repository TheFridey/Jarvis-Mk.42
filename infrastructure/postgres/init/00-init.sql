-- Runs once on first container start (empty data dir).
-- Schemas + roles are created here; table DDL is owned by Drizzle migrations
-- (@jarvis/persistence), per ADR-0003.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- One schema per Kernel domain. Cross-schema access is forbidden by convention
-- now and by per-role grants once the service split happens (DATA_OWNERSHIP.md).
CREATE SCHEMA IF NOT EXISTS events;
CREATE SCHEMA IF NOT EXISTS projections;
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS session;
CREATE SCHEMA IF NOT EXISTS scheduler;
CREATE SCHEMA IF NOT EXISTS audit;

-- A dedicated migration/runtime role separate from the superuser.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'jarvis_app') THEN
    CREATE ROLE jarvis_app LOGIN PASSWORD 'jarvis';
  END IF;
END
$$;

GRANT ALL ON SCHEMA events, projections, identity, session, scheduler, audit TO jarvis_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA events, projections, identity, session, scheduler, audit
  GRANT ALL ON TABLES TO jarvis_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA events, projections, identity, session, scheduler, audit
  GRANT ALL ON SEQUENCES TO jarvis_app;
