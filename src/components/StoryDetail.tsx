"use client";

import { useState } from "react";
import { CostDisplay } from "./CostDisplay";
import { DebateHighlights } from "./DebateHighlights";

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
    debateRounds?: Array<{
      id: string;
      region: string;
      round: number;
      modelName: string;
      provider: string;
      content: string;
    }>;
    followUpQuestions?: string[];
    followUps?: Array<{ question: string; sortOrder: number }>;
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
    [key: string]: unknown;
  };
}

/* ── Helpers ── */

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

function parseList(csv: string): string[] {
  if (!csv || !csv.trim()) return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function SectionRule({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="section-rule"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        marginTop: "48px",
        marginBottom: "16px",
        fontFamily: "var(--font-mono)",
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "var(--text-tertiary)",
      }}
    >
      <span style={{ whiteSpace: "nowrap" }}>{children}</span>
      <span
        style={{
          flex: 1,
          height: "1px",
          background: "var(--border-primary)",
        }}
        aria-hidden="true"
      />
    </div>
  );
}

/* ── Main Component ── */

export function StoryDetail({ story }: StoryDetailProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const sortedClaims = [...story.claims].sort(
    (a, b) => a.sortOrder - b.sortOrder
  );
  const significantSilences = story.silences.filter((s) => s.isSignificant);
  const displaySilences =
    significantSilences.length > 0 && story.silences.length > 5
      ? significantSilences
      : story.silences;

  const confidenceColor = getConfidenceColor(story.confidenceLevel);

  const followUpList =
    story.followUpQuestions ??
    story.followUps?.map((f) => f.question) ??
    [];

  // Group sources by region
  const groupedSources = story.sources.reduce<
    Record<string, typeof story.sources>
  >((acc, source) => {
    const region = source.region || "Unknown";
    if (!acc[region]) acc[region] = [];
    acc[region].push(source);
    return acc;
  }, {});

  return (
    <article
      style={{
        maxWidth: "720px",
        margin: "0 auto",
        padding: "0 24px 80px",
      }}
    >
      {/* ── Disclaimer ── */}
      <div
        className="py-3 border-b"
        style={{
          borderColor: "var(--border-primary)",
          fontSize: "12px",
          color: "var(--text-tertiary)",
          fontFamily: "var(--font-body)",
        }}
      >
        Coverage analysis, not journalism. We could be wrong.{" "}
        <a href="#" style={{ color: "var(--accent-blue, #7B68EE)" }}>
          Flag an error
        </a>
      </div>

      {/* ── Confidence + Consensus ── */}
      <div className="mt-8 flex items-center gap-4">
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: confidenceColor,
          }}
        >
          {story.confidenceLevel.replace(/_/g, " ")} CONFIDENCE
        </span>
        <div
          className="confidence-bar"
          style={{
            width: "120px",
            height: "4px",
            background: "var(--border-primary, #262626)",
            position: "relative",
          }}
        >
          <div
            className="confidence-bar-fill"
            style={{
              width: `${Math.max(0, Math.min(100, story.consensusScore))}%`,
              height: "100%",
              background: confidenceColor,
            }}
          />
        </div>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "14px",
            color: "var(--text-primary)",
          }}
        >
          {story.consensusScore}%
        </span>
      </div>
      <div
        className="mt-1 flex items-center gap-3"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          color: "var(--text-tertiary)",
        }}
      >
        <span>
          {story.sourceCount} sources &middot; {story.countryCount} countries
          &middot; {story.regionCount} regions
        </span>
        <CostDisplay cost={story.totalCost} seconds={story.analysisSeconds} />
      </div>

      {/* ── Headline ── */}
      <h1
        className="mt-6"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "36px",
          fontWeight: 700,
          lineHeight: 1.15,
          letterSpacing: "-0.02em",
          color: "var(--text-primary)",
        }}
      >
        {story.headline}
      </h1>

      {/* ── Model line ── */}
      <div
        className="mt-4 flex items-center gap-2 flex-wrap"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          color: "var(--text-tertiary)",
        }}
      >
        Analyzed by
        <span style={{ color: "var(--model-claude, #D4A574)" }}>
          {"\u25CF"} Claude
        </span>{" "}
        &middot;
        <span style={{ color: "var(--model-gpt, #74D4A5)" }}>
          {"\u25CF"} GPT-4o
        </span>{" "}
        &middot;
        <span style={{ color: "var(--model-gemini, #74A5D4)" }}>
          {"\u25CF"} Gemini
        </span>{" "}
        &middot;
        <span style={{ color: "var(--model-grok, #D47474)" }}>
          {"\u25CF"} Grok
        </span>
      </div>

      {/* ── Synopsis ── */}
      <div
        className="prose-editorial mt-8"
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "15px",
          lineHeight: 1.7,
          color: "var(--text-secondary, #a3a3a3)",
          maxWidth: "720px",
        }}
        dangerouslySetInnerHTML={{ __html: story.synopsis }}
      />

      {/* ── KEY CLAIMS ── */}
      {sortedClaims.length > 0 && (
        <>
          <SectionRule>KEY CLAIMS</SectionRule>
          {sortedClaims.map((claim, i) => {
            const claimColor = getConfidenceColor(claim.confidence);
            const supporters = parseList(claim.supportedBy);
            const contradictors = parseList(claim.contradictedBy);
            return (
              <div
                key={i}
                className="py-4 border-b"
                style={{ borderColor: "var(--border-primary)" }}
              >
                <div className="flex items-start gap-3">
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                      fontWeight: 600,
                      color: claimColor,
                      minWidth: "60px",
                      flexShrink: 0,
                    }}
                  >
                    {getClaimIcon(claim.confidence)}{" "}
                    {claim.confidence.replace(/_/g, " ").toUpperCase()}
                  </span>
                  <div style={{ flex: 1 }}>
                    <p
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: "15px",
                        color: "var(--text-primary)",
                        lineHeight: 1.5,
                      }}
                    >
                      {claim.claim}
                    </p>
                    {/* Consensus bar inline */}
                    <div
                      className="mt-2 flex items-center gap-2"
                      style={{ fontSize: "11px" }}
                    >
                      <div
                        style={{
                          width: "80px",
                          height: "3px",
                          background: "var(--border-primary, #262626)",
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.max(0, Math.min(100, claim.consensusPct))}%`,
                            height: "100%",
                            background: claimColor,
                          }}
                        />
                      </div>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        {claim.consensusPct}%
                      </span>
                    </div>
                    {/* Supporters */}
                    {supporters.length > 0 && (
                      <p
                        className="mt-1"
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "11px",
                          color: "var(--text-tertiary)",
                        }}
                      >
                        Supported by: {supporters.join(", ")}
                      </p>
                    )}
                    {/* Contradictors */}
                    {contradictors.length > 0 && (
                      <p
                        className="mt-1"
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "11px",
                          color: "var(--accent-red)",
                        }}
                      >
                        Contradicted by: {contradictors.join(", ")}
                      </p>
                    )}
                    {/* Notes */}
                    {claim.notes && (
                      <p
                        className="mt-2"
                        style={{
                          fontFamily: "var(--font-body)",
                          fontSize: "13px",
                          color: "var(--text-tertiary)",
                          fontStyle: "italic",
                        }}
                      >
                        {claim.notes}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* ── DEBATE HIGHLIGHTS ── */}
      {story.debateRounds && story.debateRounds.length > 0 && (
        <DebateHighlights debateRounds={story.debateRounds} />
      )}

      {/* ── DISCREPANCIES ── */}
      {story.discrepancies.length > 0 && (
        <>
          <SectionRule>DISCREPANCIES</SectionRule>
          {story.discrepancies.map((d, i) => (
            <div
              key={i}
              className="py-5 border-b"
              style={{ borderColor: "var(--border-primary)" }}
            >
              <p
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  marginBottom: "12px",
                }}
              >
                {d.issue}
              </p>
              {/* Two-column side-by-side with vertical divider */}
              <div
                className="flex gap-0"
                style={{ fontSize: "13px" }}
              >
                <div style={{ flex: 1, paddingRight: "16px" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
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
                      fontFamily: "var(--font-body)",
                      color: "var(--text-secondary, #a3a3a3)",
                      lineHeight: 1.5,
                    }}
                  >
                    {d.sideA}
                  </p>
                  <p
                    style={{
                      fontFamily: "var(--font-mono)",
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
                      fontFamily: "var(--font-mono)",
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
                      fontFamily: "var(--font-body)",
                      color: "var(--text-secondary, #a3a3a3)",
                      lineHeight: 1.5,
                    }}
                  >
                    {d.sideB}
                  </p>
                  <p
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                      color: "var(--text-tertiary)",
                      marginTop: "4px",
                    }}
                  >
                    {d.sourcesB}
                  </p>
                </div>
              </div>
              {/* Assessment */}
              {d.assessment && (
                <p
                  style={{
                    fontFamily: "var(--font-body)",
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
        </>
      )}

      {/* ── COVERAGE OMISSIONS ── */}
      {story.omissions.length > 0 && (
        <>
          <SectionRule>COVERAGE OMISSIONS</SectionRule>
          {story.omissions.map((o, i) => (
            <div
              key={i}
              className="py-4 border-b"
              style={{ borderColor: "var(--border-primary)" }}
            >
              <div className="flex items-start gap-3">
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "var(--accent-amber)",
                    minWidth: "60px",
                    flexShrink: 0,
                  }}
                >
                  {"\u26A0"} {o.outletRegion}
                </span>
                <div style={{ flex: 1 }}>
                  <p
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: "15px",
                      color: "var(--text-primary)",
                      lineHeight: 1.5,
                    }}
                  >
                    {o.missing}
                  </p>
                  <p
                    className="mt-1"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                      color: "var(--text-tertiary)",
                    }}
                  >
                    Present in: {o.presentIn}
                  </p>
                  {o.significance && (
                    <p
                      className="mt-1"
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: "13px",
                        color: "var(--text-tertiary)",
                        fontStyle: "italic",
                      }}
                    >
                      {o.significance}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {/* ── FRAMING ANALYSIS ── */}
      {story.framings.length > 0 && (
        <>
          <SectionRule>FRAMING ANALYSIS</SectionRule>
          {story.framings.map((f, i) => (
            <div
              key={i}
              className="py-4 border-b"
              style={{ borderColor: "var(--border-primary)" }}
            >
              <div className="flex items-start gap-3">
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
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
                      fontFamily: "var(--font-body)",
                      fontSize: "15px",
                      color: "var(--text-primary)",
                      lineHeight: 1.5,
                    }}
                  >
                    {f.framing}
                  </p>
                  {f.contrastWith && (
                    <p
                      className="mt-1"
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: "13px",
                        color: "var(--text-tertiary)",
                        fontStyle: "italic",
                      }}
                    >
                      Contrast: {f.contrastWith}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {/* ── REGIONAL SILENCES ── */}
      {displaySilences.length > 0 && (
        <>
          <SectionRule>REGIONAL SILENCES</SectionRule>
          {displaySilences.map((s, i) => (
            <div
              key={i}
              className="py-4 border-b"
              style={{ borderColor: "var(--border-primary)" }}
            >
              <div className="flex items-start gap-3">
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    fontWeight: 600,
                    color: s.isSignificant
                      ? "var(--accent-red)"
                      : "var(--text-tertiary)",
                    minWidth: "60px",
                    flexShrink: 0,
                  }}
                >
                  {s.isSignificant ? "\u2717" : "\u25CB"} {s.region}
                </span>
                <div style={{ flex: 1 }}>
                  <p
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "12px",
                      color: "var(--text-tertiary)",
                    }}
                  >
                    {s.sourcesSearched} sources searched
                    {s.isSignificant && (
                      <span
                        style={{
                          marginLeft: "8px",
                          color: "var(--accent-red)",
                          fontWeight: 600,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                        }}
                      >
                        SIGNIFICANT
                      </span>
                    )}
                  </p>
                  {s.possibleReasons && (
                    <p
                      className="mt-1"
                      style={{
                        fontFamily: "var(--font-body)",
                        fontSize: "14px",
                        color: "var(--text-secondary, #a3a3a3)",
                        lineHeight: 1.5,
                      }}
                    >
                      {s.possibleReasons}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {/* ── FOLLOW-UP QUESTIONS ── */}
      {followUpList.length > 0 && (
        <>
          <SectionRule>FOLLOW-UP QUESTIONS</SectionRule>
          {followUpList.map((q, i) => (
            <div
              key={i}
              className="py-3 border-b"
              style={{ borderColor: "var(--border-primary)" }}
            >
              <div className="flex items-start gap-3">
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "12px",
                    color: "var(--text-tertiary)",
                    minWidth: "24px",
                    flexShrink: 0,
                  }}
                >
                  {i + 1}.
                </span>
                <p
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "14px",
                    color: "var(--text-secondary, #a3a3a3)",
                    lineHeight: 1.5,
                  }}
                >
                  {q}
                </p>
              </div>
            </div>
          ))}
        </>
      )}

      {/* ── SOURCES (collapsed by default) ── */}
      {story.sources.length > 0 && (
        <>
          <SectionRule>SOURCES</SectionRule>
          <button
            onClick={() => setSourcesOpen(!sourcesOpen)}
            style={{
              fontFamily: "var(--font-mono)",
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
            <span>
              {sourcesOpen ? "\u25BC" : "\u25B6"} {story.sources.length} sources
            </span>
          </button>
          {sourcesOpen && (
            <div>
              {Object.entries(groupedSources).map(
                ([region, regionSources]) => (
                  <div key={region} style={{ marginBottom: "16px" }}>
                    <p
                      style={{
                        fontFamily: "var(--font-mono)",
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
                        className="py-2 border-b flex items-center gap-3 flex-wrap"
                        style={{
                          borderColor: "var(--border-primary)",
                          fontSize: "13px",
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "var(--font-body)",
                            color: "var(--text-primary)",
                          }}
                        >
                          {source.outlet}
                        </span>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "10px",
                            color: "var(--text-tertiary)",
                          }}
                        >
                          {source.country}
                        </span>
                        {source.politicalLean && (
                          <span
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: "10px",
                              color: "var(--text-tertiary)",
                            }}
                          >
                            {source.politicalLean}
                          </span>
                        )}
                        {source.reliability && (
                          <span
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: "10px",
                              color:
                                source.reliability === "high"
                                  ? "var(--accent-green)"
                                  : source.reliability === "low"
                                    ? "var(--accent-red)"
                                    : "var(--accent-amber)",
                            }}
                          >
                            {source.reliability}
                          </span>
                        )}
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontFamily: "var(--font-mono)",
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
                )
              )}
            </div>
          )}
        </>
      )}

      {/* ── Footer ── */}
      <div
        style={{
          marginTop: "64px",
          paddingTop: "24px",
          borderTop: "1px solid var(--border-primary)",
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "14px",
            color: "var(--text-tertiary)",
            fontStyle: "italic",
          }}
        >
          We could be wrong &mdash; help us be right
        </p>
        <div
          className="mt-3 flex items-center justify-center gap-4"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: "var(--text-tertiary)",
          }}
        >
          <a href="#" style={{ color: "var(--accent-purple)" }}>
            Share
          </a>
          <span>&middot;</span>
          <a href="#" style={{ color: "var(--accent-purple)" }}>
            Flag Error
          </a>
          <span>&middot;</span>
          <a href="#" style={{ color: "var(--accent-purple)" }}>
            Discuss
          </a>
        </div>
      </div>
    </article>
  );
}
