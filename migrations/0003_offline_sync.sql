-- v1.0.3: non-destructive columns for offline optimistic concurrency and approved deletions.
-- Apply this to the existing REMOTE D1 database before deploying the v1.0.3 Worker.
ALTER TABLE census ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE census ADD COLUMN deleted_at TEXT;
ALTER TABLE census ADD COLUMN deletion_requested INTEGER NOT NULL DEFAULT 0 CHECK(deletion_requested IN (0,1));
ALTER TABLE census ADD COLUMN last_mutation_id TEXT;
ALTER TABLE vaccinations ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE vaccinations ADD COLUMN deleted_at TEXT;
ALTER TABLE vaccinations ADD COLUMN deletion_requested INTEGER NOT NULL DEFAULT 0 CHECK(deletion_requested IN (0,1));
ALTER TABLE vaccinations ADD COLUMN last_mutation_id TEXT;
