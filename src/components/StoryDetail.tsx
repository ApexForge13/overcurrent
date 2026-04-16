"use client";

import { CollapsibleSection } from "./CollapsibleSection";
import { ThePattern } from "./ThePattern";
import { RegionalCoverageMap } from "./RegionalCoverageMap";
import { FollowUpQuestions } from "./FollowUpQuestions";
import { DebateHighlights } from "./DebateHighlights";
import { DiscourseGap } from "./DiscourseGap";
import { BuriedEvidence } from "./BuriedEvidence";
import { PropagationGlobeClient } from "./PropagationGlobeWrapper";
import { FactSurvival } from "./FactSurvival";
import { CostDisplay } from "./CostDisplay";
import { Lobby } from "./Lobby";
import { Briefing } from "./Briefing";
import { BriefingMissed } from "./BriefingMissed";
import { BriefingFrames } from "./BriefingFrames";
import { BriefingFacts } from "./BriefingFacts";
import { BriefingDispute } from "./BriefingDispute";
import { BriefingWatch } from "./BriefingWatch";
import { VaultToggle } from "./VaultToggle";

/* ── Types ── */

interface StoryDetailProps {
  story: {
    headline: string;
    synopsis: string;
    confidenceLevel: string;
    sourceCount: number;
    countryCount: number;
    regionCount: number;
    consensusScore: number;
    totalCost: number;
    analysisSeconds: number;
    createdAt: string | Date;
    publishedAt?: string | Date | null;
    sourcesFrom?: string | Date | null;
    sourcesTo?: string | Date | null;
    primaryCategory?: string | null;
    outletCount?: number;
    // Three-tier architecture fields (may not exist on old stories)
    lobbyData?: string | null;
    briefingData?: string | null;
    vaultData?: string | null;
    // Legacy fields (still populated for backward compat)
    thePattern?: string | null;
    framingSplit?: string | null | Array<{
      frameName: string;
      outletCount: number;
      outletTypes: string;
      ledWith: string;
      omitted: string;
      outlets: string;
    }>;
    regionalCoverage?: Array<{
      region: string;
      sourceCount: number;
      coverageLevel: string;
    }>;
    silenceExplanation?: string;
    confidenceNote?: string | null;
    propagationTimeline?: Array<{
      hour: number;
      label: string;
      description: string;
      regions: Array<{
        region_id: string;
        status: string;
        coverage_volume: number;
        dominant_quote: string;
        outlet_count: number;
        key_outlets: string[];
      }>;
      flows: Array<{
        from: string;
        to: string;
        type: string;
      }>;
    }>;
    buriedEvidence?: Array<{
      fact: string;
      reportedBy: string;
      contradicts: string;
      notPickedUpBy: string[];
      sourceType: string;
      whyItMatters: string;
    }>;
    factSurvival?: Array<{
      fact: string;
      originLayer: string;
      survivedTo: string;
      diedAt: string;
      killPoint: string;
      whatWasLost: string;
      significance: string;
    }>;
    // Standard relations
    claims: Array<{
      claim: string;
      confidence: string;
      consensusPct: number;
      supportedBy: string;
      contradictedBy: string;
      notes: string | null;
      sortOrder: number;
    }>;
    discrepancies: Array<{
      issue: string;
      sideA: string;
      sideB: string;
      sourcesA: string;
      sourcesB: string;
      assessment: string | null;
    }>;
    omissions: Array<{
      outletRegion: string;
      missing: string;
      presentIn: string;
      significance: string | null;
    }>;
    framings: Array<{
      region: string;
      framing: string;
      contrastWith: string | null;
    }>;
    silences: Array<{
      region: string;
      sourcesSearched: number;
      possibleReasons: string | null;
      isSignificant: boolean;
    }>;
    followUps?: Array<{ question: string; sortOrder: number }>;
    followUpQuestions?: Array<{
      question: string;
      hypotheses?: string[];
      evidenceStatus?: string;
    }>;
    sources: Array<{
      url: string;
      title: string;
      outlet: string;
      outletType: string;
      country: string;
      region: string;
      politicalLean: string;
      reliability: string;
      [key: string]: unknown;
    }>;
    debateRounds?: Array<{
      id: string;
      region: string;
      round: number;
      modelName: string;
      provider: string;
      content: string;
    }>;
    discourseGap?: {
      mediaDominantFrame: string;
      mediaFramePct: number;
      publicDominantFrame: string;
      publicFramePct: number;
      gapScore: number;
      gapDirection: string;
      gapSummary: string;
      publicSurfacedFirst?: string | null;
      mediaIgnoredByPublic?: string | null;
      publicCounterNarrative?: string | null;
    } | null;
    discourseSnapshots?: Array<{
      id: string;
      platform: string;
      totalEngagement: number;
      postCount: number;
      dominantSentiment: string | null;
      dominantFraming: string | null;
      posts: Array<{
        platform: string;
        url: string | null;
        author: string | null;
        subreddit: string | null;
        content: string;
        upvotes: number;
        comments: number;
        shares: number | null;
        views: number | null;
        authorFollowers: number | null;
        isVerified: boolean;
        framingType: string | null;
        sentiment: string | null;
      }>;
    }>;
    [key: string]: unknown;
  };
}

/* ── Helpers ── */

function renderMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br />");
}

function getConfidenceColor(level: string): string {
  const upper = level.toUpperCase();
  if (upper === "HIGH" || upper === "VERIFIED" || upper === "MOSTLY_VERIFIED")
    return "var(--accent-green)";
  if (upper === "MEDIUM" || upper === "DEVELOPING" || upper === "MIXED")
    return "var(--accent-amber)";
  return "var(--accent-red)";
}

function getClaimIcon(confidence: string): string {
  const upper = confidence.toUpperCase();
  if (upper === "HIGH" || upper === "VERIFIED" || upper === "MOSTLY_VERIFIED") return "\u2713";
  if (upper === "LOW" || upper === "DISPUTED" || upper === "UNVERIFIED") return "\u2717";
  return "\u26A0";
}

function getClaimIconColor(confidence: string): string {
  const upper = confidence.toUpperCase();
  if (upper === "HIGH" || upper === "VERIFIED" || upper === "MOSTLY_VERIFIED")
    return "var(--accent-green)";
  if (upper === "LOW" || upper === "DISPUTED" || upper === "UNVERIFIED")
    return "var(--accent-red)";
  return "var(--accent-amber)";
}

function parseList(csv: string): string[] {
  if (!csv || !csv.trim()) return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Build the confidence bar string: e.g. "88%" -> "████████░░" */
function buildConfidenceBlocks(pct: number): string {
  const filled = Math.round(pct / 10);
  const empty = 10 - filled;
  return "\u2588".repeat(filled) + "\u2591".repeat(empty);
}

/** Count distinct AI model names from debate rounds */
function countModels(debateRounds?: StoryDetailProps["story"]["debateRounds"]): number {
  if (!debateRounds || debateRounds.length === 0) return 4;
  const unique = new Set(
    debateRounds.filter((r) => r.round === 1).map((r) => r.modelName)
  );
  return unique.size || 4;
}

function normalizeOutlet(name: string): string {
  const aliases: Record<string, string> = {
    'repubblica': 'La Repubblica',
    'yonhapnews agency': 'Yonhap News Agency',
  }
  const lower = name.toLowerCase().trim()
  return aliases[lower] || name
}

function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    conflict: 'var(--accent-red, #E24B4A)',
    economy: 'var(--accent-amber, #F4A261)',
    politics: 'var(--accent-blue, #378ADD)',
    tech: 'var(--accent-purple, #a855f7)',
    labor: 'var(--accent-green, #00F5A0)',
    climate: 'var(--accent-green, #00F5A0)',
    health: 'var(--accent-teal, #2A9D8F)',
    society: 'var(--accent-teal, #2A9D8F)',
    trade: 'var(--accent-amber, #F4A261)',
  }
  return colors[category.toLowerCase()] || 'var(--accent-teal, #2A9D8F)'
}

/* ── Shared inline style constants ── */

const mono: React.CSSProperties = { fontFamily: "var(--font-mono)" };
const body: React.CSSProperties = { fontFamily: "var(--font-body)" };

/* ── Main Component ── */

export function StoryDetail({ story }: StoryDetailProps) {
  // Parse framingSplit from DB JSON string if needed
  const framingSplitData: Array<{
    frameName: string;
    outletCount: number;
    outletTypes: string;
    ledWith: string;
    omitted: string;
    outlets: string;
  }> = (() => {
    if (Array.isArray(story.framingSplit)) return story.framingSplit;
    if (typeof story.framingSplit === 'string') {
      try { return JSON.parse(story.framingSplit); } catch { return []; }
    }
    return [];
  })();

  const sortedClaims = [...story.claims].sort((a, b) => a.sortOrder - b.sortOrder);
  const confidenceColor = getConfidenceColor(story.confidenceLevel);
  const modelCount = countModels(story.debateRounds);

  // Deduplicate sources by outlet name within each region, then group by region
  const seenOutlets = new Map<string, typeof story.sources[0]>();
  for (const source of story.sources) {
    const normalized = normalizeOutlet(source.outlet);
    const key = `${normalized}|${source.region}`;
    if (!seenOutlets.has(key)) {
      seenOutlets.set(key, { ...source, outlet: normalized });
    }
  }
  const dedupedSources = [...seenOutlets.values()];
  const groupedSources = dedupedSources.reduce<Record<string, typeof story.sources>>(
    (acc, source) => {
      const region = source.region || "Unknown";
      if (!acc[region]) acc[region] = [];
      acc[region].push(source);
      return acc;
    },
    {}
  );

  // Determine follow-up format — show new format whenever followUpQuestions exist,
  // even if hypotheses are empty (they still show as expandable questions)
  const hasNewFollowUps =
    story.followUpQuestions &&
    story.followUpQuestions.length > 0;

  const oldFollowUps = story.followUps ?? [];

  // Parse confidenceNote for buried evidence (it may be JSON-encoded)
  const parsedNote = (() => {
    try {
      const parsed = JSON.parse(story.confidenceNote || '{}')
      return {
        note: parsed.note || story.confidenceNote,
        confidenceCaveat: parsed.confidenceCaveat as string | undefined,
        buriedEvidence: parsed.buriedEvidence || [],
        propagationTimeline: parsed.propagationTimeline || [],
        factSurvival: parsed.factSurvival || [],
      }
    } catch {
      return { note: story.confidenceNote, confidenceCaveat: undefined, buriedEvidence: [], propagationTimeline: [], factSurvival: [] }
    }
  })()

  // Merge buried evidence from parsed note and direct property
  const buriedEvidenceItems = story.buriedEvidence && story.buriedEvidence.length > 0
    ? story.buriedEvidence
    : parsedNote.buriedEvidence;

  // Merge fact survival from parsed note and direct property
  const factSurvivalItems = story.factSurvival && story.factSurvival.length > 0
    ? story.factSurvival
    : parsedNote.factSurvival;

  // Merge propagation timeline from parsed note and direct property
  const propagationTimeline = story.propagationTimeline && story.propagationTimeline.length > 0
    ? story.propagationTimeline
    : parsedNote.propagationTimeline;

  // Regional coverage: adapt camelCase props to snake_case for the component
  const regionalCoverageData = story.regionalCoverage?.map((r) => ({
    region: r.region,
    source_count: r.sourceCount,
    coverage_level: r.coverageLevel,
  }));

  // Follow-up questions: adapt camelCase to snake_case for the component
  const followUpQuestionsData = story.followUpQuestions?.map((q) => ({
    question: q.question,
    hypotheses: q.hypotheses,
    evidence_status: q.evidenceStatus,
  }));

  // ── Zone 1 prep: "What The World Missed" (top 3 buried + top 2 omissions) ──
  const topBuried = (buriedEvidenceItems || []).slice(0, 3);
  const topOmissions = story.omissions.slice(0, 2);
  const hasWorldMissed = topBuried.length > 0 || topOmissions.length > 0;

  // ── Zone 1 prep: "Framing at a Glance" (top 3 frames, one sentence each) ──
  const glanceFrames = framingSplitData.length > 0
    ? framingSplitData.slice(0, 3)
    : story.framings.slice(0, 3).map(f => ({
        frameName: f.region,
        outletCount: 0,
        outletTypes: '',
        ledWith: f.framing,
        omitted: '',
        outlets: '',
      }));

  // ── Zone 2 prep: claims split ──
  const CLAIMS_PREVIEW = 5;
  const previewClaims = sortedClaims.slice(0, CLAIMS_PREVIEW);
  const remainingClaims = sortedClaims.slice(CLAIMS_PREVIEW);

  // ── Zone 3: Shareable stats ──
  const shareableStats: string[] = [];
  shareableStats.push(`${story.sourceCount} outlets. ${story.countryCount} countries. ${modelCount} AI models argued about this.`);
  if (topBuried[0]) {
    const missed = topBuried[0].notPickedUpBy?.length || 0;
    if (missed > 0) shareableStats.push(`${missed} outlets covered the story but missed: "${topBuried[0].fact.substring(0, 100)}"`);
  }
  const factsKilled = (factSurvivalItems || []).filter((f: {diedAt: string}) => f.diedAt !== 'survived_all');
  if (factsKilled.length > 0) {
    shareableStats.push(`"${factsKilled[0].fact}" died at the ${factsKilled[0].diedAt} boundary.`);
  }
  if (story.thePattern) shareableStats.push(story.thePattern);

  // ── Claim rendering helper ──
  function renderClaim(claim: typeof sortedClaims[0], i: number) {
    const iconColor = getClaimIconColor(claim.confidence);
    const icon = getClaimIcon(claim.confidence);
    const supporters = parseList(claim.supportedBy);
    const contradictors = parseList(claim.contradictedBy);
    const SOURCE_WEIGHTS: Record<string, number> = { state: 0.5, wire: 0.3, tabloid: 0.6, digital: 0.8, newspaper: 1.0, broadcaster: 1.0 };
    const sourcesByOutlet = new Map((story.sources || []).map(s => [s.outlet.toLowerCase(), s]));
    let weightedSupport = 0; let wireCopyCount = 0;
    for (const name of supporters) {
      const src = sourcesByOutlet.get(name.toLowerCase());
      const type = src?.outletType?.toLowerCase() || 'digital';
      weightedSupport += SOURCE_WEIGHTS[type] ?? 0.8;
      if (type === 'wire') wireCopyCount++;
    }
    const total = supporters.length + contradictors.length;
    const rawPct = total > 0 ? Math.round((supporters.length / total) * 100) : 0;
    let maxPct = 100;
    if (weightedSupport <= 0.5) maxPct = 25; else if (weightedSupport <= 1) maxPct = 40;
    else if (weightedSupport <= 2) maxPct = 55; else if (weightedSupport <= 4) maxPct = 70;
    else if (weightedSupport <= 7) maxPct = 85; else maxPct = 95;
    const displayPct = claim.consensusPct > 0 ? Math.min(claim.consensusPct, maxPct) : Math.min(rawPct, maxPct);
    const weightedLabel = weightedSupport !== supporters.length
      ? ` (weighted: ${weightedSupport.toFixed(1)}${wireCopyCount > 0 ? ` · ${wireCopyCount} wire` : ''})` : '';

    return (
      <div key={i} style={{ padding: "16px 0", borderBottom: "1px solid var(--border-primary)", display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <span style={{ ...mono, fontSize: "14px", color: iconColor, flexShrink: 0, width: "20px", textAlign: "center" }}>{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ ...body, fontSize: "15px", color: "var(--text-primary)", lineHeight: 1.5 }}>{claim.claim}</p>
          <div style={{ marginTop: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ width: "80px", height: "3px", background: "var(--border-primary)" }}>
              <div style={{ width: `${Math.max(0, Math.min(100, displayPct))}%`, height: "100%", background: iconColor }} />
            </div>
            <span style={{ ...mono, fontSize: "11px", color: "var(--text-tertiary)" }}>{displayPct}%</span>
          </div>
          {supporters.length > 0 && (
            <p style={{ ...mono, fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px" }}>
              Supported by {supporters.length} outlet{supporters.length !== 1 ? 's' : ''}{weightedLabel}
              {weightedLabel && <span title="Weighted score accounts for outlet independence, reliability rating, and whether the source provided full article text or only a headline." style={{ cursor: 'help', marginLeft: '4px', opacity: 0.6 }}>&#9432;</span>}
              : {supporters.join(", ")}
            </p>
          )}
          {contradictors.length > 0 && (
            <p style={{ ...mono, fontSize: "11px", color: "var(--accent-red)", marginTop: "4px" }}>Contradicted by: {contradictors.join(", ")}</p>
          )}
          {claim.notes && <p style={{ ...body, fontSize: "13px", color: "var(--text-tertiary)", fontStyle: "italic", marginTop: "8px" }}>{claim.notes}</p>}
        </div>
      </div>
    );
  }

  // ── Parse three-tier data (new stories have it; old stories fall back to legacy fields) ──
  const lobbyParsed = (() => {
    if (story.lobbyData) {
      try { return JSON.parse(typeof story.lobbyData === 'string' ? story.lobbyData : JSON.stringify(story.lobbyData)); } catch { return null; }
    }
    return null;
  })();

  const briefingParsed = (() => {
    if (story.briefingData) {
      try { return JSON.parse(typeof story.briefingData === 'string' ? story.briefingData : JSON.stringify(story.briefingData)); } catch { return null; }
    }
    return null;
  })();

  const hasBriefing = briefingParsed && (
    briefingParsed.missed?.length > 0 ||
    briefingParsed.frames?.length > 0 ||
    briefingParsed.key_dispute ||
    briefingParsed.watch?.length > 0
  );

  const uniqueOutlets = new Set(story.sources.map(s => s.outlet)).size;

  return (
    <article className="story-article" style={{ maxWidth: "720px", margin: "0 auto", padding: "0 24px 80px" }}>

      {/* ══════════════ LAYER 1: THE LOBBY ══════════════ */}
      <Lobby
        headline={story.headline}
        pattern={lobbyParsed?.pattern || story.thePattern || ''}
        summary={lobbyParsed?.summary || story.synopsis}
        confidenceLevel={story.confidenceLevel}
        confidenceScore={story.consensusScore}
        category={story.primaryCategory || 'analysis'}
        sourceCount={story.sourceCount}
        outletCount={story.outletCount || uniqueOutlets}
        countryCount={story.countryCount}
        modelCount={modelCount}
        publishedAt={story.publishedAt ? new Date(story.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : new Date(story.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      />

      {/* ══════════════ LAYER 2: THE BRIEFING ══════════════
          Order: Map → Missed → Died → Dispute → Frames → Public → Watch
          Each section connected by a story-specific bridge line.
          ══════════════════════════════════════════════════════ */}
      {hasBriefing ? (
        <div style={{ marginTop: "48px" }}>

          {/* 1. PROPAGATION MAP */}
          {propagationTimeline && propagationTimeline.length >= 3 && (
            <div style={{ marginTop: "0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
                <div style={{ flex: 1, height: "1px", background: "var(--border-primary)" }} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
                  HOW THIS STORY TRAVELED
                </span>
                <div style={{ flex: 1, height: "1px", background: "var(--border-primary)" }} />
              </div>
              <PropagationGlobeClient timeline={propagationTimeline} storyHeadline={story.headline} />
            </div>
          )}

          {/* Bridge: Map → Missed */}
          {briefingParsed.bridges?.toMissed && (
            <p style={{ fontFamily: "var(--font-body)", fontSize: "15px", fontStyle: "italic", color: "var(--text-secondary)", margin: "32px 0", lineHeight: 1.6, maxWidth: "640px" }}>
              {briefingParsed.bridges.toMissed}
            </p>
          )}

          {/* 2. WHAT THE WORLD MISSED */}
          <BriefingMissed items={briefingParsed.missed || []} />

          {/* Bridge: Missed → Died */}
          {briefingParsed.bridges?.toDied && (
            <p style={{ fontFamily: "var(--font-body)", fontSize: "15px", fontStyle: "italic", color: "var(--text-secondary)", margin: "32px 0", lineHeight: 1.6, maxWidth: "640px" }}>
              {briefingParsed.bridges.toDied}
            </p>
          )}

          {/* 3. WHAT DIED */}
          {briefingParsed.fact_survival && (
            <BriefingFacts
              onScene={briefingParsed.fact_survival.on_scene}
              national={briefingParsed.fact_survival.national}
              international={briefingParsed.fact_survival.international}
              diedNational={briefingParsed.fact_survival.died_national}
              diedInternational={briefingParsed.fact_survival.died_international}
            />
          )}

          {/* Bridge: Died → Dispute */}
          {briefingParsed.bridges?.toDispute && (
            <p style={{ fontFamily: "var(--font-body)", fontSize: "15px", fontStyle: "italic", color: "var(--text-secondary)", margin: "32px 0", lineHeight: 1.6, maxWidth: "640px" }}>
              {briefingParsed.bridges.toDispute}
            </p>
          )}

          {/* 4. THE KEY DISPUTE */}
          {briefingParsed.key_dispute && (
            <BriefingDispute
              question={briefingParsed.key_dispute.question}
              sideA={briefingParsed.key_dispute.side_a}
              sideACount={briefingParsed.key_dispute.side_a_count}
              sideB={briefingParsed.key_dispute.side_b}
              sideBCount={briefingParsed.key_dispute.side_b_count}
              resolution={briefingParsed.key_dispute.resolution}
            />
          )}

          {/* Bridge: Dispute → Frames */}
          {briefingParsed.bridges?.toFrames && (
            <p style={{ fontFamily: "var(--font-body)", fontSize: "15px", fontStyle: "italic", color: "var(--text-secondary)", margin: "32px 0", lineHeight: 1.6, maxWidth: "640px" }}>
              {briefingParsed.bridges.toFrames}
            </p>
          )}

          {/* 5. HOW THEY FRAMED IT */}
          <BriefingFrames frames={briefingParsed.frames || []} />

          {/* Bridge: Frames → Public */}
          {briefingParsed.bridges?.toDiscourse && (
            <p style={{ fontFamily: "var(--font-body)", fontSize: "15px", fontStyle: "italic", color: "var(--text-secondary)", margin: "32px 0", lineHeight: 1.6, maxWidth: "640px" }}>
              {briefingParsed.bridges.toDiscourse}
            </p>
          )}

          {/* 6. WHAT THE PUBLIC CAUGHT */}
          {story.discourseGap && (
            <div style={{ marginTop: '32px' }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
                <div style={{ flex: 1, height: "1px", background: "var(--border-primary)" }} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent-purple)" }}>
                  WHAT THE PUBLIC CAUGHT
                </span>
                <div style={{ flex: 1, height: "1px", background: "var(--border-primary)" }} />
              </div>
              <DiscourseGap gap={story.discourseGap} posts={story.discourseSnapshots?.[0]?.posts} />
            </div>
          )}

          {/* Bridge: Public → Watch */}
          {briefingParsed.bridges?.toWatch && (
            <p style={{ fontFamily: "var(--font-body)", fontSize: "15px", fontStyle: "italic", color: "var(--text-secondary)", margin: "32px 0", lineHeight: 1.6, maxWidth: "640px" }}>
              {briefingParsed.bridges.toWatch}
            </p>
          )}

          {/* 7. WHAT TO WATCH */}
          <BriefingWatch questions={briefingParsed.watch || []} />

        </div>
      ) : (
        /* ── LEGACY LAYOUT (for old stories without briefingData) ── */
        <div style={{ marginTop: "48px" }}>
          {/* WHAT THE WORLD MISSED (legacy) */}
          {hasWorldMissed && (
            <div style={{ marginTop: "32px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
                <div style={{ flex: 1, height: "1px", background: "var(--border-primary)" }} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent-red)" }}>
                  WHAT THE WORLD MISSED
                </span>
                <div style={{ flex: 1, height: "1px", background: "var(--border-primary)" }} />
              </div>
              <div style={{ borderLeft: "3px solid var(--accent-red)", paddingLeft: "16px" }}>
                {topBuried.map((b: any, i: number) => (
                  <div key={`buried-${i}`} style={{ marginBottom: "16px" }}>
                    <p style={{ fontFamily: "var(--font-body)", fontSize: "15px", color: "var(--text-primary)", lineHeight: 1.6 }}>{b.fact}</p>
                    <p style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px" }}>
                      Reported by {b.reportedBy}.
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fact Survival (legacy) */}
          {factSurvivalItems && factSurvivalItems.length > 0 && (
            <div style={{ marginTop: "32px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
                <div style={{ flex: 1, height: "1px", background: "var(--border-primary)" }} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
                  FACT SURVIVAL
                </span>
                <div style={{ flex: 1, height: "1px", background: "var(--border-primary)" }} />
              </div>
              <FactSurvival items={factSurvivalItems} />
            </div>
          )}

          {/* Discourse (legacy — also shown in briefing for new stories) */}
          {story.discourseGap && (
            <div style={{ marginTop: "32px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
                <div style={{ flex: 1, height: "1px", background: "var(--border-primary)" }} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent-purple)" }}>
                  WHAT THE PUBLIC CAUGHT
                </span>
                <div style={{ flex: 1, height: "1px", background: "var(--border-primary)" }} />
              </div>
              <DiscourseGap gap={story.discourseGap} posts={story.discourseSnapshots?.[0]?.posts} />
            </div>
          )}

          {/* Propagation Map (legacy) */}
          {/* Propagation map temporarily hidden */}
          {false && propagationTimeline && propagationTimeline.length >= 3 && (
            <div style={{ marginTop: "32px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
                <div style={{ flex: 1, height: "1px", background: "var(--border-primary)" }} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
                  HOW THIS STORY TRAVELED
                </span>
                <div style={{ flex: 1, height: "1px", background: "var(--border-primary)" }} />
              </div>
              <PropagationGlobeClient timeline={propagationTimeline} storyHeadline={story.headline} />
            </div>
          )}
        </div>
      )}

      {/* ══════════════ LAYER 3: THE VAULT ══════════════ */}
      <VaultToggle
        claimCount={sortedClaims.length}
        frameCount={framingSplitData.length || story.framings.length}
        discrepancyCount={story.discrepancies.length}
        sourceCount={story.sourceCount}
      >

      {/* ═══════════════════════════════════════════════════════
          VAULT CONTENT — Full evidence for deep readers
          (Lobby + Briefing are rendered ABOVE VaultToggle)
          ═══════════════════════════════════════════════════════ */}

      <div style={{ marginTop: "0" }}>
        {/* Old Zone 1 fully removed — Lobby + Briefing handle it above */}
      </div>

      {/* Old Zone 1 (headline, stats, pattern) removed — now in Lobby component */}

      {/* Old Zone 1 sections (world missed, framing, fact survival, map, shareable stats)
          removed — now handled by Briefing components above VaultToggle */}

      {/* ═══════════════════════════════════════════════════════
          VAULT EVIDENCE (all sections collapsed by default)
          ═══════════════════════════════════════════════════════ */}

      <div style={{ marginTop: "24px" }}>
      </div>

      {/* ── KEY CLAIMS (show first 5, expand for rest) ── */}
      {sortedClaims.length > 0 && (
        <CollapsibleSection
          title="KEY CLAIMS"
          preview={`${sortedClaims.length} claims verified across ${story.sourceCount} sources`}
          defaultOpen
        >
          {previewClaims.map((claim, i) => renderClaim(claim, i))}
          {remainingClaims.length > 0 && (
            <CollapsibleSection
              title={`${remainingClaims.length} MORE CLAIMS`}
              preview={`Show all ${sortedClaims.length} claims`}
            >
              {remainingClaims.map((claim, i) => renderClaim(claim, CLAIMS_PREVIEW + i))}
            </CollapsibleSection>
          )}
        </CollapsibleSection>
      )}

      {/* ── FULL FRAMING ANALYSIS ── */}
      <div id="full-framing">
        {(framingSplitData && framingSplitData.length > 0) ? (
          <CollapsibleSection
            title="FULL FRAMING ANALYSIS"
            preview={`${framingSplitData.length} distinct frames identified`}
          >
            {framingSplitData.map((frame, i) => (
              <div key={i} style={{ padding: "16px 0", borderBottom: "1px solid var(--border-primary)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "8px" }}>
                  <span style={{ ...mono, fontSize: "12px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-primary)" }}>
                    FRAME {i + 1}: {frame.frameName}
                  </span>
                  <span style={{ ...mono, fontSize: "12px", color: "var(--text-tertiary)" }}>{frame.outletCount} outlets</span>
                </div>
                <p style={{ ...body, fontSize: "13px", color: "var(--text-secondary, #a3a3a3)", marginBottom: "6px" }}>{frame.outletTypes}</p>
                <p style={{ ...mono, fontSize: "11px", color: "var(--text-tertiary)", marginBottom: "2px" }}>Led with: {frame.ledWith}</p>
                <p style={{ ...mono, fontSize: "11px", color: "var(--accent-amber)", marginBottom: "2px" }}>Omitted: {frame.omitted}</p>
                <p style={{ ...mono, fontSize: "11px", color: "var(--text-tertiary)" }}>Outlets: {frame.outlets}</p>
              </div>
            ))}
          </CollapsibleSection>
        ) : story.framings.length > 0 ? (
          <CollapsibleSection title="FRAMING ANALYSIS" preview={`${story.framings.length} regional frames compared`}>
            {story.framings.map((f, i) => (
              <div key={i} style={{ padding: "16px 0", borderBottom: "1px solid var(--border-primary)", display: "flex", alignItems: "flex-start", gap: "12px" }}>
                <span style={{ ...mono, fontSize: "11px", fontWeight: 600, color: "var(--accent-purple)", minWidth: "60px", flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.04em" }}>{f.region}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ ...body, fontSize: "15px", color: "var(--text-primary)", lineHeight: 1.5 }}>{f.framing}</p>
                  {f.contrastWith && <p style={{ ...body, fontSize: "13px", color: "var(--text-tertiary)", fontStyle: "italic", marginTop: "4px" }}>Contrast: {f.contrastWith}</p>}
                </div>
              </div>
            ))}
          </CollapsibleSection>
        ) : null}
      </div>

      {/* ── DISCREPANCIES ── */}
      {story.discrepancies.length > 0 && (
        <CollapsibleSection title="DISCREPANCIES" preview={`${story.discrepancies.length} factual conflicts found`}>
          {story.discrepancies.map((d, i) => (
            <div key={i} style={{ padding: "20px 0", borderBottom: "1px solid var(--border-primary)" }}>
              <p style={{ ...body, fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "12px" }}>{d.issue}</p>
              <div className="discrepancy-columns" style={{ display: "flex", gap: "0", fontSize: "13px" }}>
                <div style={{ flex: 1, paddingRight: "16px" }}>
                  <span style={{ ...mono, fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-tertiary)", display: "block", marginBottom: "4px" }}>SIDE A</span>
                  <p style={{ ...body, color: "var(--text-secondary, #a3a3a3)", lineHeight: 1.5 }}>{d.sideA}</p>
                  <p style={{ ...mono, fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px" }}>{d.sourcesA}</p>
                </div>
                <div className="discrepancy-divider" style={{ width: "1px", background: "var(--border-primary)", flexShrink: 0 }} />
                <div style={{ flex: 1, paddingLeft: "16px" }}>
                  <span style={{ ...mono, fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-tertiary)", display: "block", marginBottom: "4px" }}>SIDE B</span>
                  <p style={{ ...body, color: "var(--text-secondary, #a3a3a3)", lineHeight: 1.5 }}>{d.sideB}</p>
                  <p style={{ ...mono, fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px" }}>{d.sourcesB}</p>
                </div>
              </div>
              {d.assessment && <p style={{ ...body, fontSize: "13px", color: "var(--text-tertiary)", fontStyle: "italic", marginTop: "12px", paddingTop: "8px", borderTop: "1px solid var(--border-primary)" }}>{d.assessment}</p>}
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* ── FULL BURIED LEADS ── */}
      {buriedEvidenceItems && buriedEvidenceItems.length > 0 && (
        <CollapsibleSection title="ALL BURIED LEADS" preview={`${buriedEvidenceItems.length} fact(s) reported but not picked up by national coverage`}>
          <BuriedEvidence items={buriedEvidenceItems} totalSourceCount={story.sourceCount} />
        </CollapsibleSection>
      )}

      {/* ── FULL WHAT'S MISSING ── */}
      {story.omissions.length > 0 && (
        <CollapsibleSection title="ALL OMISSIONS" preview={`${story.omissions.length} omissions detected`}>
          {story.omissions.map((o, i) => (
            <div key={i} style={{ padding: "16px 0", borderBottom: "1px solid var(--border-primary)", display: "flex", alignItems: "flex-start", gap: "12px" }}>
              <span style={{ ...mono, fontSize: "14px", color: "var(--accent-amber)", flexShrink: 0, width: "20px", textAlign: "center" }}>{"\u26A0"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ ...body, fontSize: "15px", color: "var(--text-primary)", lineHeight: 1.5 }}>{o.missing}</p>
                <p style={{ ...mono, fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px" }}>{o.outletRegion} &mdash; Present in: {o.presentIn}</p>
                {o.significance && <p style={{ ...body, fontSize: "13px", color: "var(--text-tertiary)", fontStyle: "italic", marginTop: "4px" }}>{o.significance}</p>}
              </div>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* ── MODEL DEBATE (collapsed by default) ── */}
      {story.debateRounds && story.debateRounds.length > 0 && (
        <CollapsibleSection
          title="MODEL DEBATE"
          preview={`See how ${new Set(story.debateRounds.filter((r) => r.round === 1).map((r) => r.modelName)).size} AI models argued about this story across ${new Set(story.debateRounds.map((r) => r.region)).size} regions`}
        >
          <DebateHighlights debateRounds={story.debateRounds} />
        </CollapsibleSection>
      )}

      {/* ── FOLLOW-UP QUESTIONS ── */}
      {hasNewFollowUps && followUpQuestionsData ? (
        <CollapsibleSection title="FOLLOW-UP QUESTIONS" preview={`${followUpQuestionsData.length} questions to investigate`}>
          <FollowUpQuestions questions={followUpQuestionsData} />
        </CollapsibleSection>
      ) : oldFollowUps.length > 0 ? (
        <CollapsibleSection title="FOLLOW-UP QUESTIONS" preview={`${oldFollowUps.length} questions to investigate`}>
          {[...oldFollowUps].sort((a, b) => a.sortOrder - b.sortOrder).map((q, i) => (
            <div key={i} style={{ padding: "12px 0", borderBottom: "1px solid var(--border-primary)", display: "flex", alignItems: "flex-start", gap: "12px" }}>
              <span style={{ ...mono, fontSize: "12px", color: "var(--text-tertiary)", flexShrink: 0, width: "24px" }}>{i + 1}.</span>
              <p style={{ ...body, fontSize: "14px", color: "var(--text-secondary, #a3a3a3)", lineHeight: 1.5 }}>{q.question}</p>
            </div>
          ))}
        </CollapsibleSection>
      ) : null}

      {/* ── SOURCES ── */}
      {story.sources.length > 0 && (
        <CollapsibleSection title="SOURCES" preview={`${story.sources.length} sources from ${Object.keys(groupedSources).length} regions`} defaultOpen={false}>
          <div>
            {Object.entries(groupedSources).map(([region, regionSources]) => (
              <div key={region} style={{ marginBottom: "16px" }}>
                <p style={{ ...mono, fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: "8px" }}>{region}</p>
                {regionSources.map((source, j) => (
                  <div key={j} style={{ padding: "8px 0", borderBottom: "1px solid var(--border-primary)", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", fontSize: "13px" }}>
                    <span style={{ ...body, color: "var(--text-primary)" }}>{source.outlet}</span>
                    <span style={{ ...mono, fontSize: "10px", color: "var(--text-tertiary)" }}>&middot; {source.country}</span>
                    {source.politicalLean && <span style={{ ...mono, fontSize: "10px", color: "var(--text-tertiary)" }}>&middot; {source.politicalLean}</span>}
                    <a href={source.url} target="_blank" rel="noopener noreferrer" style={{ ...mono, fontSize: "11px", color: "var(--text-tertiary)", marginLeft: "auto" }}>link &rarr;</a>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Discourse section moved to briefing layer above */}

      </VaultToggle>

      {/* ── FOOTER ── */}
      <div style={{ marginTop: "64px", paddingTop: "24px", borderTop: "1px solid var(--border-primary)", display: "flex", alignItems: "center", justifyContent: "center", gap: "16px", ...mono, fontSize: "11px" }}>
        <a href="#" style={{ color: "var(--accent-purple)" }}>Share</a>
        <span style={{ color: "var(--text-tertiary)" }}>&middot;</span>
        <a href="#" style={{ color: "var(--accent-purple)" }}>Flag an error</a>
      </div>
    </article>
  );
}
