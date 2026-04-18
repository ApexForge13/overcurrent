-- ═══════════════════════════════════════════════════════════════════════════
-- Session 4 — Raw Signal Layer: external data source cross-referencing
--
-- Adds three admin-only tables that never surface on public-facing pages:
--   - RawSignalLayer   — every external data signal captured for a story cluster
--   - RawSignalQueue   — audit trail of every source activation (category/entity/keyword trigger)
--   - CaseStudyEntry   — internal evidence library auto-populated when admin reviews a finding
--
-- The product of this layer: divergences between narrative coverage and raw
-- ground-truth data (satellite imagery, SEC filings, ADS-B flights, maritime
-- AIS, OFAC sanctions, GDELT events, etc.). These divergences are what an
-- intelligence analyst, trading desk, or policy shop pays for.
-- ═══════════════════════════════════════════════════════════════════════════

-- CreateTable: RawSignalLayer
CREATE TABLE "RawSignalLayer" (
    "id" TEXT NOT NULL,
    "storyClusterId" TEXT NOT NULL,
    "umbrellaArcId" TEXT,
    "signalType" TEXT NOT NULL,
    "signalSource" TEXT NOT NULL,
    "captureDate" TIMESTAMP(3) NOT NULL,
    "coordinates" JSONB,
    "rawContent" JSONB NOT NULL,
    "haikuSummary" TEXT NOT NULL,
    "divergenceFlag" BOOLEAN NOT NULL DEFAULT false,
    "divergenceDescription" TEXT,
    "confidenceLevel" TEXT NOT NULL DEFAULT 'low',
    "reviewedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RawSignalLayer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RawSignalLayer_storyClusterId_idx"    ON "RawSignalLayer"("storyClusterId");
CREATE INDEX "RawSignalLayer_signalType_idx"        ON "RawSignalLayer"("signalType");
CREATE INDEX "RawSignalLayer_divergenceFlag_idx"    ON "RawSignalLayer"("divergenceFlag");
CREATE INDEX "RawSignalLayer_reviewedByAdmin_idx"   ON "RawSignalLayer"("reviewedByAdmin");
CREATE INDEX "RawSignalLayer_umbrellaArcId_idx"     ON "RawSignalLayer"("umbrellaArcId");

ALTER TABLE "RawSignalLayer"
  ADD CONSTRAINT "RawSignalLayer_storyClusterId_fkey"
  FOREIGN KEY ("storyClusterId") REFERENCES "StoryCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RawSignalLayer"
  ADD CONSTRAINT "RawSignalLayer_umbrellaArcId_fkey"
  FOREIGN KEY ("umbrellaArcId") REFERENCES "UmbrellaArc"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: RawSignalQueue
CREATE TABLE "RawSignalQueue" (
    "id" TEXT NOT NULL,
    "storyClusterId" TEXT NOT NULL,
    "umbrellaArcId" TEXT,
    "signalType" TEXT NOT NULL,
    "triggerLayer" TEXT NOT NULL,
    "triggerReason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "approvedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "approvalRequestedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedOrDeniedBy" TEXT,
    "estimatedCost" DOUBLE PRECISION,
    "actualCost" DOUBLE PRECISION,
    "dismissalReason" TEXT,
    "recapContribution" BOOLEAN NOT NULL DEFAULT true,
    "resultSignalLayerId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RawSignalQueue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RawSignalQueue_storyClusterId_idx"    ON "RawSignalQueue"("storyClusterId");
CREATE INDEX "RawSignalQueue_status_idx"            ON "RawSignalQueue"("status");
CREATE INDEX "RawSignalQueue_signalType_idx"        ON "RawSignalQueue"("signalType");
CREATE INDEX "RawSignalQueue_approvedByAdmin_idx"   ON "RawSignalQueue"("approvedByAdmin");

ALTER TABLE "RawSignalQueue"
  ADD CONSTRAINT "RawSignalQueue_storyClusterId_fkey"
  FOREIGN KEY ("storyClusterId") REFERENCES "StoryCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RawSignalQueue"
  ADD CONSTRAINT "RawSignalQueue_umbrellaArcId_fkey"
  FOREIGN KEY ("umbrellaArcId") REFERENCES "UmbrellaArc"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: CaseStudyEntry
CREATE TABLE "CaseStudyEntry" (
    "id" TEXT NOT NULL,
    "rawSignalLayerId" TEXT,
    "storyClusterId" TEXT NOT NULL,
    "umbrellaArcId" TEXT,
    "signalType" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "fullDescription" TEXT NOT NULL,
    "storyPhaseAtDetection" TEXT NOT NULL,
    "divergenceType" TEXT NOT NULL,
    "isPublishable" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseStudyEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CaseStudyEntry_storyClusterId_idx"    ON "CaseStudyEntry"("storyClusterId");
CREATE INDEX "CaseStudyEntry_umbrellaArcId_idx"     ON "CaseStudyEntry"("umbrellaArcId");
CREATE INDEX "CaseStudyEntry_signalType_idx"        ON "CaseStudyEntry"("signalType");
CREATE INDEX "CaseStudyEntry_isPublishable_idx"     ON "CaseStudyEntry"("isPublishable");
CREATE INDEX "CaseStudyEntry_divergenceType_idx"    ON "CaseStudyEntry"("divergenceType");

ALTER TABLE "CaseStudyEntry"
  ADD CONSTRAINT "CaseStudyEntry_rawSignalLayerId_fkey"
  FOREIGN KEY ("rawSignalLayerId") REFERENCES "RawSignalLayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CaseStudyEntry"
  ADD CONSTRAINT "CaseStudyEntry_storyClusterId_fkey"
  FOREIGN KEY ("storyClusterId") REFERENCES "StoryCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CaseStudyEntry"
  ADD CONSTRAINT "CaseStudyEntry_umbrellaArcId_fkey"
  FOREIGN KEY ("umbrellaArcId") REFERENCES "UmbrellaArc"("id") ON DELETE SET NULL ON UPDATE CASCADE;
