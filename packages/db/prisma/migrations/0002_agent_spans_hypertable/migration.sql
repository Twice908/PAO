-- Convert AgentSpan into a TimescaleDB hypertable partitioned on startedAt.
-- The previous migration (0001_init) must have already created the "AgentSpan"
-- table before this runs. The composite PK @@id([id, startedAt]) satisfies
-- TimescaleDB's requirement that the partition column appear in all unique
-- constraints.
--
-- Requires the timescaledb extension. If it is not yet enabled on the database,
-- run once as a superuser: CREATE EXTENSION IF NOT EXISTS timescaledb;
--
-- Not all Postgres instances ship with TimescaleDB (e.g. Railway's managed
-- Postgres does not), so this is skipped entirely when the extension isn't
-- installed. AgentSpan remains a regular table in that case.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('"AgentSpan"', 'startedAt', if_not_exists => TRUE);
  END IF;
END $$;

-- Composite indexes for time-range scans per run and per project.
-- Prisma's migration already creates these without DESC; IF NOT EXISTS is a
-- no-op here but keeps the migration idempotent on re-deploy.
CREATE INDEX IF NOT EXISTS "AgentSpan_runId_startedAt_idx"
  ON "AgentSpan" ("runId", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS "AgentSpan_projectId_startedAt_idx"
  ON "AgentSpan" ("projectId", "startedAt" DESC);
