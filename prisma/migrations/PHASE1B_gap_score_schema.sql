-- AlterTable
ALTER TABLE "CostLog" ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "operation" TEXT,
ADD COLUMN     "service" TEXT,
ADD COLUMN     "signalsProcessed" INTEGER;

-- CreateTable
CREATE TABLE "TrackedEntity" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "providerIds" JSONB NOT NULL,
    "groundTruthMap" JSONB NOT NULL,
    "entityStrings" JSONB NOT NULL,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriggerEvent" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "severity" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "candidateGeneratedAt" TIMESTAMP(3),
    "gapScoreId" TEXT,

    CONSTRAINT "TriggerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoredSignal" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceUrl" TEXT,
    "direction" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT,
    "rawSignal" JSONB,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promptVersion" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,

    CONSTRAINT "ScoredSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GapScore" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "asOfTimestamp" TIMESTAMP(3) NOT NULL,
    "narrativeScore" DOUBLE PRECISION NOT NULL,
    "narrativeConfidence" DOUBLE PRECISION NOT NULL,
    "narrativeSignalCount" INTEGER NOT NULL,
    "psychologicalScore" DOUBLE PRECISION NOT NULL,
    "psychologicalConfidence" DOUBLE PRECISION NOT NULL,
    "psychologicalSignalCount" INTEGER NOT NULL,
    "groundTruthScore" DOUBLE PRECISION NOT NULL,
    "groundTruthConfidence" DOUBLE PRECISION NOT NULL,
    "groundTruthSignalCount" INTEGER NOT NULL,
    "divergenceNP" DOUBLE PRECISION NOT NULL,
    "divergenceNG" DOUBLE PRECISION NOT NULL,
    "divergencePG" DOUBLE PRECISION NOT NULL,
    "gapScore" DOUBLE PRECISION NOT NULL,
    "fds" DOUBLE PRECISION NOT NULL,
    "contributingSignalIds" TEXT[],
    "contributingTriggerIds" TEXT[],
    "formulaVersion" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,

    CONSTRAINT "GapScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "thresholds" JSONB,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "gapScoreId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "deliveredVia" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseStudy" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "eventTimestamp" TIMESTAMP(3) NOT NULL,
    "scoreTimestamp" TIMESTAMP(3) NOT NULL,
    "leadTimeHours" DOUBLE PRECISION NOT NULL,
    "narrativeSummary" TEXT NOT NULL,
    "fullContent" TEXT NOT NULL,
    "gapScoreAtFlag" DOUBLE PRECISION NOT NULL,
    "fdsAtFlag" DOUBLE PRECISION NOT NULL,
    "contributingSignalIds" TEXT[],
    "contributingTriggerIds" TEXT[],
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaseStudy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HotListSnapshot" (
    "id" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entities" JSONB NOT NULL,

    CONSTRAINT "HotListSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptVersion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "fewShotExamples" JSONB NOT NULL,
    "rubric" TEXT NOT NULL,
    "activeFrom" TIMESTAMP(3) NOT NULL,
    "activeUntil" TIMESTAMP(3),

    CONSTRAINT "PromptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityBaseline" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metricName" TEXT NOT NULL,
    "windowDays" INTEGER NOT NULL,
    "mean" DOUBLE PRECISION NOT NULL,
    "stddev" DOUBLE PRECISION NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "minSampleSize" INTEGER NOT NULL,
    "isMature" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntityBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZoneBaseline" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "metricName" TEXT NOT NULL,
    "windowDays" INTEGER NOT NULL,
    "mean" DOUBLE PRECISION NOT NULL,
    "stddev" DOUBLE PRECISION NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "minSampleSize" INTEGER NOT NULL,
    "isMature" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZoneBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroRelease" (
    "id" TEXT NOT NULL,
    "indicator" TEXT NOT NULL,
    "releaseDate" TIMESTAMP(3) NOT NULL,
    "consensusValue" DOUBLE PRECISION,
    "consensusSource" TEXT,
    "consensusScraped" TIMESTAMP(3),
    "actualValue" DOUBLE PRECISION,
    "actualReleased" TIMESTAMP(3),
    "surprise" DOUBLE PRECISION,
    "surpriseZscore" DOUBLE PRECISION,
    "unit" TEXT NOT NULL,

    CONSTRAINT "MacroRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MacroIndicatorConfig" (
    "id" TEXT NOT NULL,
    "indicator" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "releaseSchedule" TEXT NOT NULL,
    "historicalStddev" DOUBLE PRECISION NOT NULL,
    "historicalStddevProxy" BOOLEAN NOT NULL DEFAULT true,
    "directionMapping" JSONB NOT NULL,
    "relevantAssets" TEXT[],

    CONSTRAINT "MacroIndicatorConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackedEntity_identifier_key" ON "TrackedEntity"("identifier");

-- CreateIndex
CREATE INDEX "TrackedEntity_identifier_idx" ON "TrackedEntity"("identifier");

-- CreateIndex
CREATE INDEX "TrackedEntity_category_active_idx" ON "TrackedEntity"("category", "active");

-- CreateIndex
CREATE INDEX "TrackedEntity_isFeatured_active_idx" ON "TrackedEntity"("isFeatured", "active");

-- CreateIndex
CREATE INDEX "TriggerEvent_entityId_firedAt_idx" ON "TriggerEvent"("entityId", "firedAt");

-- CreateIndex
CREATE INDEX "TriggerEvent_firedAt_idx" ON "TriggerEvent"("firedAt");

-- CreateIndex
CREATE INDEX "TriggerEvent_triggerType_firedAt_idx" ON "TriggerEvent"("triggerType", "firedAt");

-- CreateIndex
CREATE INDEX "ScoredSignal_entityId_stream_publishedAt_idx" ON "ScoredSignal"("entityId", "stream", "publishedAt");

-- CreateIndex
CREATE INDEX "ScoredSignal_publishedAt_idx" ON "ScoredSignal"("publishedAt");

-- CreateIndex
CREATE INDEX "GapScore_entityId_computedAt_idx" ON "GapScore"("entityId", "computedAt");

-- CreateIndex
CREATE INDEX "GapScore_asOfTimestamp_idx" ON "GapScore"("asOfTimestamp");

-- CreateIndex
CREATE INDEX "GapScore_gapScore_idx" ON "GapScore"("gapScore");

-- CreateIndex
CREATE INDEX "GapScore_fds_idx" ON "GapScore"("fds");

-- CreateIndex
CREATE INDEX "GapScore_computedAt_gapScore_idx" ON "GapScore"("computedAt", "gapScore");

-- CreateIndex
CREATE INDEX "Watchlist_userId_idx" ON "Watchlist"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Watchlist_userId_entityId_key" ON "Watchlist"("userId", "entityId");

-- CreateIndex
CREATE INDEX "Alert_userId_createdAt_idx" ON "Alert"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_entityId_idx" ON "Alert"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseStudy_slug_key" ON "CaseStudy"("slug");

-- CreateIndex
CREATE INDEX "CaseStudy_published_publishedAt_idx" ON "CaseStudy"("published", "publishedAt");

-- CreateIndex
CREATE INDEX "CaseStudy_entityId_idx" ON "CaseStudy"("entityId");

-- CreateIndex
CREATE INDEX "HotListSnapshot_capturedAt_idx" ON "HotListSnapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "PromptVersion_name_activeFrom_idx" ON "PromptVersion"("name", "activeFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PromptVersion_name_version_key" ON "PromptVersion"("name", "version");

-- CreateIndex
CREATE INDEX "EntityBaseline_entityId_idx" ON "EntityBaseline"("entityId");

-- CreateIndex
CREATE INDEX "EntityBaseline_isMature_idx" ON "EntityBaseline"("isMature");

-- CreateIndex
CREATE UNIQUE INDEX "EntityBaseline_entityId_metricName_windowDays_key" ON "EntityBaseline"("entityId", "metricName", "windowDays");

-- CreateIndex
CREATE INDEX "ZoneBaseline_zoneId_metricName_idx" ON "ZoneBaseline"("zoneId", "metricName");

-- CreateIndex
CREATE INDEX "ZoneBaseline_isMature_idx" ON "ZoneBaseline"("isMature");

-- CreateIndex
CREATE UNIQUE INDEX "ZoneBaseline_zoneId_metricName_windowDays_key" ON "ZoneBaseline"("zoneId", "metricName", "windowDays");

-- CreateIndex
CREATE INDEX "MacroRelease_indicator_releaseDate_idx" ON "MacroRelease"("indicator", "releaseDate");

-- CreateIndex
CREATE INDEX "MacroRelease_releaseDate_idx" ON "MacroRelease"("releaseDate");

-- CreateIndex
CREATE UNIQUE INDEX "MacroRelease_indicator_releaseDate_key" ON "MacroRelease"("indicator", "releaseDate");

-- CreateIndex
CREATE UNIQUE INDEX "MacroIndicatorConfig_indicator_key" ON "MacroIndicatorConfig"("indicator");

-- CreateIndex
CREATE INDEX "CostLog_service_createdAt_idx" ON "CostLog"("service", "createdAt");

-- CreateIndex
CREATE INDEX "CostLog_entityId_idx" ON "CostLog"("entityId");

-- AddForeignKey
ALTER TABLE "TriggerEvent" ADD CONSTRAINT "TriggerEvent_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "TrackedEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoredSignal" ADD CONSTRAINT "ScoredSignal_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "TrackedEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GapScore" ADD CONSTRAINT "GapScore_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "TrackedEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "TrackedEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "TrackedEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseStudy" ADD CONSTRAINT "CaseStudy_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "TrackedEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityBaseline" ADD CONSTRAINT "EntityBaseline_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "TrackedEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

