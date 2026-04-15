"use client";

import { BriefingMissed } from "./BriefingMissed";
import { BriefingFrames } from "./BriefingFrames";
import { BriefingFacts } from "./BriefingFacts";
import { BriefingDispute } from "./BriefingDispute";
import { BriefingWatch } from "./BriefingWatch";

interface BriefingProps {
  missed: {
    items: Array<{
      finding: string;
      coverage: string;
      outlets: string[];
    }>;
  };
  frames: {
    frames: Array<{
      name: string;
      outlet_count: number;
      summary: string;
    }>;
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
  sourceCount: number;
  outletCount: number;
  countryCount: number;
  modelCount: number;
}

export function Briefing({
  missed,
  frames,
  facts,
  dispute,
  watch,
  sourceCount,
  outletCount,
  countryCount,
  modelCount,
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
      {/* Briefing sections */}
      {missed?.items?.length > 0 && <BriefingMissed items={missed.items} />}
      {frames?.frames?.length > 0 && <BriefingFrames frames={frames.frames} />}
      {(facts?.onScene > 0 || facts?.national > 0 || facts?.international > 0) && (
        <BriefingFacts
          onScene={facts.onScene}
          national={facts.national}
          international={facts.international}
          diedNational={facts.diedNational}
          diedInternational={facts.diedInternational}
        />
      )}
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
      {watch?.questions?.length > 0 && <BriefingWatch questions={watch.questions} />}

      {/* Footer */}
      <div
        style={{
          borderTop: "1px solid var(--border-primary, #1E1E20)",
          marginTop: "36px",
          paddingTop: "20px",
          display: "flex",
          flexDirection: "column" as const,
          gap: "10px",
        }}
      >
        {/* Stats summary */}
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: "var(--text-tertiary, #5C5A56)",
            letterSpacing: "0.04em",
          }}
        >
          Analysis based on {sourceCount.toLocaleString()} sources from{" "}
          {outletCount.toLocaleString()} outlets across{" "}
          {countryCount.toLocaleString()} countries using {modelCount} AI models
        </div>

        {/* View full evidence prompt */}
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            fontWeight: 600,
            letterSpacing: "0.04em",
            color: "var(--accent-teal, #2A9D8F)",
          }}
        >
          &#9660; View Full Evidence
        </div>
      </div>
    </div>
  );
}
