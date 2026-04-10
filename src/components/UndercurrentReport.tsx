"use client";

import { CostDisplay } from "./CostDisplay";
import { DisplacedStoryCard } from "./DisplacedStoryCard";
import { QuietActionCard } from "./QuietActionCard";
import { TimingAnomalyCard } from "./TimingAnomalyCard";

interface UndercurrentReportProps {
  report: {
    dominantHeadline: string;
    dominantArticleCount?: number;
    synopsis: string;
    riskLevel?: string;
    totalCost: number;
    analysisSeconds?: number;
    dateRangeStart: string | Date;
    dateRangeEnd: string | Date;
    displacedStories: Array<{
      headline: string;
      peakCoverage: string | number;
      dropoffDate: string;
      currentCoverage: string | number;
      coverageDropPct: number;
      wasResolved: boolean;
      resolutionNote: string | null;
      significance: string;
      sampleSources: string;
    }>;
    quietActions: Array<{
      actionType: string;
      title: string;
      description: string;
      date: string;
      source: string;
      mediaCoverage: string;
      significance: string;
      sortOrder: number;
    }>;
    timingAnomalies?: Array<{
      event: string;
      timing: string;
      pattern: string;
      historicalContext: string | null;
      significance: string;
    }>;
    [key: string]: unknown;
  };
}

const RISK_STYLES: Record<string, string> = {
  HIGH: "bg-red-500/20 text-red-400 border-red-500/30",
  MEDIUM: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  LOW: "bg-green-500/20 text-green-400 border-green-500/30",
};

function SectionHeader({
  children,
  accent,
}: {
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <h2
      className="text-xl font-bold text-[#e5e5e5] mb-4 mt-10 flex items-center gap-3"
      style={{ fontFamily: "Playfair Display, serif" }}
    >
      {accent && (
        <span className="w-1 h-6 rounded-full" style={{ backgroundColor: accent }} />
      )}
      {children}
    </h2>
  );
}

function formatDateRange(start: string | Date, end: string | Date) {
  const s = new Date(start).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const e = new Date(end).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${s} \u2013 ${e}`;
}

export function UndercurrentReport({ report }: UndercurrentReportProps) {
  const riskStyle = RISK_STYLES[report.riskLevel ?? 'LOW'] || RISK_STYLES.LOW;
  const sortedActions = [...report.quietActions].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <article className="max-w-3xl mx-auto px-4 py-8">
      {/* Hero */}
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${riskStyle}`}
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            {report.riskLevel} RISK
          </span>
          <span
            className="text-xs text-[#737373]"
            style={{ fontFamily: "JetBrains Mono, monospace" }}
          >
            {formatDateRange(report.dateRangeStart, report.dateRangeEnd)}
          </span>
        </div>
        <h1
          className="text-3xl md:text-4xl font-bold text-[#e5e5e5] mb-4"
          style={{ fontFamily: "Playfair Display, serif" }}
        >
          What happened while you were watching{" "}
          <span className="text-[#a855f7]">&ldquo;{report.dominantHeadline}&rdquo;</span>
        </h1>
        <CostDisplay cost={report.totalCost} seconds={report.analysisSeconds} />
      </header>

      {/* Dominant Story Context */}
      <section className="mb-8">
        <div className="bg-[#a855f7]/5 border border-[#a855f7]/20 rounded-lg p-5">
          <span
            className="text-[10px] font-bold uppercase tracking-wider text-[#a855f7] block mb-2"
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            Dominant Story
          </span>
          <p
            className="text-sm text-[#e5e5e5] font-medium"
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            {report.dominantHeadline}
          </p>
          {report.dominantArticleCount !== undefined && (
            <p
              className="text-xs text-[#737373] mt-1"
              style={{ fontFamily: "JetBrains Mono, monospace" }}
            >
              {report.dominantArticleCount} articles
            </p>
          )}
        </div>
      </section>

      {/* Synopsis */}
      <section className="mb-8">
        <div
          className="prose prose-invert prose-sm max-w-none text-[#a3a3a3]"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          dangerouslySetInnerHTML={{ __html: report.synopsis }}
        />
      </section>

      {/* Displaced Stories */}
      {report.displacedStories.length > 0 && (
        <section>
          <SectionHeader accent="#a855f7">Stories That Disappeared</SectionHeader>
          <div className="space-y-3">
            {report.displacedStories.map((story, i) => (
              <DisplacedStoryCard key={i} story={story} />
            ))}
          </div>
        </section>
      )}

      {/* Quiet Actions */}
      {sortedActions.length > 0 && (
        <section>
          <SectionHeader accent="#a855f7">What Happened Quietly</SectionHeader>
          <div className="space-y-3">
            {sortedActions.map((action, i) => (
              <QuietActionCard key={i} action={action} />
            ))}
          </div>
        </section>
      )}

      {/* Timing Anomalies */}
      {report.timingAnomalies && report.timingAnomalies.length > 0 && (
        <section>
          <SectionHeader accent="#a855f7">Notable Timing</SectionHeader>
          <div className="space-y-3">
            {report.timingAnomalies.map((anomaly, i) => (
              <TimingAnomalyCard key={i} anomaly={anomaly} />
            ))}
          </div>
        </section>
      )}

      {/* Disclaimer */}
      <section className="mt-12 border-t border-[#1e1e1e] pt-6">
        <p
          className="text-xs text-[#737373] italic leading-relaxed"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          Overcurrent documents coverage patterns. Correlation between events does not imply
          coordination. Readers are encouraged to investigate further and draw their own
          conclusions.
        </p>
      </section>
    </article>
  );
}
