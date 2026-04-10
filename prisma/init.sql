Loaded Prisma config from prisma.config.ts.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "synopsis" TEXT NOT NULL,
    "confidenceLevel" TEXT NOT NULL,
    "confidenceNote" TEXT,
    "category" TEXT,
    "searchQuery" TEXT NOT NULL,
    "sourceCount" INTEGER NOT NULL DEFAULT 0,
    "countryCount" INTEGER NOT NULL DEFAULT 0,
    "regionCount" INTEGER NOT NULL DEFAULT 0,
    "consensusScore" INTEGER NOT NULL DEFAULT 0,
    "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "analysisSeconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "outlet" TEXT NOT NULL,
    "outletType" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'English',
    "politicalLean" TEXT NOT NULL DEFAULT 'unknown',
    "reliability" TEXT NOT NULL DEFAULT 'unknown',
    "summary" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "consensusPct" INTEGER NOT NULL DEFAULT 0,
    "supportedBy" TEXT NOT NULL,
    "contradictedBy" TEXT NOT NULL,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discrepancy" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "issue" TEXT NOT NULL,
    "sideA" TEXT NOT NULL,
    "sideB" TEXT NOT NULL,
    "sourcesA" TEXT NOT NULL,
    "sourcesB" TEXT NOT NULL,
    "assessment" TEXT,

    CONSTRAINT "Discrepancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Omission" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "outletRegion" TEXT NOT NULL,
    "missing" TEXT NOT NULL,
    "presentIn" TEXT NOT NULL,
    "significance" TEXT,

    CONSTRAINT "Omission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FramingAnalysis" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "framing" TEXT NOT NULL,
    "contrastWith" TEXT,

    CONSTRAINT "FramingAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegionalSilence" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "sourcesSearched" INTEGER NOT NULL DEFAULT 0,
    "possibleReasons" TEXT,
    "isSignificant" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RegionalSilence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpQuestion" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FollowUpQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UndercurrentReport" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "dominantStoryId" TEXT,
    "dominantHeadline" TEXT NOT NULL,
    "dominantDescription" TEXT NOT NULL,
    "dateRangeStart" TIMESTAMP(3) NOT NULL,
    "dateRangeEnd" TIMESTAMP(3) NOT NULL,
    "searchQuery" TEXT NOT NULL,
    "synopsis" TEXT NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "analysisSeconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UndercurrentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisplacedStory" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "peakCoverage" TEXT NOT NULL,
    "dropoffDate" TEXT NOT NULL,
    "currentCoverage" TEXT NOT NULL,
    "coverageDropPct" INTEGER NOT NULL,
    "wasResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolutionNote" TEXT,
    "significance" TEXT NOT NULL,
    "sampleSources" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DisplacedStory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuietAction" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mediaCoverage" TEXT NOT NULL,
    "significance" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuietAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimingAnomaly" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "timing" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "historicalContext" TEXT,
    "significance" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TimingAnomaly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostLog" (
    "id" TEXT NOT NULL,
    "storyId" TEXT,
    "undercurrentReportId" TEXT,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "agentType" TEXT NOT NULL,
    "region" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Story_slug_key" ON "Story"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "UndercurrentReport_slug_key" ON "UndercurrentReport"("slug");

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discrepancy" ADD CONSTRAINT "Discrepancy_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Omission" ADD CONSTRAINT "Omission_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FramingAnalysis" ADD CONSTRAINT "FramingAnalysis_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegionalSilence" ADD CONSTRAINT "RegionalSilence_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpQuestion" ADD CONSTRAINT "FollowUpQuestion_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UndercurrentReport" ADD CONSTRAINT "UndercurrentReport_dominantStoryId_fkey" FOREIGN KEY ("dominantStoryId") REFERENCES "Story"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisplacedStory" ADD CONSTRAINT "DisplacedStory_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "UndercurrentReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuietAction" ADD CONSTRAINT "QuietAction_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "UndercurrentReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingAnomaly" ADD CONSTRAINT "TimingAnomaly_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "UndercurrentReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostLog" ADD CONSTRAINT "CostLog_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostLog" ADD CONSTRAINT "CostLog_undercurrentReportId_fkey" FOREIGN KEY ("undercurrentReportId") REFERENCES "UndercurrentReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

