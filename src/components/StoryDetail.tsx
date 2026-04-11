"use client";

import { useState } from "react";
import { CollapsibleSection } from "./CollapsibleSection";
import { ThePattern } from "./ThePattern";
import { RegionalCoverageMap } from "./RegionalCoverageMap";
import { FollowUpQuestions } from "./FollowUpQuestions";
import { DebateHighlights } from "./DebateHighlights";
import { DiscourseGap } from "./DiscourseGap";
import { CostDisplay } from "./CostDisplay";

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
    // New format fields (may not exist on old stories)
    thePattern?: string;
    framingSplit?: Array<{
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
        subreddit: string | null;
        content: string;
        upvotes: number;
        comments: number;
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

/* ── Shared inline style constants ── */

const mono: React.CSSProperties = { fontFamily: "var(--font-mono)" };
const body: React.CSSProperties = { fontFamily: "var(--font-body)" };

/* ── Main Component ── */

export function StoryDetail({ story }: StoryDetailProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const sortedClaims = [...story.claims].sort((a, b) => a.sortOrder - b.sortOrder);
  const confidenceColor = getConfidenceColor(story.confidenceLevel);
  const modelCount = countModels(story.debateRounds);

  // Group sources by region
  const groupedSources = story.sources.reduce<Record<string, typeof story.sources>>(
    (acc, source) => {
      const region = source.region || "Unknown";
      if (!acc[region]) acc[region] = [];
      acc[region].push(source);
      return acc;
    },
    {}
  );

  // Determine follow-up format
  const hasNewFollowUps =
    story.followUpQuestions &&
    story.followUpQuestions.length > 0 &&
    story.followUpQuestions.some((q) => q.hypotheses && q.hypotheses.length > 0);

  const oldFollowUps = story.followUps ?? [];

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

  return (
    <article
      style={{
        maxWidth: "720px",
        margin: "0 auto",
        padding: "0 24px 80px",
      }}
    >
      {/* ────────────────────────────────────────────────
          1. DISCLAIMER BAR
          ──────────────────────────────────────────────── */}
      <div
        style={{
          padding: "10px 0",
          borderBottom: "1px solid var(--border-primary)",
          fontSize: "12px",
          color: "var(--text-tertiary)",
          ...body,
        }}
      >
        Coverage analysis, not journalism. We could be wrong.
      </div>

      {/* ────────────────────────────────────────────────
          2. VERDICT CARD
          ──────────────────────────────────────────────── */}
      <div style={{ marginTop: "32px" }}>
        {/* Confidence bar row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            ...mono,
          }}
        >
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: confidenceColor,
              whiteSpace: "nowrap",
            }}
          >
            {story.confidenceLevel.replace(/_/g, " ")} CONFIDENCE
          </span>
          <span
            style={{
              fontSize: "14px",
              letterSpacing: "1px",
              color: confidenceColor,
            }}
          >
            {buildConfidenceBlocks(story.consensusScore)}
          </span>
          <span
            style={{
              fontSize: "13px",
              color: "var(--text-primary)",
            }}
          >
            {story.consensusScore}% of {story.sourceCount} sources
          </span>
        </div>

        {/* Large serif headline */}
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "36px",
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            color: "var(--text-primary)",
            marginTop: "20px",
          }}
        >
          {story.headline}
        </h1>

        {/* Summary / synopsis */}
        <div
          style={{
            marginTop: "16px",
            ...body,
            fontSize: "15px",
            lineHeight: 1.7,
            color: "var(--text-secondary, #a3a3a3)",
          }}
          dangerouslySetInnerHTML={{
            __html: `<p>${renderMarkdown(story.synopsis)}</p>`,
          }}
        />

        {/* Stats row */}
        <div
          style={{
            marginTop: "16px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexWrap: "wrap",
            ...mono,
            fontSize: "12px",
            color: "var(--text-tertiary)",
          }}
        >
          <span>{story.sourceCount} sources</span>
          <span style={{ color: "var(--border-primary)" }}>&middot;</span>
          <span>{story.countryCount} countries</span>
          <span style={{ color: "var(--border-primary)" }}>&middot;</span>
          <span>{story.regionCount} {story.regionCount === 1 ? "region" : "regions"}</span>
          <span style={{ color: "var(--border-primary)" }}>&middot;</span>
          <span>{modelCount} AI models</span>
          <span style={{ color: "var(--border-primary)" }}>&middot;</span>
          <CostDisplay cost={story.totalCost} seconds={story.analysisSeconds} />
        </div>

        {/* Model dots */}
        <div
          style={{
            marginTop: "8px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            flexWrap: "wrap",
            ...mono,
            fontSize: "12px",
            color: "var(--text-tertiary)",
          }}
        >
          <span style={{ color: "#D4A574" }}>{"\u25CF"} Claude</span>
          <span style={{ color: "var(--border-primary)" }}>&middot;</span>
          <span style={{ color: "#74D4A5" }}>{"\u25CF"} GPT-4o</span>
          <span style={{ color: "var(--border-primary)" }}>&middot;</span>
          <span style={{ color: "#74A5D4" }}>{"\u25CF"} Gemini</span>
          <span style={{ color: "var(--border-primary)" }}>&middot;</span>
          <span style={{ color: "#D47474" }}>{"\u25CF"} Grok</span>
        </div>
      </div>

      {/* ────────────────────────────────────────────────
          3. THE PATTERN
          ──────────────────────────────────────────────── */}
      {story.thePattern && (
        <ThePattern
          pattern={story.thePattern}
          confidence={story.confidenceLevel.toUpperCase()}
        />
      )}

      {/* ────────────────────────────────────────────────
          4. COLLAPSIBLE SECTIONS
          ──────────────────────────────────────────────── */}

      {/* ── KEY CLAIMS ── */}
      {sortedClaims.length > 0 && (
        <CollapsibleSection
          title="KEY CLAIMS"
          preview={`${sortedClaims.length} claims verified across ${story.sourceCount} sources`}
          defaultOpen
        >
          {sortedClaims.map((claim, i) => {
            const iconColor = getClaimIconColor(claim.confidence);
            const icon = getClaimIcon(claim.confidence);
            const supporters = parseList(claim.supportedBy);
            const contradictors = parseList(claim.contradictedBy);

            return (
              <div
                key={i}
                style={{
                  padding: "16px 0",
                  borderBottom: "1px solid var(--border-primary)",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "12px",
                }}
              >
                <span
                  style={{
                    ...mono,
                    fontSize: "14px",
                    color: iconColor,
                    flexShrink: 0,
                    width: "20px",
                    textAlign: "center",
                  }}
                >
                  {icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      ...body,
                      fontSize: "15px",
                      color: "var(--text-primary)",
                      lineHeight: 1.5,
                    }}
                  >
                    {claim.claim}
                  </p>
                  {/* Consensus bar */}
                  <div
                    style={{
                      marginTop: "8px",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <div
                      style={{
                        width: "80px",
                        height: "3px",
                        background: "var(--border-primary)",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.max(0, Math.min(100, claim.consensusPct))}%`,
                          height: "100%",
                          background: iconColor,
                        }}
                      />
                    </div>
                    <span
                      style={{
                        ...mono,
                        fontSize: "11px",
                        color: "var(--text-tertiary)",
                      }}
                    >
                      {claim.consensusPct}%
                    </span>
                  </div>
                  {supporters.length > 0 && (
                    <p
                      style={{
                        ...mono,
                        fontSize: "11px",
                        color: "var(--text-tertiary)",
                        marginTop: "4px",
                      }}
                    >
                      Supported by: {supporters.join(", ")}
                    </p>
                  )}
                  {contradictors.length > 0 && (
                    <p
                      style={{
                        ...mono,
                        fontSize: "11px",
                        color: "var(--accent-red)",
                        marginTop: "4px",
                      }}
                    >
                      Contradicted by: {contradictors.join(", ")}
                    </p>
                  )}
                  {claim.notes && (
                    <p
                      style={{
                        ...body,
                        fontSize: "13px",
                        color: "var(--text-tertiary)",
                        fontStyle: "italic",
                        marginTop: "8px",
                      }}
                    >
                      {claim.notes}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </CollapsibleSection>
      )}

      {/* ── FRAMING SPLIT ── */}
      {(story.framingSplit && story.framingSplit.length > 0) ? (
        <CollapsibleSection
          title="FRAMING SPLIT"
          preview={`${story.framingSplit.length} distinct frames identified`}
          defaultOpen
        >
          {story.framingSplit.map((frame, i) => (
            <div
              key={i}
              style={{
                padding: "16px 0",
                borderBottom: "1px solid var(--border-primary)",
              }}
            >
              {/* Frame header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: "8px",
                }}
              >
                <span
                  style={{
                    ...mono,
                    fontSize: "12px",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--text-primary)",
                  }}
                >
                  FRAME {i + 1}: {frame.frameName}
                </span>
                <span
                  style={{
                    ...mono,
                    fontSize: "12px",
                    color: "var(--text-tertiary)",
                  }}
                >
                  {frame.outletCount} outlets
                </span>
              </div>
              {/* Outlet types */}
              <p
                style={{
                  ...body,
                  fontSize: "13px",
                  color: "var(--text-secondary, #a3a3a3)",
                  marginBottom: "6px",
                }}
              >
                {frame.outletTypes}
              </p>
              {/* Led with */}
              <p
                style={{
                  ...mono,
                  fontSize: "11px",
                  color: "var(--text-tertiary)",
                  marginBottom: "2px",
                }}
              >
                Led with: {frame.ledWith}
              </p>
              {/* Omitted */}
              <p
                style={{
                  ...mono,
                  fontSize: "11px",
                  color: "var(--accent-amber)",
                  marginBottom: "2px",
                }}
              >
                Omitted: {frame.omitted}
              </p>
              {/* Outlets */}
              <p
                style={{
                  ...mono,
                  fontSize: "11px",
                  color: "var(--text-tertiary)",
                }}
              >
                Outlets: {frame.outlets}
              </p>
            </div>
          ))}
        </CollapsibleSection>
      ) : story.framings.length > 0 ? (
        <CollapsibleSection
          title="FRAMING ANALYSIS"
          preview={`${story.framings.length} regional frames compared`}
          defaultOpen
        >
          {story.framings.map((f, i) => (
            <div
              key={i}
              style={{
                padding: "16px 0",
                borderBottom: "1px solid var(--border-primary)",
                display: "flex",
                alignItems: "flex-start",
                gap: "12px",
              }}
            >
              <span
                style={{
                  ...mono,
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "var(--accent-purple)",
                  minWidth: "60px",
                  flexShrink: 0,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {f.region}
              </span>
              <div style={{ flex: 1 }}>
                <p
                  style={{
                    ...body,
                    fontSize: "15px",
                    color: "var(--text-primary)",
                    lineHeight: 1.5,
                  }}
                >
                  {f.framing}
                </p>
                {f.contrastWith && (
                  <p
                    style={{
                      ...body,
                      fontSize: "13px",
                      color: "var(--text-tertiary)",
                      fontStyle: "italic",
                      marginTop: "4px",
                    }}
                  >
                    Contrast: {f.contrastWith}
                  </p>
                )}
              </div>
            </div>
          ))}
        </CollapsibleSection>
      ) : null}

      {/* ── WHAT'S MISSING ── */}
      {story.omissions.length > 0 && (
        <CollapsibleSection
          title="WHAT'S MISSING"
          preview={`${story.omissions.length} omissions detected`}
        >
          {story.omissions.map((o, i) => (
            <div
              key={i}
              style={{
                padding: "16px 0",
                borderBottom: "1px solid var(--border-primary)",
                display: "flex",
                alignItems: "flex-start",
                gap: "12px",
              }}
            >
              <span
                style={{
                  ...mono,
                  fontSize: "14px",
                  color: "var(--accent-amber)",
                  flexShrink: 0,
                  width: "20px",
                  textAlign: "center",
                }}
              >
                {"\u26A0"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    ...body,
                    fontSize: "15px",
                    color: "var(--text-primary)",
                    lineHeight: 1.5,
                  }}
                >
                  {o.missing}
                </p>
                <p
                  style={{
                    ...mono,
                    fontSize: "11px",
                    color: "var(--text-tertiary)",
                    marginTop: "4px",
                  }}
                >
                  {o.outletRegion} &mdash; Present in: {o.presentIn}
                </p>
                {o.significance && (
                  <p
                    style={{
                      ...body,
                      fontSize: "13px",
                      color: "var(--text-tertiary)",
                      fontStyle: "italic",
                      marginTop: "4px",
                    }}
                  >
                    {o.significance}
                  </p>
                )}
              </div>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* ── DISCREPANCIES ── */}
      {story.discrepancies.length > 0 && (
        <CollapsibleSection
          title="DISCREPANCIES"
          preview={`${story.discrepancies.length} factual conflicts found`}
        >
          {story.discrepancies.map((d, i) => (
            <div
              key={i}
              style={{
                padding: "20px 0",
                borderBottom: "1px solid var(--border-primary)",
              }}
            >
              <p
                style={{
                  ...body,
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  marginBottom: "12px",
                }}
              >
                {d.issue}
              </p>
              {/* Two-column side-by-side */}
              <div
                style={{
                  display: "flex",
                  gap: "0",
                  fontSize: "13px",
                }}
              >
                <div style={{ flex: 1, paddingRight: "16px" }}>
                  <span
                    style={{
                      ...mono,
                      fontSize: "10px",
                      fontWeight: 600,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "var(--text-tertiary)",
                      display: "block",
                      marginBottom: "4px",
                    }}
                  >
                    SIDE A
                  </span>
                  <p
                    style={{
                      ...body,
                      color: "var(--text-secondary, #a3a3a3)",
                      lineHeight: 1.5,
                    }}
                  >
                    {d.sideA}
                  </p>
                  <p
                    style={{
                      ...mono,
                      fontSize: "11px",
                      color: "var(--text-tertiary)",
                      marginTop: "4px",
                    }}
                  >
                    {d.sourcesA}
                  </p>
                </div>
                <div
                  style={{
                    width: "1px",
                    background: "var(--border-primary)",
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, paddingLeft: "16px" }}>
                  <span
                    style={{
                      ...mono,
                      fontSize: "10px",
                      fontWeight: 600,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "var(--text-tertiary)",
                      display: "block",
                      marginBottom: "4px",
                    }}
                  >
                    SIDE B
                  </span>
                  <p
                    style={{
                      ...body,
                      color: "var(--text-secondary, #a3a3a3)",
                      lineHeight: 1.5,
                    }}
                  >
                    {d.sideB}
                  </p>
                  <p
                    style={{
                      ...mono,
                      fontSize: "11px",
                      color: "var(--text-tertiary)",
                      marginTop: "4px",
                    }}
                  >
                    {d.sourcesB}
                  </p>
                </div>
              </div>
              {d.assessment && (
                <p
                  style={{
                    ...body,
                    fontSize: "13px",
                    color: "var(--text-tertiary)",
                    fontStyle: "italic",
                    marginTop: "12px",
                    paddingTop: "8px",
                    borderTop: "1px solid var(--border-primary)",
                  }}
                >
                  {d.assessment}
                </p>
              )}
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* ── MODEL DEBATE ── */}
      {story.debateRounds && story.debateRounds.length > 0 && (
        <CollapsibleSection
          title="MODEL DEBATE"
          preview={`${new Set(story.debateRounds.filter((r) => r.round === 1).map((r) => r.modelName)).size} models debated across ${new Set(story.debateRounds.map((r) => r.region)).size} regions`}
        >
          <DebateHighlights debateRounds={story.debateRounds} />
        </CollapsibleSection>
      )}

      {/* ── DISCOURSE GAP ── */}
      {story.discourseGap && (
        <CollapsibleSection
          title="DISCOURSE GAP"
          preview={`Media says ${story.discourseGap.mediaDominantFrame}. Public says ${story.discourseGap.publicDominantFrame}. ${story.discourseGap.gapScore}-point gap.`}
        >
          <DiscourseGap
            gap={story.discourseGap}
            posts={story.discourseSnapshots?.[0]?.posts}
          />
        </CollapsibleSection>
      )}

      {/* ── REGIONAL COVERAGE ── */}
      {regionalCoverageData && regionalCoverageData.length > 0 && (
        <CollapsibleSection
          title="REGIONAL COVERAGE"
          preview={`${regionalCoverageData.length} regions analyzed`}
        >
          <RegionalCoverageMap
            regions={regionalCoverageData}
            silenceExplanation={story.silenceExplanation}
          />
        </CollapsibleSection>
      )}

      {/* ── FOLLOW-UP QUESTIONS ── */}
      {hasNewFollowUps && followUpQuestionsData ? (
        <CollapsibleSection
          title="FOLLOW-UP QUESTIONS"
          preview={`${followUpQuestionsData.length} questions with hypotheses`}
        >
          <FollowUpQuestions questions={followUpQuestionsData} />
        </CollapsibleSection>
      ) : oldFollowUps.length > 0 ? (
        <CollapsibleSection
          title="FOLLOW-UP QUESTIONS"
          preview={`${oldFollowUps.length} questions to investigate`}
        >
          {[...oldFollowUps]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((q, i) => (
              <div
                key={i}
                style={{
                  padding: "12px 0",
                  borderBottom: "1px solid var(--border-primary)",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "12px",
                }}
              >
                <span
                  style={{
                    ...mono,
                    fontSize: "12px",
                    color: "var(--text-tertiary)",
                    flexShrink: 0,
                    width: "24px",
                  }}
                >
                  {i + 1}.
                </span>
                <p
                  style={{
                    ...body,
                    fontSize: "14px",
                    color: "var(--text-secondary, #a3a3a3)",
                    lineHeight: 1.5,
                  }}
                >
                  {q.question}
                </p>
              </div>
            ))}
        </CollapsibleSection>
      ) : null}

      {/* ── SOURCES ── */}
      {story.sources.length > 0 && (
        <CollapsibleSection
          title="SOURCES"
          preview={`${story.sources.length} sources from ${Object.keys(groupedSources).length} regions`}
          defaultOpen={false}
        >
          <div>
            <button
              onClick={() => setSourcesOpen(!sourcesOpen)}
              style={{
                ...mono,
                fontSize: "12px",
                color: "var(--text-tertiary)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "8px 0",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {sourcesOpen ? "\u25BC" : "\u25B6"} {story.sources.length} sources
            </button>
            {sourcesOpen && (
              <div>
                {Object.entries(groupedSources).map(([region, regionSources]) => (
                  <div key={region} style={{ marginBottom: "16px" }}>
                    <p
                      style={{
                        ...mono,
                        fontSize: "10px",
                        fontWeight: 600,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: "var(--text-tertiary)",
                        marginBottom: "8px",
                      }}
                    >
                      {region}
                    </p>
                    {regionSources.map((source, j) => (
                      <div
                        key={j}
                        style={{
                          padding: "8px 0",
                          borderBottom: "1px solid var(--border-primary)",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          flexWrap: "wrap",
                          fontSize: "13px",
                        }}
                      >
                        <span
                          style={{
                            ...body,
                            color: "var(--text-primary)",
                          }}
                        >
                          {source.outlet}
                        </span>
                        <span
                          style={{
                            ...mono,
                            fontSize: "10px",
                            color: "var(--text-tertiary)",
                          }}
                        >
                          &middot; {source.country}
                        </span>
                        {source.politicalLean && (
                          <span
                            style={{
                              ...mono,
                              fontSize: "10px",
                              color: "var(--text-tertiary)",
                            }}
                          >
                            &middot; {source.politicalLean}
                          </span>
                        )}
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            ...mono,
                            fontSize: "11px",
                            color: "var(--text-tertiary)",
                            marginLeft: "auto",
                          }}
                        >
                          link &rarr;
                        </a>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* ────────────────────────────────────────────────
          5. ACTION BAR
          ──────────────────────────────────────────────── */}
      <div
        style={{
          marginTop: "64px",
          paddingTop: "24px",
          borderTop: "1px solid var(--border-primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          ...mono,
          fontSize: "11px",
        }}
      >
        <a href="#" style={{ color: "var(--accent-purple)" }}>
          Share
        </a>
        <span style={{ color: "var(--text-tertiary)" }}>&middot;</span>
        <a href="#" style={{ color: "var(--accent-purple)" }}>
          Flag an error
        </a>
      </div>
    </article>
  );
}
