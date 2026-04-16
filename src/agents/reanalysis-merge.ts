import { callClaude, parseJSON, HAIKU } from '@/lib/anthropic'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MergePlan {
  newClaims: Array<{
    claim: string
    confidence: string
    supportedBy: string
    notes: string
  }>
  upgradedClaims: Array<{
    originalClaimId: string
    originalClaim: string
    newSupportedBy: string
    upgradeNote: string
  }>
  contradictedClaims: Array<{
    originalClaimId: string
    originalClaim: string
    contradictingEvidence: string
    contradictionNote: string
  }>
  newSources: Array<{
    url: string
    title: string
    outlet: string
    outletType: string
    country: string
    region: string
    language: string
    politicalLean: string
    reliability: string
  }>
  newDiscrepancies: Array<{
    issue: string
    sideA: string
    sideB: string
    sourcesA: string
    sourcesB: string
    assessment: string
  }>
  resolvedDiscrepancies: Array<{
    originalId: string
    resolutionNote: string
  }>
  newOmissions: Array<{
    outletRegion: string
    missing: string
    presentIn: string
    significance: string
  }>
  changesSummary: string
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a re-analysis merge agent for Overcurrent, a global news coverage analysis platform.

Your job: compare findings from a V1 analysis with a new V2 pipeline run on the SAME story and produce a structured merge plan.

## What you compare

1. **Claims** — Find claims that are:
   - NEW: present in V2 but not substantially covered by any V1 claim
   - UPGRADED: same factual claim appears in both V1 and V2, but V2 has additional supporting sources → list the new sources
   - CONTRADICTED: V2 contains EXPLICIT contradicting evidence from a NEW source against a V1 claim

2. **Sources** — Identify sources in V2 that were NOT in V1 (by URL dedup). List them with full metadata.

3. **Discrepancies** — Find new discrepancies in V2 not in V1, and V1 discrepancies that V2 evidence resolves.

4. **Omissions** — Find new coverage omissions identified in V2.

5. **Changes summary** — Write 2-3 sentences summarizing the most important changes.

## CRITICAL RULES — READ CAREFULLY

- NEVER remove a V1 finding. Only flag contradictions with evidence.
- A claim that appeared in V1 but not V2 is NOT contradicted — triage variation is not evidence against a claim.
- Only flag a contradiction when V2 has EXPLICIT contradicting evidence from a NEW source.
- If V1 and V2 express the same fact differently, that is an UPGRADE (more sources), not a contradiction.
- When in doubt, classify as upgraded rather than contradicted.
- Do NOT fabricate sources or evidence. Only reference data present in the inputs.

## Response format

Respond with a single JSON object matching this exact shape:
{
  "newClaims": [{ "claim": "...", "confidence": "...", "supportedBy": "...", "notes": "..." }],
  "upgradedClaims": [{ "originalClaimId": "...", "originalClaim": "...", "newSupportedBy": "...", "upgradeNote": "..." }],
  "contradictedClaims": [{ "originalClaimId": "...", "originalClaim": "...", "contradictingEvidence": "...", "contradictionNote": "..." }],
  "newSources": [{ "url": "...", "title": "...", "outlet": "...", "outletType": "...", "country": "...", "region": "...", "language": "...", "politicalLean": "...", "reliability": "..." }],
  "newDiscrepancies": [{ "issue": "...", "sideA": "...", "sideB": "...", "sourcesA": "...", "sourcesB": "...", "assessment": "..." }],
  "resolvedDiscrepancies": [{ "originalId": "...", "resolutionNote": "..." }],
  "newOmissions": [{ "outletRegion": "...", "missing": "...", "presentIn": "...", "significance": "..." }],
  "changesSummary": "2-3 sentence summary of the most important changes"
}

Return ONLY valid JSON, no markdown fences, no commentary.`

// ---------------------------------------------------------------------------
// Merge agent
// ---------------------------------------------------------------------------

const MAX_USER_PROMPT_CHARS = 50_000

export async function runMergeAgent(
  storyHeadline: string,
  v1Claims: Array<{
    id: string
    claim: string
    confidence: string
    supportedBy: string
    contradictedBy: string
    notes: string | null
  }>,
  v1Sources: Array<{ url: string; outlet: string; region: string }>,
  v1Discrepancies: Array<{
    id: string
    issue: string
    sideA: string
    sideB: string
    assessment: string | null
  }>,
  v2Synthesis: {
    claims: Array<{ claim: string; confidence: string; supportedBy: string; contradictedBy: string; notes?: string }>
    discrepancies: Array<{ issue: string; sideA: string; sideB: string; sourcesA: string; sourcesB: string; assessment: string }>
    omissions: Array<{ outletRegion: string; missing: string; presentIn: string; significance: string }>
    buriedEvidence: Array<{ fact: string; reportedBy: string; contradicts: string }>
  },
  v2Sources: Array<{
    url: string
    title: string
    outlet: string
    outletType: string
    country: string
    region: string
    language: string
    politicalLean: string
    reliability: string
  }>,
  storyId?: string,
): Promise<{ plan: MergePlan; costUsd: number }> {
  // Build V1 source URL set for dedup
  const v1SourceUrls = new Set(v1Sources.map((s) => s.url))

  // Filter V2 sources to only those not already in V1
  const genuinelyNewSources = v2Sources.filter((s) => !v1SourceUrls.has(s.url))

  // Build user prompt
  let userPrompt = `# Re-analysis merge for: "${storyHeadline}"

## V1 CLAIMS (with IDs for reference)
${JSON.stringify(
  v1Claims.map((c) => ({
    id: c.id,
    claim: c.claim,
    confidence: c.confidence,
    supportedBy: c.supportedBy,
    contradictedBy: c.contradictedBy,
    notes: c.notes,
  })),
  null,
  2,
)}

## V1 SOURCE URLs (${v1Sources.length} total — for dedup)
${JSON.stringify(v1Sources.map((s) => s.url))}

## V1 DISCREPANCIES (with IDs)
${JSON.stringify(
  v1Discrepancies.map((d) => ({
    id: d.id,
    issue: d.issue,
    sideA: d.sideA,
    sideB: d.sideB,
    assessment: d.assessment,
  })),
  null,
  2,
)}

## V2 CLAIMS (from new pipeline run)
${JSON.stringify(v2Synthesis.claims, null, 2)}

## V2 DISCREPANCIES
${JSON.stringify(v2Synthesis.discrepancies, null, 2)}

## V2 OMISSIONS
${JSON.stringify(v2Synthesis.omissions, null, 2)}

## V2 BURIED EVIDENCE
${JSON.stringify(v2Synthesis.buriedEvidence, null, 2)}

## V2 NEW SOURCES (${genuinelyNewSources.length} sources not in V1)
${JSON.stringify(genuinelyNewSources, null, 2)}

Compare V1 findings against V2 and produce the merge plan.`

  // Cap at 50K chars to fit Haiku context
  if (userPrompt.length > MAX_USER_PROMPT_CHARS) {
    userPrompt = userPrompt.slice(0, MAX_USER_PROMPT_CHARS) + '\n\n[TRUNCATED — produce merge plan from available data]'
  }

  const result = await callClaude({
    model: HAIKU,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    agentType: 'reanalysis-merge',
    maxTokens: 8192,
    storyId,
  })

  const plan = parseJSON<MergePlan>(result.text)

  // Ensure all arrays exist (defensive — Haiku may omit empty arrays)
  plan.newClaims = plan.newClaims ?? []
  plan.upgradedClaims = plan.upgradedClaims ?? []
  plan.contradictedClaims = plan.contradictedClaims ?? []
  plan.newSources = plan.newSources ?? []
  plan.newDiscrepancies = plan.newDiscrepancies ?? []
  plan.resolvedDiscrepancies = plan.resolvedDiscrepancies ?? []
  plan.newOmissions = plan.newOmissions ?? []
  plan.changesSummary = plan.changesSummary ?? 'No significant changes detected.'

  return { plan, costUsd: result.costUsd }
}
