/**
 * T-GT3 — SEC 8-K material event.
 *
 * PHASE 1c.1 STATUS: scaffolded stub — returns []. Shares the SEC EDGAR
 * adapter refactor/direct-call dependency with T-GT1/T-GT2. Scoped to
 * Phase 1c.2.
 *
 * Fire criteria (per Phase 1 addendum A1.4 T-GT3) — 8-K with Item code:
 *   Item 1.01 (material agreement):         severity 0.7
 *   Item 1.02 (material termination):       severity 0.8
 *   Item 2.01 (completion of acquisition):  severity 0.8
 *   Item 2.03 (material obligation):        severity 0.7
 *   Item 4.02 (non-reliance on financials): severity 1.0 (AUDITOR WARNING)
 *   Item 5.02 (exec change):                severity 0.6
 * Direction: Item 4.02 = -1 always; others defer to LLM sentiment at
 * scoring layer (Phase 2).
 */

import type { TriggerContext, TriggerFireEvent } from '../types'

export async function sec8KTrigger(_ctx: TriggerContext): Promise<TriggerFireEvent[]> {
  // PHASE 1c.2 IMPLEMENTATION: EDGAR search for forms=8-K, parse Item codes
  // from filing metadata, emit fires per severity table above.
  return []
}
