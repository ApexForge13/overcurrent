-- ═══════════════════════════════════════════════════════════════════════════
-- Session 3 · Step 4 — Arc Advancement Scan
--
-- Lightweight Haiku scan per active core story arc. Detects whether a story
-- has materially advanced since its most recent analysis. Medium+ confidence
-- detections surface as notification banners on /admin/signals/arc-queue.
-- Low-confidence scans are logged but silently discarded from the UI.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE "ArcAdvancementScan" (
    "id" TEXT NOT NULL,
    "storyArcId" TEXT NOT NULL,
    "umbrellaArcId" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "advancementDetected" BOOLEAN NOT NULL DEFAULT false,
    "confidenceLevel" TEXT NOT NULL,                 -- low | medium | high
    "rationale" TEXT,
    "triggeredAnalysis" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArcAdvancementScan_pkey" PRIMARY KEY ("id")
);

-- Indexes for banner lookup (medium+ confidence, detected, not yet triggered)
CREATE INDEX "ArcAdvancementScan_advancementDetected_confidenceLevel_idx"
  ON "ArcAdvancementScan"("advancementDetected", "confidenceLevel");
CREATE INDEX "ArcAdvancementScan_storyArcId_scannedAt_idx"
  ON "ArcAdvancementScan"("storyArcId", "scannedAt");
CREATE INDEX "ArcAdvancementScan_umbrellaArcId_idx"
  ON "ArcAdvancementScan"("umbrellaArcId");

-- Foreign keys
ALTER TABLE "ArcAdvancementScan" ADD CONSTRAINT "ArcAdvancementScan_storyArcId_fkey"
  FOREIGN KEY ("storyArcId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ArcAdvancementScan" ADD CONSTRAINT "ArcAdvancementScan_umbrellaArcId_fkey"
  FOREIGN KEY ("umbrellaArcId") REFERENCES "UmbrellaArc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
