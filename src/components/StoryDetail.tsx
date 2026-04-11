"use client";

import { ConfidenceBadge } from "./ConfidenceBadge";
import { ConsensusScore } from "./ConsensusScore";
import { CostDisplay } from "./CostDisplay";
import { ClaimCard } from "./ClaimCard";
import { DiscrepancyCard } from "./DiscrepancyCard";
import { OmissionCard } from "./OmissionCard";
import { FramingCard } from "./FramingCard";
import { SilenceCard } from "./SilenceCard";
import { SourcesList } from "./SourcesList";
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

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-xl font-bold text-[#e5e5e5] mb-4 mt-10"
      style={{ fontFamily: "Playfair Display, serif" }}
    >
      {children}
    </h2>
  );
}

export function StoryDetail({ story }: StoryDetailProps) {
  const sortedClaims = [...story.claims].sort((a, b) => a.sortOrder - b.sortOrder);
  const significantSilences = story.silences.filter((s) => s.isSignificant);
  const displaySilences =
    significantSilences.length > 0 && story.silences.length > 5
      ? significantSilences
      : story.silences;

  return (
    <article className="max-w-3xl mx-auto px-4 py-8">
      {/* Hero */}
      <header className="mb-8">
        <div className="mb-4">
          <ConfidenceBadge level={story.confidenceLevel} />
        </div>
        <h1
          className="text-3xl md:text-4xl font-bold text-[#e5e5e5] mb-4"
          style={{ fontFamily: "Playfair Display, serif" }}
        >
          {story.headline}
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4">
          <span
            className="text-sm text-[#a3a3a3]"
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            {story.sourceCount} sources &middot; {story.countryCount} countries &middot; {story.regionCount} regions
          </span>
          <CostDisplay cost={story.totalCost} seconds={story.analysisSeconds} />
        </div>
        <div className="max-w-xs">
          <span
            className="text-xs text-[#737373] block mb-1"
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            Consensus
          </span>
          <ConsensusScore score={story.consensusScore} />
        </div>
      </header>

      {/* Synopsis */}
      <section className="mb-8">
        <div
          className="prose prose-invert prose-sm max-w-none text-[#a3a3a3]"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          dangerouslySetInnerHTML={{ __html: story.synopsis }}
        />
      </section>

      {/* Claims */}
      {sortedClaims.length > 0 && (
        <section>
          <SectionHeader>Key Claims</SectionHeader>
          <div className="space-y-3">
            {sortedClaims.map((claim, i) => (
              <ClaimCard key={i} claim={claim} />
            ))}
          </div>
        </section>
      )}

      {/* Debate Highlights */}
      {story.debateRounds && story.debateRounds.length > 0 && (
        <DebateHighlights debateRounds={story.debateRounds} />
      )}

      {/* Discrepancies */}
      {story.discrepancies.length > 0 && (
        <section>
          <SectionHeader>Discrepancies</SectionHeader>
          <div className="space-y-3">
            {story.discrepancies.map((d, i) => (
              <DiscrepancyCard key={i} discrepancy={d} />
            ))}
          </div>
        </section>
      )}

      {/* Omissions */}
      {story.omissions.length > 0 && (
        <section>
          <SectionHeader>Coverage Omissions</SectionHeader>
          <div className="space-y-3">
            {story.omissions.map((o, i) => (
              <OmissionCard key={i} omission={o} />
            ))}
          </div>
        </section>
      )}

      {/* Framing */}
      {story.framings.length > 0 && (
        <section>
          <SectionHeader>Framing Analysis</SectionHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {story.framings.map((f, i) => (
              <FramingCard key={i} framing={f} />
            ))}
          </div>
        </section>
      )}

      {/* Regional Silences */}
      {displaySilences.length > 0 && (
        <section>
          <SectionHeader>Regional Silences</SectionHeader>
          <div className="space-y-3">
            {displaySilences.map((s, i) => (
              <SilenceCard key={i} silence={s} />
            ))}
          </div>
        </section>
      )}

      {/* Follow-up Questions */}
      {((story.followUpQuestions && story.followUpQuestions.length > 0) || (story.followUps && story.followUps.length > 0)) && (
        <section>
          <SectionHeader>Follow-up Questions</SectionHeader>
          <ol className="list-decimal list-inside space-y-2">
            {(story.followUpQuestions ?? story.followUps?.map(f => f.question) ?? []).map((q, i) => (
              <li
                key={i}
                className="text-sm text-[#a3a3a3]"
                style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
              >
                {q}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Sources */}
      {story.sources.length > 0 && (
        <section className="mt-10">
          <SectionHeader>Sources</SectionHeader>
          <SourcesList sources={story.sources} />
        </section>
      )}
    </article>
  );
}
