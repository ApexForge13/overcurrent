-- ═══════════════════════════════════════════════════════════════════════════
-- Session 6 Step 1 — PACER Document Approval (Phase 8 per-doc Gate 2 audit log)
--
-- New table: PacerDocumentApproval
--
-- Phase 8 introduces a two-gate approval workflow for PACER (paid federal
-- court document retrieval):
--
--   Gate 1 (cluster-level):   RawSignalQueue.approvedByAdmin = true
--                             — admin approves "investigate this cluster in PACER"
--
--   Gate 2 (per-document):    PacerDocumentApproval.approvedAt IS NOT NULL
--                             — admin approves each document pull above
--                               PACER_AUTO_PULL_THRESHOLD_USD (default $1.00)
--
-- Gate 1 is one row per cluster (on the existing RawSignalQueue table).
-- Gate 2 is one row per document — hence this separate one-to-many table.
--
-- Design doc:    docs/plans/2026-04-19-phase-8-polygon-pacer-design.md (§2)
-- Impl plan:     docs/plans/2026-04-19-phase-8-polygon-pacer.md (Task 2)
--
-- Key fields:
--   rawSignalQueueId   — FK to parent PACER queue row. ON DELETE CASCADE
--                        so per-doc rows vanish with their parent queue row.
--   estimatedCostUsd   — pre-pull estimate. Below PACER_AUTO_PULL_THRESHOLD_USD,
--                        Gate 2 auto-approves on Gate 1 approval.
--   actualCostUsd      — populated after the pull worker fires.
--   recapContribute    — default true. Per-doc opt-in toggle for contributing
--                        the pulled doc to the RECAP public archive.
--   approvedAt/By      — Gate 2 approval. Pull worker refuses to fire without
--                        approvedAt set (invariant assertion).
--   declinedAt/Reason  — Gate 2 decline path.
--   resultSignalLayerId— FK to RawSignalLayer once the pull completes.
-- ═══════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "PacerDocumentApproval" (
    "id" TEXT NOT NULL,
    "rawSignalQueueId" TEXT NOT NULL,
    "docketEntryId" TEXT NOT NULL,
    "docketNumber" TEXT NOT NULL,
    "court" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL,
    "actualCostUsd" DOUBLE PRECISION,
    "recapContribute" BOOLEAN NOT NULL DEFAULT true,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "declinedAt" TIMESTAMP(3),
    "declinedReason" TEXT,
    "recapContributedAt" TIMESTAMP(3),
    "resultSignalLayerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PacerDocumentApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PacerDocumentApproval_rawSignalQueueId_docketEntryId_key" ON "PacerDocumentApproval"("rawSignalQueueId", "docketEntryId");

-- CreateIndex
CREATE INDEX "PacerDocumentApproval_rawSignalQueueId_idx" ON "PacerDocumentApproval"("rawSignalQueueId");

-- CreateIndex
CREATE INDEX "PacerDocumentApproval_approvedAt_idx" ON "PacerDocumentApproval"("approvedAt");

-- CreateIndex
CREATE INDEX "PacerDocumentApproval_declinedAt_idx" ON "PacerDocumentApproval"("declinedAt");

-- CreateIndex
CREATE INDEX "PacerDocumentApproval_resultSignalLayerId_idx" ON "PacerDocumentApproval"("resultSignalLayerId");

-- AddForeignKey
ALTER TABLE "PacerDocumentApproval" ADD CONSTRAINT "PacerDocumentApproval_rawSignalQueueId_fkey" FOREIGN KEY ("rawSignalQueueId") REFERENCES "RawSignalQueue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
