"use client";

import { BriefingMissed } from "./BriefingMissed";
import { BriefingFrames } from "./BriefingFrames";
import { BriefingFacts } from "./BriefingFacts";
import { BriefingDispute } from "./BriefingDispute";
import { BriefingWatch } from "./BriefingWatch";
import { BriefingDiscourse } from "./BriefingDiscourse";

// Bridge line component — narrative connective tissue between sections
function Bridge({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p style={{
      fontFamily: "var(--font-body)",
      fontSize: "15px",
      fontStyle: "italic",
      color: "var(--text-secondary, #9A9894)",
      marginTop: "24px",
      marginBottom: "8px",
      lineHeight: 1.5,
    }}>
      {text}
    </p>
  );
}

interface BriefingProps {
  missed: {
    items: Array<{ finding: string; coverage: string; outlets: string[] }>;
  };
  frames: {
    frames: Array<{ name: string; outlet_count: number; summary: string }>;
  };
  facts: {
    onScene: number;
    national: number;
    international: number;
    diedNational: string;
    diedInternational: string;
  };
  dispute: {
    question: string;
    sideA: string;
    sideACount: string;
    sideB: string;
    sideBCount: string;
    resolution: string;
  };
  watch: {
    questions: string[];
  };
  // Discourse data (optional — from discourse gap)
  discourse?: {
    gapScore: number;
    mediaFraming: string;
    publicFraming: string;
    socialFoundFirst: Array<{ finding: string; platform: string; engagement: string }>;
    mediaIgnored: string[];
    redditCount: number;
    twitterCount: number;
  };
  // Bridge lines (optional — AI-generated narrative connectors)
  bridges?: {
    toMissed?: string;
    toFrames?: string;
    toDied?: string;
    toDiscourse?: string;
    toDispute?: string;
    toWatch?: string;
  };
  sourceCount: number;
  outletCount: number;
  countryCount: number;
  modelCount: number;
}

export function Briefing({
  missed, frames, facts, dispute, watch,
  discourse, bridges,
  sourceCount, outletCount, countryCount, modelCount,
}: BriefingProps) {
  const hasContent =
    (missed?.items?.length > 0) ||
    (frames?.frames?.length > 0) ||
    (facts?.onScene > 0 || facts?.national > 0 || facts?.international > 0) ||
    (dispute?.question || dispute?.sideA || dispute?.sideB) ||
    (watch?.questions?.length > 0);

  if (!hasContent) return null;

  return (
    <div style={{ maxWidth: "780px" }}>
      {/* 1. What The World Missed */}
      <Bridge text={bridges?.toMissed} />
      {missed?.items?.length > 0 && <BriefingMissed items={missed.items} />}

      {/* 2. How They Framed It */}
      <Bridge text={bridges?.toFrames} />
      {frames?.frames?.length > 0 && <BriefingFrames frames={frames.frames} />}

      {/* 3. What Died */}
      <Bridge text={bridges?.toDied} />
      {(facts?.onScene > 0 || facts?.national > 0 || facts?.international > 0) && (
        <BriefingFacts
          onScene={facts.onScene}
          national={facts.national}
          international={facts.international}
          diedNational={facts.diedNational}
          diedInternational={facts.diedInternational}
        />
      )}

      {/* 4. What The Public Found */}
      <Bridge text={bridges?.toDiscourse} />
      {discourse && discourse.gapScore > 0 && (
        <BriefingDiscourse
          gapScore={discourse.gapScore}
          mediaFraming={discourse.mediaFraming}
          publicFraming={discourse.publicFraming}
          socialFoundFirst={discourse.socialFoundFirst}
          mediaIgnored={discourse.mediaIgnored}
          redditCount={discourse.redditCount}
          twitterCount={discourse.twitterCount}
        />
      )}

      {/* 5. The Key Dispute */}
      <Bridge text={bridges?.toDispute} />
      {(dispute?.question || dispute?.sideA || dispute?.sideB) && (
        <BriefingDispute
          question={dispute.question}
          sideA={dispute.sideA}
          sideACount={dispute.sideACount}
          sideB={dispute.sideB}
          sideBCount={dispute.sideBCount}
          resolution={dispute.resolution}
        />
      )}

      {/* 6. What To Watch */}
      <Bridge text={bridges?.toWatch} />
      {watch?.questions?.length > 0 && <BriefingWatch questions={watch.questions} />}

      {/* Footer */}
      <div style={{
        borderTop: "1px solid var(--border-primary, #1E1E20)",
        marginTop: "36px", paddingTop: "20px",
        display: "flex", flexDirection: "column" as const, gap: "10px",
      }}>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: "11px",
          color: "var(--text-tertiary, #5C5A56)", letterSpacing: "0.04em",
        }}>
          Analysis based on {sourceCount.toLocaleString()} sources from{" "}
          {outletCount.toLocaleString()} outlets across{" "}
          {countryCount.toLocaleString()} countries using {modelCount} AI models
        </div>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: "12px", fontWeight: 600,
          letterSpacing: "0.04em", color: "var(--accent-teal, #2A9D8F)",
        }}>
          &#9660; View Full Evidence
        </div>
      </div>
    </div>
  );
}
