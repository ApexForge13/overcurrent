-- ═══════════════════════════════════════════════════════════════════════════
-- Session 4 Phase 1 — Foundational schema for reality verification engine
--
-- Adds 25 new tables + 3 columns on existing tables (Story.coordinatesJson,
-- Story.primaryCountry, Outlet.entityId) + 1 FK + 1 index. Pure additive —
-- no drops, no data transforms, no type changes on existing rows.
--
-- Table groupings:
--   Entity intelligence  — Entity, EntityMention, EntitySignalIndex, TickerEntityMap
--   Knowledge graph      — GraphNode, GraphEdge (streamType-tagged: narrative | ground_truth | psychological)
--   Alerts               — AlertMonitor
--   B2B + quality        — B2BUsageRecord, QualityReviewCard, PublicationRequest
--   Enterprise + license — EnterpriseAccount, ClientNamespace, ClientOutputTemplate, DataLicense
--   Historical backfill  — HistoricalSpendingBaseline, HistoricalEquityBaseline, HistoricalSatelliteBaseline
--   Social Stream 3      — SocialChannel, SocialSignal
--   Ambient monitoring   — MonitoredPortfolio, MonitoredEntity, MonitoringScan, IntelligenceBrief, BriefDelivery
--   Immutable timeline   — ArcTimelineEvent
--
-- NON-NEGOTIABLE RULE: isHistoricalBackfill defaults to TRUE on all three
-- Historical* tables. Historical backfill data NEVER feeds trajectory scores,
-- momentum flags, or predictive confidence percentages. Enforced in every
-- fingerprint aggregation function and every pattern library computation.
--
-- ADMIN-ONLY visibility: none of these new tables surface on public-facing
-- pages without explicit admin approval (raw signal + case study gate) or
-- paid subscriber entitlement (entity dossiers, knowledge graph subset).
-- Public isolation CI test must be updated in Phase 25 to include every new
-- table name added by this migration.
--
-- ClientNamespace <-> EnterpriseAccount is 1:1 via UNIQUE INDEX on
-- ClientNamespace.enterpriseAccountId (single FK; deviates from master-spec's
-- bidirectional FK — approved in Phase 1 checkpoint).
-- ═══════════════════════════════════════════════════════════════════════════

-- AlterTable
ALTER TABLE "Outlet" ADD COLUMN     "entityId" TEXT;

-- AlterTable
ALTER TABLE "Story" ADD COLUMN     "coordinatesJson" JSONB,
ADD COLUMN     "primaryCountry" TEXT;

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "signalCategory" TEXT,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityMention" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "mentionContext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntitySignalIndex" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "rawSignalLayerId" TEXT,
    "signalDate" TIMESTAMP(3) NOT NULL,
    "signalSummary" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "confidenceLevel" TEXT NOT NULL DEFAULT 'low',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntitySignalIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TickerEntityMap" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "exchangeName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TickerEntityMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphNode" (
    "id" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "nodeLabel" TEXT NOT NULL,
    "nodeWeight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "metadata" JSONB NOT NULL,
    "streamType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GraphNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraphEdge" (
    "id" TEXT NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "edgeType" TEXT NOT NULL,
    "edgeWeight" DOUBLE PRECISION NOT NULL,
    "temporalProximityHours" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GraphEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertMonitor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monitorType" TEXT NOT NULL,
    "monitorValue" TEXT NOT NULL,
    "notificationFrequency" TEXT NOT NULL DEFAULT 'daily',
    "lastFiredAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertMonitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "B2BUsageRecord" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "apiCostClaude" DOUBLE PRECISION NOT NULL,
    "apiCostHaiku" DOUBLE PRECISION NOT NULL,
    "rawSignalCosts" JSONB NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "markup" DOUBLE PRECISION NOT NULL,
    "billedAmount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "B2BUsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityReviewCard" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "overallRecommendation" TEXT NOT NULL,
    "verificationSummary" JSONB NOT NULL,
    "patternVerified" BOOLEAN NOT NULL DEFAULT false,
    "patternStressTestDetail" TEXT NOT NULL,
    "editorialScores" JSONB NOT NULL,
    "sensitivityFlags" JSONB NOT NULL,
    "suggestedEdits" TEXT,
    "reviewCost" DOUBLE PRECISION NOT NULL,
    "reviewDurationSeconds" INTEGER NOT NULL,
    "webSearchesRun" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityReviewCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationRequest" (
    "id" TEXT NOT NULL,
    "b2bAccountId" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attributionPreference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "publishedStoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnterpriseAccount" (
    "id" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "monthlyRate" DOUBLE PRECISION NOT NULL,
    "contractStartDate" TIMESTAMP(3) NOT NULL,
    "contractEndDate" TIMESTAMP(3) NOT NULL,
    "ndaSigned" BOOLEAN NOT NULL DEFAULT false,
    "features" JSONB NOT NULL,
    "dataResidencyModel" TEXT NOT NULL DEFAULT 'api_only',
    "allowsClientDataIngestion" BOOLEAN NOT NULL DEFAULT false,
    "deploymentFingerprint" TEXT,
    "licenseKey" TEXT,
    "licenseScope" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnterpriseAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientNamespace" (
    "id" TEXT NOT NULL,
    "enterpriseAccountId" TEXT NOT NULL,
    "namespaceName" TEXT NOT NULL,
    "storageQuotaGb" INTEGER NOT NULL DEFAULT 0,
    "dataIngestionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "telemetryOptIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientNamespace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientOutputTemplate" (
    "id" TEXT NOT NULL,
    "enterpriseAccountId" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "outputFormat" TEXT NOT NULL,
    "templateConfig" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientOutputTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataLicense" (
    "id" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "licenseType" TEXT NOT NULL,
    "annualRate" DOUBLE PRECISION NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "dataDeliveryMethod" TEXT NOT NULL,
    "usageRestrictions" TEXT NOT NULL,
    "reverseEngineeringProhibition" BOOLEAN NOT NULL DEFAULT true,
    "extractionProhibition" BOOLEAN NOT NULL DEFAULT true,
    "auditRightRetained" BOOLEAN NOT NULL DEFAULT true,
    "killSwitchProvision" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataLicense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricalSpendingBaseline" (
    "id" TEXT NOT NULL,
    "awardee" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "agency" TEXT NOT NULL,
    "awardDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "isHistoricalBackfill" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricalSpendingBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricalEquityBaseline" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "entityId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" BIGINT NOT NULL,
    "isHistoricalBackfill" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricalEquityBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricalSatelliteBaseline" (
    "id" TEXT NOT NULL,
    "umbrellaArcId" TEXT,
    "coordinates" JSONB NOT NULL,
    "captureDate" TIMESTAMP(3) NOT NULL,
    "imageDescription" TEXT NOT NULL,
    "cloudCoverPct" DOUBLE PRECISION,
    "isHistoricalBackfill" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricalSatelliteBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialChannel" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "channelIdentifier" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "region" TEXT,
    "signalCategories" TEXT[],
    "followerCount" INTEGER,
    "credibilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "isVerifiedOfficial" BOOLEAN NOT NULL DEFAULT false,
    "lastCrawledAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialSignal" (
    "id" TEXT NOT NULL,
    "socialChannelId" TEXT NOT NULL,
    "storyClusterId" TEXT,
    "umbrellaArcId" TEXT,
    "entityId" TEXT,
    "postUrl" TEXT NOT NULL,
    "postContent" TEXT NOT NULL,
    "postDate" TIMESTAMP(3) NOT NULL,
    "engagementCount" INTEGER,
    "engagementVelocity" DOUBLE PRECISION,
    "language" TEXT NOT NULL,
    "translatedContent" TEXT,
    "sentimentScore" DOUBLE PRECISION,
    "framingAngle" TEXT,
    "haikuSummary" TEXT NOT NULL,
    "divergesFromNarrative" BOOLEAN NOT NULL DEFAULT false,
    "divergenceDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoredPortfolio" (
    "id" TEXT NOT NULL,
    "enterpriseAccountId" TEXT NOT NULL,
    "portfolioName" TEXT NOT NULL,
    "positionData" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoredPortfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoredEntity" (
    "id" TEXT NOT NULL,
    "enterpriseAccountId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "monitoringIntensity" TEXT NOT NULL,
    "positionSize" DOUBLE PRECISION,
    "customContext" TEXT,
    "alertThreshold" TEXT NOT NULL DEFAULT 'significant_divergence',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoredEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringScan" (
    "id" TEXT NOT NULL,
    "enterpriseAccountId" TEXT NOT NULL,
    "monitoredEntityId" TEXT NOT NULL,
    "scanCycle" TIMESTAMP(3) NOT NULL,
    "streamsChecked" TEXT[],
    "divergencesFound" INTEGER NOT NULL DEFAULT 0,
    "materialDivergencesFound" INTEGER NOT NULL DEFAULT 0,
    "briefGenerated" BOOLEAN NOT NULL DEFAULT false,
    "briefId" TEXT,
    "scanDurationMs" INTEGER NOT NULL,
    "scanCostCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelligenceBrief" (
    "id" TEXT NOT NULL,
    "enterpriseAccountId" TEXT NOT NULL,
    "monitoredEntityId" TEXT,
    "triggeringSignals" JSONB NOT NULL,
    "briefType" TEXT NOT NULL,
    "urgencyLevel" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "narrativeContext" TEXT NOT NULL,
    "physicalGroundTruth" TEXT NOT NULL,
    "psychologicalSignal" TEXT,
    "priorSimilarCases" JSONB,
    "probabilityAssessment" TEXT,
    "recommendedActions" TEXT,
    "outputFormat" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntelligenceBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BriefDelivery" (
    "id" TEXT NOT NULL,
    "intelligenceBriefId" TEXT NOT NULL,
    "deliveryMethod" TEXT NOT NULL,
    "deliveryAddress" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BriefDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArcTimelineEvent" (
    "id" TEXT NOT NULL,
    "storyClusterId" TEXT NOT NULL,
    "umbrellaArcId" TEXT,
    "eventType" TEXT NOT NULL,
    "eventTimestamp" TIMESTAMP(3) NOT NULL,
    "eventData" JSONB NOT NULL,
    "streamType" TEXT NOT NULL,
    "isWildFinding" BOOLEAN NOT NULL DEFAULT false,
    "wildFindingPercentile" DOUBLE PRECISION,
    "isCorrectionEvent" BOOLEAN NOT NULL DEFAULT false,
    "correctionDescription" TEXT,
    "correctionImpact" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArcTimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Entity_slug_key" ON "Entity"("slug");

-- CreateIndex
CREATE INDEX "Entity_slug_idx" ON "Entity"("slug");

-- CreateIndex
CREATE INDEX "Entity_name_idx" ON "Entity"("name");

-- CreateIndex
CREATE INDEX "Entity_type_idx" ON "Entity"("type");

-- CreateIndex
CREATE INDEX "EntityMention_entityId_idx" ON "EntityMention"("entityId");

-- CreateIndex
CREATE INDEX "EntityMention_storyId_idx" ON "EntityMention"("storyId");

-- CreateIndex
CREATE INDEX "EntitySignalIndex_entityId_idx" ON "EntitySignalIndex"("entityId");

-- CreateIndex
CREATE INDEX "EntitySignalIndex_signalType_idx" ON "EntitySignalIndex"("signalType");

-- CreateIndex
CREATE INDEX "EntitySignalIndex_signalDate_idx" ON "EntitySignalIndex"("signalDate");

-- CreateIndex
CREATE UNIQUE INDEX "TickerEntityMap_ticker_key" ON "TickerEntityMap"("ticker");

-- CreateIndex
CREATE INDEX "TickerEntityMap_entityId_idx" ON "TickerEntityMap"("entityId");

-- CreateIndex
CREATE INDEX "GraphNode_nodeType_idx" ON "GraphNode"("nodeType");

-- CreateIndex
CREATE INDEX "GraphNode_nodeLabel_idx" ON "GraphNode"("nodeLabel");

-- CreateIndex
CREATE INDEX "GraphNode_streamType_idx" ON "GraphNode"("streamType");

-- CreateIndex
CREATE INDEX "GraphEdge_sourceNodeId_idx" ON "GraphEdge"("sourceNodeId");

-- CreateIndex
CREATE INDEX "GraphEdge_targetNodeId_idx" ON "GraphEdge"("targetNodeId");

-- CreateIndex
CREATE INDEX "GraphEdge_edgeType_idx" ON "GraphEdge"("edgeType");

-- CreateIndex
CREATE INDEX "GraphEdge_edgeWeight_idx" ON "GraphEdge"("edgeWeight");

-- CreateIndex
CREATE INDEX "AlertMonitor_userId_idx" ON "AlertMonitor"("userId");

-- CreateIndex
CREATE INDEX "AlertMonitor_monitorType_idx" ON "AlertMonitor"("monitorType");

-- CreateIndex
CREATE INDEX "AlertMonitor_isActive_idx" ON "AlertMonitor"("isActive");

-- CreateIndex
CREATE INDEX "B2BUsageRecord_accountId_idx" ON "B2BUsageRecord"("accountId");

-- CreateIndex
CREATE INDEX "B2BUsageRecord_storyId_idx" ON "B2BUsageRecord"("storyId");

-- CreateIndex
CREATE INDEX "B2BUsageRecord_createdAt_idx" ON "B2BUsageRecord"("createdAt");

-- CreateIndex
CREATE INDEX "QualityReviewCard_storyId_idx" ON "QualityReviewCard"("storyId");

-- CreateIndex
CREATE INDEX "QualityReviewCard_overallRecommendation_idx" ON "QualityReviewCard"("overallRecommendation");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationRequest_publishedStoryId_key" ON "PublicationRequest"("publishedStoryId");

-- CreateIndex
CREATE INDEX "PublicationRequest_b2bAccountId_idx" ON "PublicationRequest"("b2bAccountId");

-- CreateIndex
CREATE INDEX "PublicationRequest_status_idx" ON "PublicationRequest"("status");

-- CreateIndex
CREATE INDEX "PublicationRequest_storyId_idx" ON "PublicationRequest"("storyId");

-- CreateIndex
CREATE UNIQUE INDEX "EnterpriseAccount_licenseKey_key" ON "EnterpriseAccount"("licenseKey");

-- CreateIndex
CREATE INDEX "EnterpriseAccount_organizationName_idx" ON "EnterpriseAccount"("organizationName");

-- CreateIndex
CREATE INDEX "EnterpriseAccount_contractEndDate_idx" ON "EnterpriseAccount"("contractEndDate");

-- CreateIndex
CREATE UNIQUE INDEX "ClientNamespace_enterpriseAccountId_key" ON "ClientNamespace"("enterpriseAccountId");

-- CreateIndex
CREATE INDEX "ClientOutputTemplate_enterpriseAccountId_idx" ON "ClientOutputTemplate"("enterpriseAccountId");

-- CreateIndex
CREATE INDEX "DataLicense_endDate_idx" ON "DataLicense"("endDate");

-- CreateIndex
CREATE INDEX "HistoricalSpendingBaseline_awardee_idx" ON "HistoricalSpendingBaseline"("awardee");

-- CreateIndex
CREATE INDEX "HistoricalSpendingBaseline_agency_idx" ON "HistoricalSpendingBaseline"("agency");

-- CreateIndex
CREATE INDEX "HistoricalSpendingBaseline_awardDate_idx" ON "HistoricalSpendingBaseline"("awardDate");

-- CreateIndex
CREATE INDEX "HistoricalEquityBaseline_ticker_date_idx" ON "HistoricalEquityBaseline"("ticker", "date");

-- CreateIndex
CREATE INDEX "HistoricalEquityBaseline_entityId_idx" ON "HistoricalEquityBaseline"("entityId");

-- CreateIndex
CREATE INDEX "HistoricalSatelliteBaseline_umbrellaArcId_idx" ON "HistoricalSatelliteBaseline"("umbrellaArcId");

-- CreateIndex
CREATE INDEX "HistoricalSatelliteBaseline_captureDate_idx" ON "HistoricalSatelliteBaseline"("captureDate");

-- CreateIndex
CREATE INDEX "SocialChannel_platform_idx" ON "SocialChannel"("platform");

-- CreateIndex
CREATE INDEX "SocialChannel_region_idx" ON "SocialChannel"("region");

-- CreateIndex
CREATE INDEX "SocialChannel_isActive_idx" ON "SocialChannel"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SocialChannel_platform_channelIdentifier_key" ON "SocialChannel"("platform", "channelIdentifier");

-- CreateIndex
CREATE INDEX "SocialSignal_storyClusterId_idx" ON "SocialSignal"("storyClusterId");

-- CreateIndex
CREATE INDEX "SocialSignal_entityId_idx" ON "SocialSignal"("entityId");

-- CreateIndex
CREATE INDEX "SocialSignal_socialChannelId_idx" ON "SocialSignal"("socialChannelId");

-- CreateIndex
CREATE INDEX "SocialSignal_postDate_idx" ON "SocialSignal"("postDate");

-- CreateIndex
CREATE INDEX "SocialSignal_divergesFromNarrative_idx" ON "SocialSignal"("divergesFromNarrative");

-- CreateIndex
CREATE INDEX "MonitoredPortfolio_enterpriseAccountId_idx" ON "MonitoredPortfolio"("enterpriseAccountId");

-- CreateIndex
CREATE INDEX "MonitoredEntity_enterpriseAccountId_idx" ON "MonitoredEntity"("enterpriseAccountId");

-- CreateIndex
CREATE INDEX "MonitoredEntity_entityId_idx" ON "MonitoredEntity"("entityId");

-- CreateIndex
CREATE INDEX "MonitoredEntity_monitoringIntensity_idx" ON "MonitoredEntity"("monitoringIntensity");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoredEntity_enterpriseAccountId_entityId_key" ON "MonitoredEntity"("enterpriseAccountId", "entityId");

-- CreateIndex
CREATE INDEX "MonitoringScan_enterpriseAccountId_idx" ON "MonitoringScan"("enterpriseAccountId");

-- CreateIndex
CREATE INDEX "MonitoringScan_scanCycle_idx" ON "MonitoringScan"("scanCycle");

-- CreateIndex
CREATE INDEX "MonitoringScan_materialDivergencesFound_idx" ON "MonitoringScan"("materialDivergencesFound");

-- CreateIndex
CREATE INDEX "IntelligenceBrief_enterpriseAccountId_idx" ON "IntelligenceBrief"("enterpriseAccountId");

-- CreateIndex
CREATE INDEX "IntelligenceBrief_urgencyLevel_idx" ON "IntelligenceBrief"("urgencyLevel");

-- CreateIndex
CREATE INDEX "IntelligenceBrief_deliveredAt_idx" ON "IntelligenceBrief"("deliveredAt");

-- CreateIndex
CREATE INDEX "BriefDelivery_intelligenceBriefId_idx" ON "BriefDelivery"("intelligenceBriefId");

-- CreateIndex
CREATE INDEX "BriefDelivery_status_idx" ON "BriefDelivery"("status");

-- CreateIndex
CREATE INDEX "ArcTimelineEvent_storyClusterId_idx" ON "ArcTimelineEvent"("storyClusterId");

-- CreateIndex
CREATE INDEX "ArcTimelineEvent_eventType_idx" ON "ArcTimelineEvent"("eventType");

-- CreateIndex
CREATE INDEX "ArcTimelineEvent_eventTimestamp_idx" ON "ArcTimelineEvent"("eventTimestamp");

-- CreateIndex
CREATE INDEX "ArcTimelineEvent_isWildFinding_idx" ON "ArcTimelineEvent"("isWildFinding");

-- CreateIndex
CREATE INDEX "ArcTimelineEvent_isCorrectionEvent_idx" ON "ArcTimelineEvent"("isCorrectionEvent");

-- CreateIndex
CREATE INDEX "Outlet_entityId_idx" ON "Outlet"("entityId");

-- AddForeignKey
ALTER TABLE "Outlet" ADD CONSTRAINT "Outlet_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityMention" ADD CONSTRAINT "EntityMention_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityMention" ADD CONSTRAINT "EntityMention_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntitySignalIndex" ADD CONSTRAINT "EntitySignalIndex_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntitySignalIndex" ADD CONSTRAINT "EntitySignalIndex_rawSignalLayerId_fkey" FOREIGN KEY ("rawSignalLayerId") REFERENCES "RawSignalLayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TickerEntityMap" ADD CONSTRAINT "TickerEntityMap_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "GraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraphEdge" ADD CONSTRAINT "GraphEdge_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "GraphNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityReviewCard" ADD CONSTRAINT "QualityReviewCard_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationRequest" ADD CONSTRAINT "PublicationRequest_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationRequest" ADD CONSTRAINT "PublicationRequest_publishedStoryId_fkey" FOREIGN KEY ("publishedStoryId") REFERENCES "Story"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNamespace" ADD CONSTRAINT "ClientNamespace_enterpriseAccountId_fkey" FOREIGN KEY ("enterpriseAccountId") REFERENCES "EnterpriseAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientOutputTemplate" ADD CONSTRAINT "ClientOutputTemplate_enterpriseAccountId_fkey" FOREIGN KEY ("enterpriseAccountId") REFERENCES "EnterpriseAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalEquityBaseline" ADD CONSTRAINT "HistoricalEquityBaseline_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalSatelliteBaseline" ADD CONSTRAINT "HistoricalSatelliteBaseline_umbrellaArcId_fkey" FOREIGN KEY ("umbrellaArcId") REFERENCES "UmbrellaArc"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialSignal" ADD CONSTRAINT "SocialSignal_socialChannelId_fkey" FOREIGN KEY ("socialChannelId") REFERENCES "SocialChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialSignal" ADD CONSTRAINT "SocialSignal_storyClusterId_fkey" FOREIGN KEY ("storyClusterId") REFERENCES "StoryCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialSignal" ADD CONSTRAINT "SocialSignal_umbrellaArcId_fkey" FOREIGN KEY ("umbrellaArcId") REFERENCES "UmbrellaArc"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialSignal" ADD CONSTRAINT "SocialSignal_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoredPortfolio" ADD CONSTRAINT "MonitoredPortfolio_enterpriseAccountId_fkey" FOREIGN KEY ("enterpriseAccountId") REFERENCES "EnterpriseAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoredEntity" ADD CONSTRAINT "MonitoredEntity_enterpriseAccountId_fkey" FOREIGN KEY ("enterpriseAccountId") REFERENCES "EnterpriseAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoredEntity" ADD CONSTRAINT "MonitoredEntity_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringScan" ADD CONSTRAINT "MonitoringScan_enterpriseAccountId_fkey" FOREIGN KEY ("enterpriseAccountId") REFERENCES "EnterpriseAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringScan" ADD CONSTRAINT "MonitoringScan_monitoredEntityId_fkey" FOREIGN KEY ("monitoredEntityId") REFERENCES "MonitoredEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoringScan" ADD CONSTRAINT "MonitoringScan_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "IntelligenceBrief"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceBrief" ADD CONSTRAINT "IntelligenceBrief_enterpriseAccountId_fkey" FOREIGN KEY ("enterpriseAccountId") REFERENCES "EnterpriseAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelligenceBrief" ADD CONSTRAINT "IntelligenceBrief_monitoredEntityId_fkey" FOREIGN KEY ("monitoredEntityId") REFERENCES "MonitoredEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefDelivery" ADD CONSTRAINT "BriefDelivery_intelligenceBriefId_fkey" FOREIGN KEY ("intelligenceBriefId") REFERENCES "IntelligenceBrief"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArcTimelineEvent" ADD CONSTRAINT "ArcTimelineEvent_storyClusterId_fkey" FOREIGN KEY ("storyClusterId") REFERENCES "StoryCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArcTimelineEvent" ADD CONSTRAINT "ArcTimelineEvent_umbrellaArcId_fkey" FOREIGN KEY ("umbrellaArcId") REFERENCES "UmbrellaArc"("id") ON DELETE SET NULL ON UPDATE CASCADE;
