/**
 * Single source of truth for product naming.
 *
 * Rename time: update PRODUCT_NAME / PRODUCT_TAGLINE / LEGAL_ENTITY here.
 * Existing hardcoded "Overcurrent" strings across the codebase are NOT yet
 * migrated to import from this module — Phase 0 is a gating pass, not a
 * string-refactor pass. New files written after Phase 0 should import these
 * constants rather than hardcode; the existing-callsite migration is a
 * separate cleanup pass done at rename time.
 */

export const PRODUCT_NAME = 'Overcurrent'
export const PRODUCT_TAGLINE = 'Market intelligence for the moments that matter.'
export const LEGAL_ENTITY = 'Overcurrent' // LLC placeholder — update when filed
