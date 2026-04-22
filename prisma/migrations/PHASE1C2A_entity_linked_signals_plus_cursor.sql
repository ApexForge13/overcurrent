-- Phase 1c.2a migration: entity-linked signal rows + trigger cursor persistence.
--
-- Additive changes only:
--   1. RawSignalLayer.storyClusterId: NOT NULL → NULL (existing rows unaffected,
--      all already have values)
--   2. RawSignalLayer.entityId: new nullable column + FK to TrackedEntity
--   3. RawSignalQueue.storyClusterId: NOT NULL → NULL (same)
--   4. RawSignalQueue.entityId: new nullable column + FK to TrackedEntity
--   5. New TriggerCursor table
--   6. New indexes on entityId for both tables
--
-- Backward compatibility: existing legacy-pipeline rows keep their
-- storyClusterId values and pass entityId=NULL. Existing cluster-delete
-- cascade semantics preserved via ON DELETE CASCADE on the FK.

-- ── RawSignalLayer ──────────────────────────────────────────────────────
ALTER TABLE "RawSignalLayer" ALTER COLUMN "storyClusterId" DROP NOT NULL;

ALTER TABLE "RawSignalLayer" ADD COLUMN "entityId" TEXT;

ALTER TABLE "RawSignalLayer"
  ADD CONSTRAINT "RawSignalLayer_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "TrackedEntity"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "RawSignalLayer_entityId_idx" ON "RawSignalLayer"("entityId");

-- ── RawSignalQueue ──────────────────────────────────────────────────────
ALTER TABLE "RawSignalQueue" ALTER COLUMN "storyClusterId" DROP NOT NULL;

ALTER TABLE "RawSignalQueue" ADD COLUMN "entityId" TEXT;

ALTER TABLE "RawSignalQueue"
  ADD CONSTRAINT "RawSignalQueue_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "TrackedEntity"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "RawSignalQueue_entityId_idx" ON "RawSignalQueue"("entityId");

-- ── TriggerCursor (new) ─────────────────────────────────────────────────
CREATE TABLE "TriggerCursor" (
    "id" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "cursorType" TEXT NOT NULL,
    "cursorValue" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TriggerCursor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TriggerCursor_triggerId_cursorType_key"
  ON "TriggerCursor"("triggerId", "cursorType");

CREATE INDEX "TriggerCursor_triggerId_idx" ON "TriggerCursor"("triggerId");
