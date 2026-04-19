-- ═══════════════════════════════════════════════════════════════════════════
-- Session 3 · Step 6 — Arc completeness + predictive signal integration
--
-- 1. Adds StoryCluster.canonicalSignalCategory — admin-curated signal category
--    that survives auto-reclassification passes. Defaults to NULL; compute
--    falls back to signalCategory when canonical is unset.
--
-- 2. Adds StoryCluster.arcCompleteness — denormalized cache of the arc
--    quality level ('complete' | 'partial' | 'first_wave_only' | 'incomplete').
--    Recomputed by the signal tracker whenever a new analysis lands in the
--    cluster. Nullable for clusters that have no new_arc story (one-offs /
--    standalones live in their own clusters with arcCompleteness = NULL).
--
-- 3. Adds PredictiveSignal.contributingArcsBreakdown — JSON payload with
--    per-quality-level arc counts, UmbrellaArc ids of contributing arcs, and
--    skipped-phase count. Feeds the data-quality banner in the admin UI.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "StoryCluster"
  ADD COLUMN "canonicalSignalCategory"    TEXT,
  ADD COLUMN "arcCompleteness"            TEXT,
  ADD COLUMN "arcCompletenessComputedAt"  TIMESTAMP(3);

CREATE INDEX "StoryCluster_canonicalSignalCategory_idx"
  ON "StoryCluster"("canonicalSignalCategory");
CREATE INDEX "StoryCluster_arcCompleteness_idx"
  ON "StoryCluster"("arcCompleteness");

ALTER TABLE "PredictiveSignal"
  ADD COLUMN "contributingArcsBreakdown" TEXT;
