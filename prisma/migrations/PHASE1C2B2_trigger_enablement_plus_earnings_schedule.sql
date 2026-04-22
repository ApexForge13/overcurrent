-- Phase 1c.2b.2 migration: trigger enablement + earnings schedule.
--
-- Additive, two new tables:
--   TriggerEnablement — DB-backed admin toggle + threshold overrides per
--     trigger. Replaces env-var-only gating with DB → env → ENABLED default
--     fallback chain.
--   EarningsSchedule — projected earnings release dates per tracked entity.
--     Populated by DCF poller; consumed by T-N2 quiet-period guard.

-- ── TriggerEnablement ──────────────────────────────────────────────────
CREATE TABLE "TriggerEnablement" (
    "id" TEXT NOT NULL,
    "triggerId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "thresholdOverrides" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "TriggerEnablement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TriggerEnablement_triggerId_key"
    ON "TriggerEnablement"("triggerId");
CREATE INDEX "TriggerEnablement_triggerId_idx"
    ON "TriggerEnablement"("triggerId");

-- ── EarningsSchedule ───────────────────────────────────────────────────
CREATE TABLE "EarningsSchedule" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "timeOfDay" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EarningsSchedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EarningsSchedule_entityId_reportDate_key"
    ON "EarningsSchedule"("entityId", "reportDate");
CREATE INDEX "EarningsSchedule_ticker_reportDate_idx"
    ON "EarningsSchedule"("ticker", "reportDate");
CREATE INDEX "EarningsSchedule_reportDate_idx"
    ON "EarningsSchedule"("reportDate");

ALTER TABLE "EarningsSchedule"
    ADD CONSTRAINT "EarningsSchedule_entityId_fkey"
    FOREIGN KEY ("entityId") REFERENCES "TrackedEntity"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
