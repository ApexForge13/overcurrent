-- ═══════════════════════════════════════════════════════════════════════════
-- Session 4 Step 5 — StoryCluster.adminNotes standing editorial note
--
-- Persistent per-cluster editorial guidance that survives analysis re-runs.
-- Read by the quality review agent and injected into the verdict prompt so
-- future runs on the cluster are scored against cluster-specific rules
-- (e.g. "never claim zero coverage universally — specialist press exists").
--
-- Null for most clusters. Admin sets it when a repeat kill pattern is
-- identified, to prevent the pipeline from fighting the same battle.
-- ═══════════════════════════════════════════════════════════════════════════

-- AlterTable
ALTER TABLE "StoryCluster" ADD COLUMN     "adminNotes" TEXT;
