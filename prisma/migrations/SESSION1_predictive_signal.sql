-- AlterTable
ALTER TABLE "Story" ADD COLUMN     "clusterOverride" TEXT,
ADD COLUMN     "signalCategory" TEXT,
ADD COLUMN     "signalCategoryOverriddenAt" TIMESTAMP(3),
ADD COLUMN     "signalCategoryOverriddenBy" TEXT,
ADD COLUMN     "storyClusterId" TEXT,
ADD COLUMN     "storyPhase" TEXT;

-- CreateTable
CREATE TABLE "StoryCluster" (
    "id" TEXT NOT NULL,
    "clusterHeadline" TEXT NOT NULL,
    "clusterKeywords" TEXT NOT NULL,
    "signalCategory" TEXT,
    "firstDetectedAt" TIMESTAMP(3) NOT NULL,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPhase" TEXT NOT NULL DEFAULT 'first_wave',
    "totalAnalysesRun" INTEGER NOT NULL DEFAULT 0,
    "isBackfilled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoryCluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outlet" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "editorialType" TEXT NOT NULL,
    "politicalLean" TEXT NOT NULL,
    "reliability" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "tier" TEXT NOT NULL DEFAULT 'unclassified',
    "priority" TEXT,
    "tierOverriddenBy" TEXT,
    "tierOverriddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Outlet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutletFingerprint" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "totalAppearances" INTEGER NOT NULL DEFAULT 0,
    "primaryFramingDistribution" TEXT,
    "sourceTypePreference" TEXT,
    "regionalOriginBias" TEXT,
    "omissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pickupSpeed" TEXT,
    "storyCategoryCoverage" TEXT,
    "includesBackfilledData" BOOLEAN NOT NULL DEFAULT false,
    "lastComputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutletFingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutletAppearance" (
    "id" TEXT NOT NULL,
    "outletId" TEXT,
    "outletDomain" TEXT NOT NULL,
    "storyId" TEXT,
    "storyClusterId" TEXT,
    "signalCategory" TEXT,
    "storyPhase" TEXT NOT NULL,
    "framingAngle" TEXT,
    "wasLeadingFraming" BOOLEAN NOT NULL DEFAULT false,
    "sourceTypes" TEXT,
    "publishedAt" TIMESTAMP(3),
    "hoursFromFirstDetection" DOUBLE PRECISION,
    "isBackfilled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutletAppearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactOmission" (
    "id" TEXT NOT NULL,
    "storyId" TEXT,
    "storyClusterId" TEXT,
    "factType" TEXT NOT NULL,
    "factDescription" TEXT NOT NULL,
    "presentInPct" DOUBLE PRECISION NOT NULL,
    "carriedByOutlets" TEXT NOT NULL,
    "missedByOutlets" TEXT NOT NULL,
    "storyPhase" TEXT NOT NULL,
    "isBackfilled" BOOLEAN NOT NULL DEFAULT false,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FactOmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FramingTag" (
    "id" TEXT NOT NULL,
    "storyId" TEXT,
    "storyClusterId" TEXT,
    "outletDomain" TEXT NOT NULL,
    "framingAngle" TEXT NOT NULL,
    "isDominant" BOOLEAN NOT NULL DEFAULT false,
    "storyPhase" TEXT NOT NULL,
    "isBackfilled" BOOLEAN NOT NULL DEFAULT false,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FramingTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NarrativeArc" (
    "id" TEXT NOT NULL,
    "storyClusterId" TEXT NOT NULL,
    "firstWaveFramings" TEXT NOT NULL,
    "persistentFramings" TEXT NOT NULL,
    "emergentFramings" TEXT NOT NULL,
    "surfacedOmissions" TEXT NOT NULL,
    "earlyMovers" TEXT NOT NULL,
    "lateFollowers" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NarrativeArc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictiveSignal" (
    "id" TEXT NOT NULL,
    "storyId" TEXT,
    "storyClusterId" TEXT NOT NULL,
    "predictedDominantFraming" TEXT NOT NULL,
    "framingConfidencePct" INTEGER NOT NULL,
    "topOmissionRisks" TEXT NOT NULL,
    "momentumFlag" TEXT NOT NULL,
    "momentumReason" TEXT NOT NULL,
    "computedFromAnalysesCount" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredictiveSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryCategoryPattern" (
    "id" TEXT NOT NULL,
    "signalCategory" TEXT NOT NULL,
    "avgAnalysesUntilStabilization" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commonFirstWaveOmissions" TEXT,
    "leadingTiers" TEXT,
    "followingTiers" TEXT,
    "originatingRegions" TEXT,
    "amplifyingRegions" TEXT,
    "totalAnalyses" INTEGER NOT NULL DEFAULT 0,
    "lastComputedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoryCategoryPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryEnablement" (
    "signalCategory" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledAt" TIMESTAMP(3),
    "enabledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryEnablement_pkey" PRIMARY KEY ("signalCategory")
);

-- CreateIndex
CREATE INDEX "StoryCluster_currentPhase_idx" ON "StoryCluster"("currentPhase");

-- CreateIndex
CREATE INDEX "StoryCluster_signalCategory_idx" ON "StoryCluster"("signalCategory");

-- CreateIndex
CREATE INDEX "StoryCluster_firstDetectedAt_idx" ON "StoryCluster"("firstDetectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Outlet_domain_key" ON "Outlet"("domain");

-- CreateIndex
CREATE INDEX "Outlet_tier_idx" ON "Outlet"("tier");

-- CreateIndex
CREATE INDEX "Outlet_region_idx" ON "Outlet"("region");

-- CreateIndex
CREATE INDEX "Outlet_editorialType_idx" ON "Outlet"("editorialType");

-- CreateIndex
CREATE UNIQUE INDEX "OutletFingerprint_outletId_key" ON "OutletFingerprint"("outletId");

-- CreateIndex
CREATE INDEX "OutletAppearance_outletId_createdAt_idx" ON "OutletAppearance"("outletId", "createdAt");

-- CreateIndex
CREATE INDEX "OutletAppearance_storyClusterId_idx" ON "OutletAppearance"("storyClusterId");

-- CreateIndex
CREATE INDEX "OutletAppearance_storyId_idx" ON "OutletAppearance"("storyId");

-- CreateIndex
CREATE INDEX "OutletAppearance_signalCategory_storyPhase_idx" ON "OutletAppearance"("signalCategory", "storyPhase");

-- CreateIndex
CREATE INDEX "FactOmission_storyClusterId_factType_idx" ON "FactOmission"("storyClusterId", "factType");

-- CreateIndex
CREATE INDEX "FactOmission_storyId_idx" ON "FactOmission"("storyId");

-- CreateIndex
CREATE INDEX "FactOmission_factType_idx" ON "FactOmission"("factType");

-- CreateIndex
CREATE INDEX "FramingTag_storyClusterId_storyPhase_idx" ON "FramingTag"("storyClusterId", "storyPhase");

-- CreateIndex
CREATE INDEX "FramingTag_outletDomain_idx" ON "FramingTag"("outletDomain");

-- CreateIndex
CREATE UNIQUE INDEX "NarrativeArc_storyClusterId_key" ON "NarrativeArc"("storyClusterId");

-- CreateIndex
CREATE INDEX "PredictiveSignal_storyClusterId_idx" ON "PredictiveSignal"("storyClusterId");

-- CreateIndex
CREATE INDEX "PredictiveSignal_storyId_idx" ON "PredictiveSignal"("storyId");

-- CreateIndex
CREATE UNIQUE INDEX "StoryCategoryPattern_signalCategory_key" ON "StoryCategoryPattern"("signalCategory");

-- CreateIndex
CREATE INDEX "Story_storyClusterId_idx" ON "Story"("storyClusterId");

-- CreateIndex
CREATE INDEX "Story_signalCategory_idx" ON "Story"("signalCategory");

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_storyClusterId_fkey" FOREIGN KEY ("storyClusterId") REFERENCES "StoryCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletFingerprint" ADD CONSTRAINT "OutletFingerprint_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletAppearance" ADD CONSTRAINT "OutletAppearance_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletAppearance" ADD CONSTRAINT "OutletAppearance_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutletAppearance" ADD CONSTRAINT "OutletAppearance_storyClusterId_fkey" FOREIGN KEY ("storyClusterId") REFERENCES "StoryCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactOmission" ADD CONSTRAINT "FactOmission_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactOmission" ADD CONSTRAINT "FactOmission_storyClusterId_fkey" FOREIGN KEY ("storyClusterId") REFERENCES "StoryCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FramingTag" ADD CONSTRAINT "FramingTag_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FramingTag" ADD CONSTRAINT "FramingTag_storyClusterId_fkey" FOREIGN KEY ("storyClusterId") REFERENCES "StoryCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NarrativeArc" ADD CONSTRAINT "NarrativeArc_storyClusterId_fkey" FOREIGN KEY ("storyClusterId") REFERENCES "StoryCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictiveSignal" ADD CONSTRAINT "PredictiveSignal_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictiveSignal" ADD CONSTRAINT "PredictiveSignal_storyClusterId_fkey" FOREIGN KEY ("storyClusterId") REFERENCES "StoryCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
