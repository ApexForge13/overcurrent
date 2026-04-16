# Re-Analysis Versioning — Design Document

**Date:** 2026-04-16
**Status:** Implementing

## Overview

Re-analysis is a core Overcurrent capability. Any published story can be re-analyzed at any time via the admin portal. The system runs the full pipeline again, compares new findings against the existing version, and produces an additive merge that preserves all original findings while surfacing new claims, contradictions, and corroborations.

## Architecture

### Execution Flow (V1 — Synchronous on Railway)
```
Admin clicks "Re-Analyze" → POST /api/admin/stories/[id]/reanalyze
  → Set reanalysisStatus = 'running'
  → Run full pipeline (gather → triage → debate → synthesis) with story's original searchQuery
  → Pipeline creates temporary story record with new analysis
  → Merge agent (Haiku) compares V1 data vs V2 pipeline output
  → Atomic DB transaction applies merge:
      - Increment currentVersion
      - Create StoryVersion record
      - Insert new claims/sources/discrepancies with addedInVersion = N
      - Flag contradicted V1 claims (status, contradictionNote)
      - Upgrade corroborated V1 claims
      - Delete temporary story record
  → Set reanalysisStatus = 'review'
  → Admin reviews at /admin/stories/[id]/review
  → Approve publishes V2 / Reject discards changes
```

**Future (V2):** Replace synchronous execution with BullMQ job queue for concurrent runs, retry logic, and progress streaming.

### Schema Changes

**New model:** `StoryVersion` — tracks each analysis version with counters and archived synthesis.

**New fields on Story:** `currentVersion`, `lastReanalyzed`, `isOngoing`, `reanalysisStatus`

**New fields on Claim/Source/Discrepancy/Omission/FramingAnalysis:** `addedInVersion`, `status`

**New fields on Claim only:** `contradictedInVersion`, `contradictionNote`

### Must-Survive Rules

1. Nothing from a previous version is ever deleted. Only flagged.
2. Single-source findings from V1 persist even if V2 didn't find them again.
3. Only explicitly contradicting evidence from a new source downgrades a V1 claim.
4. If a finding was sourced in V1 and no credible source contradicts it, it survives every subsequent version.

### Cost

- Full pipeline: $5-8 per re-analysis
- Merge agent (Haiku): ~$0.02
- Total: ~$5-8 per run, 15-25 minutes

## Files

- `prisma/schema.prisma` — StoryVersion model + version fields
- `src/agents/reanalysis-merge.ts` — Haiku merge agent
- `src/app/api/admin/stories/[id]/reanalyze/route.ts` — trigger + approve/reject
- `src/app/admin/page.tsx` — Re-Analyze button
- `src/app/admin/stories/[id]/review/page.tsx` — diff review page
- `src/app/admin/stories/[id]/review/ReviewActions.tsx` — approve/reject buttons
- `src/components/StoryDetail.tsx` — version badges, What Changed banner
