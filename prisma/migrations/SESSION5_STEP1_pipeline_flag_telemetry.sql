-- ═══════════════════════════════════════════════════════════════════════════
-- Session 5 Step 1 — Pipeline cost-optimization flag telemetry
--
-- Adds two columns to CostLog so we can record one summary row per analysis
-- with a flag-by-flag breakdown of estimated vs actual cost savings.
--
--   flagBreakdown          — JSON. Null on per-call rows, populated only on
--                            the agentType='pipeline_savings' summary row
--                            written at the end of each runVerifyPipeline run.
--                            Shape documented in
--                            docs/plans/2026-04-19-cost-optimization-layer.md.
--
--   forceFullQualityActive — Boolean (default false). True on the summary row
--                            when PIPELINE_FORCE_FULL_QUALITY bypassed all five
--                            cost-optimization flags for that analysis. Used
--                            to filter savings telemetry so optimized runs
--                            and forced full runs can be analyzed separately.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "CostLog" ADD COLUMN "flagBreakdown" JSONB;
ALTER TABLE "CostLog" ADD COLUMN "forceFullQualityActive" BOOLEAN NOT NULL DEFAULT false;
