-- Phase 1c.2b.1 migration: narrative/psych observation stream + CFTC COT.
--
-- Additive changes only. Three new tables, no modifications to existing.
--
-- EntityObservation: raw stream of per-entity signal observations
--   written by the GDELT/RSS/Reddit/Twitter pollers. Rolling 30-day
--   retention via nightly cleanup (not enforced at DB level).
--
-- EntityObservationHourly: pre-aggregated hourly counts feeding baselines.
--   Kept 90 days rolling.
--
-- CftcPosition: weekly CFTC COT disaggregated report snapshots. Kept
--   indefinitely — trend analysis uses the full series.

-- ── EntityObservation ──────────────────────────────────────────────────
CREATE TABLE "EntityObservation" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "outlet" TEXT,
    "sourceUrl" TEXT,
    "title" TEXT,
    "engagement" INTEGER,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EntityObservation_entityId_sourceType_sourceUrl_key"
    ON "EntityObservation"("entityId", "sourceType", "sourceUrl");
CREATE INDEX "EntityObservation_entityId_observedAt_idx"
    ON "EntityObservation"("entityId", "observedAt");
CREATE INDEX "EntityObservation_sourceType_observedAt_idx"
    ON "EntityObservation"("sourceType", "observedAt");
CREATE INDEX "EntityObservation_observedAt_idx"
    ON "EntityObservation"("observedAt");

ALTER TABLE "EntityObservation"
    ADD CONSTRAINT "EntityObservation_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "TrackedEntity"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── EntityObservationHourly ────────────────────────────────────────────
CREATE TABLE "EntityObservationHourly" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metricName" TEXT NOT NULL,
    "hourStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "engagementSum" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntityObservationHourly_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EntityObservationHourly_entityId_metricName_hourStart_key"
    ON "EntityObservationHourly"("entityId", "metricName", "hourStart");
CREATE INDEX "EntityObservationHourly_metricName_hourStart_idx"
    ON "EntityObservationHourly"("metricName", "hourStart");
CREATE INDEX "EntityObservationHourly_entityId_metricName_idx"
    ON "EntityObservationHourly"("entityId", "metricName");

ALTER TABLE "EntityObservationHourly"
    ADD CONSTRAINT "EntityObservationHourly_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "TrackedEntity"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── CftcPosition ───────────────────────────────────────────────────────
CREATE TABLE "CftcPosition" (
    "id" TEXT NOT NULL,
    "marketCode" TEXT NOT NULL,
    "exchangeCode" TEXT NOT NULL,
    "marketName" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "managedMoneyNetPct" DOUBLE PRECISION NOT NULL,
    "managedMoneyLongPct" DOUBLE PRECISION NOT NULL,
    "managedMoneyShortPct" DOUBLE PRECISION NOT NULL,
    "producerNetPct" DOUBLE PRECISION,
    "swapDealerNetPct" DOUBLE PRECISION,
    "openInterestTotal" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CftcPosition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CftcPosition_marketCode_exchangeCode_reportDate_key"
    ON "CftcPosition"("marketCode", "exchangeCode", "reportDate");
CREATE INDEX "CftcPosition_marketCode_reportDate_idx"
    ON "CftcPosition"("marketCode", "reportDate");
CREATE INDEX "CftcPosition_reportDate_idx"
    ON "CftcPosition"("reportDate");
