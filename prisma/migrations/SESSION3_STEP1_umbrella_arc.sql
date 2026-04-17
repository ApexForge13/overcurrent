-- ═══════════════════════════════════════════════════════════════════════════
-- Session 3 · Step 1 — Story Arc Management System: foundation tables
--
-- Adds UmbrellaArc (Layer 1 container), plus three supporting tables that are
-- defined now so the foreign keys are in place for later steps:
--   - ArcPhaseSchedule     — populated in Step 3
--   - UmbrellaIntelligenceScan — populated in Step 4
--   - OutletUmbrellaProfile — populated in Step 5
--
-- Adds Story-side fields: umbrellaArcId, analysisType, arcLabel, arcImportance,
--                         arcPhaseAtCreation, arcDesignatedAt.
--
-- Field `UmbrellaArc.parentUmbrellaId` is schema-only. Reserved for future
-- sub-umbrella hierarchy. No UI / no queries / no computation against it
-- until explicitly instructed in a future session.
-- ═══════════════════════════════════════════════════════════════════════════

-- AlterTable: extend Story with arc-system fields
ALTER TABLE "Story"
  ADD COLUMN "umbrellaArcId"        TEXT,
  ADD COLUMN "analysisType"         TEXT,
  ADD COLUMN "arcLabel"             TEXT,
  ADD COLUMN "arcImportance"        TEXT,
  ADD COLUMN "arcPhaseAtCreation"   TEXT,
  ADD COLUMN "arcDesignatedAt"      TIMESTAMP(3);

-- CreateTable: UmbrellaArc (Layer 1 container)
CREATE TABLE "UmbrellaArc" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "signalCategory" TEXT NOT NULL,
    "parentUmbrellaId" TEXT,
    "scanFrequency" TEXT NOT NULL DEFAULT 'manual',
    "firstAnalysisAt" TIMESTAMP(3),
    "lastAnalysisAt" TIMESTAMP(3),
    "totalAnalyses" INTEGER NOT NULL DEFAULT 0,
    "storyArcCount" INTEGER NOT NULL DEFAULT 0,
    "oneOffCount" INTEGER NOT NULL DEFAULT 0,
    "intelligenceScanLastRunAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UmbrellaArc_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ArcPhaseSchedule (populated in Step 3)
CREATE TABLE "ArcPhaseSchedule" (
    "id" TEXT NOT NULL,
    "storyArcId" TEXT,
    "umbrellaArcId" TEXT,
    "targetPhase" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "completedAt" TIMESTAMP(3),
    "completedByStoryId" TEXT,
    "skipReason" TEXT,
    "isSkipped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArcPhaseSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable: UmbrellaIntelligenceScan (populated in Step 4)
CREATE TABLE "UmbrellaIntelligenceScan" (
    "id" TEXT NOT NULL,
    "umbrellaArcId" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recommendationsGenerated" INTEGER NOT NULL DEFAULT 0,
    "recommendationsTriggered" INTEGER NOT NULL DEFAULT 0,
    "rawOutput" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UmbrellaIntelligenceScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable: OutletUmbrellaProfile (populated in Step 5)
CREATE TABLE "OutletUmbrellaProfile" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "umbrellaArcId" TEXT NOT NULL,
    "frameConsistency" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "earlyMoverRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "omissionConsistencyRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "analysesAppeared" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutletUmbrellaProfile_pkey" PRIMARY KEY ("id")
);

-- Indexes on UmbrellaArc
CREATE INDEX "UmbrellaArc_status_idx" ON "UmbrellaArc"("status");
CREATE INDEX "UmbrellaArc_signalCategory_idx" ON "UmbrellaArc"("signalCategory");
CREATE INDEX "UmbrellaArc_parentUmbrellaId_idx" ON "UmbrellaArc"("parentUmbrellaId");

-- Indexes on ArcPhaseSchedule
CREATE INDEX "ArcPhaseSchedule_status_scheduledFor_idx" ON "ArcPhaseSchedule"("status", "scheduledFor");
CREATE INDEX "ArcPhaseSchedule_storyArcId_idx" ON "ArcPhaseSchedule"("storyArcId");
CREATE INDEX "ArcPhaseSchedule_umbrellaArcId_idx" ON "ArcPhaseSchedule"("umbrellaArcId");

-- Indexes on UmbrellaIntelligenceScan
CREATE INDEX "UmbrellaIntelligenceScan_umbrellaArcId_ranAt_idx" ON "UmbrellaIntelligenceScan"("umbrellaArcId", "ranAt");

-- Indexes on OutletUmbrellaProfile
CREATE UNIQUE INDEX "OutletUmbrellaProfile_outletId_umbrellaArcId_key" ON "OutletUmbrellaProfile"("outletId", "umbrellaArcId");
CREATE INDEX "OutletUmbrellaProfile_umbrellaArcId_idx" ON "OutletUmbrellaProfile"("umbrellaArcId");

-- Indexes on Story (new)
CREATE INDEX "Story_umbrellaArcId_idx" ON "Story"("umbrellaArcId");
CREATE INDEX "Story_analysisType_idx" ON "Story"("analysisType");

-- Foreign keys
ALTER TABLE "UmbrellaArc" ADD CONSTRAINT "UmbrellaArc_parentUmbrellaId_fkey"
  FOREIGN KEY ("parentUmbrellaId") REFERENCES "UmbrellaArc"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Story" ADD CONSTRAINT "Story_umbrellaArcId_fkey"
  FOREIGN KEY ("umbrellaArcId") REFERENCES "UmbrellaArc"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ArcPhaseSchedule" ADD CONSTRAINT "ArcPhaseSchedule_storyArcId_fkey"
  FOREIGN KEY ("storyArcId") REFERENCES "Story"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ArcPhaseSchedule" ADD CONSTRAINT "ArcPhaseSchedule_umbrellaArcId_fkey"
  FOREIGN KEY ("umbrellaArcId") REFERENCES "UmbrellaArc"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UmbrellaIntelligenceScan" ADD CONSTRAINT "UmbrellaIntelligenceScan_umbrellaArcId_fkey"
  FOREIGN KEY ("umbrellaArcId") REFERENCES "UmbrellaArc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OutletUmbrellaProfile" ADD CONSTRAINT "OutletUmbrellaProfile_umbrellaArcId_fkey"
  FOREIGN KEY ("umbrellaArcId") REFERENCES "UmbrellaArc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
