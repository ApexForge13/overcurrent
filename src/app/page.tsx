"use client";

import { useState, useEffect, useCallback } from "react";
import { AnalysisProgress } from "@/components/AnalysisProgress";

interface StoryItem {
  slug: string;
  headline: string;
  synopsis: string;
  confidenceLevel: string;
  sourceCount: number;
  countryCount: number;
  regionCount: number;
  consensusScore: number;
  totalCost: number;
  createdAt: string;
}

interface ReportItem {
  slug: string;
  dominantHeadline: string;
  synopsis: string;
  totalCost: number;
  createdAt: string;
  dateRangeStart: string;
  dateRangeEnd: string;
  _count?: { displacedStories: number; quietActions: number };
  displacedStories?: unknown[];
  quietActions?: unknown[];
  riskLevel?: string;
}

interface SSEEvent {
  event: string;
  phase: string;
  message: string;
  slug?: string;
  [key: string]: unknown;
}

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function confidenceColor(level: string): string {
  const l = level.toUpperCase();
  if (l === "HIGH") return "var(--accent-green)";
  if (l === "MEDIUM" || l === "DEVELOPING") return "var(--accent-amber)";
  if (l === "LOW") return "var(--accent-red)";
  return "var(--text-tertiary)";
}

export default function HomePage() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showAnalyzeInput, setShowAnalyzeInput] = useState(false);
  const [query, setQuery] = useState("");
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);

  const fetchFeed = useCallback(async () => {
    try {
      const [storiesRes, reportsRes] = await Promise.all([
        fetch("/api/stories?limit=20"),
        fetch("/api/reports?limit=10"),
      ]);
      if (storiesRes.ok) {
        const data = await storiesRes.json();
        setStories(data.stories || []);
      }
      if (reportsRes.ok) {
        const data = await reportsRes.json();
        setReports(data.reports || []);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchFeed(); }, [fetchFeed]);

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || isAnalyzing) return;
    setIsAnalyzing(true);
    setEvents([]);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });
      if (!response.body) throw new Error("No stream");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6)) as SSEEvent;
              setEvents((prev) => [...prev, data]);
              if (data.phase === "complete" || data.event === "complete") {
                await fetchFeed();
                setIsAnalyzing(false);
                setShowAnalyzeInput(false);
              }
              if (data.phase === "error") setIsAnalyzing(false);
            } catch { /* skip */ }
          }
        }
      }
    } catch { setIsAnalyzing(false); }
  }

  const featured = stories[0];
  const rest = stories.slice(1);

  return (
    <div className="max-w-[1200px] mx-auto px-6">
      {/* Tagline + analyze trigger */}
      <div className="flex items-center justify-between py-6 border-b" style={{ borderColor: 'var(--border-primary)' }}>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: '14px', color: 'var(--text-tertiary)' }}>
          See what's under the surface.
        </p>
        <button
          onClick={() => setShowAnalyzeInput(!showAnalyzeInput)}
          className="text-xs px-3 py-1.5 border transition-colors hover:opacity-80"
          style={{
            fontFamily: 'var(--font-mono)',
            color: 'var(--accent-green)',
            borderColor: 'var(--border-accent)',
            background: 'transparent',
            letterSpacing: '0.04em',
          }}
        >
          + new analysis
        </button>
      </div>

      {/* Analyze input (expandable) */}
      {showAnalyzeInput && (
        <form onSubmit={handleAnalyze} className="py-4 border-b" style={{ borderColor: 'var(--border-primary)' }}>
          <div className="flex gap-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter a story to analyze..."
              disabled={isAnalyzing}
              className="flex-1 px-3 py-2 text-sm border bg-transparent outline-none"
              style={{
                fontFamily: 'var(--font-body)',
                color: 'var(--text-primary)',
                borderColor: 'var(--border-accent)',
              }}
            />
            <button
              type="submit"
              disabled={isAnalyzing || !query.trim()}
              className="px-4 py-2 text-sm border transition-opacity"
              style={{
                fontFamily: 'var(--font-mono)',
                color: isAnalyzing ? 'var(--text-tertiary)' : 'var(--text-primary)',
                borderColor: 'var(--border-accent)',
                background: 'transparent',
                opacity: isAnalyzing ? 0.5 : 1,
              }}
            >
              {isAnalyzing ? "analyzing..." : "analyze"}
            </button>
          </div>
        </form>
      )}

      {/* Analysis progress */}
      {events.length > 0 && (
        <div className="py-6 border-b" style={{ borderColor: 'var(--border-primary)' }}>
          <AnalysisProgress events={events} mode="verify" />
        </div>
      )}

      {/* Main content: newspaper layout */}
      <div className="py-8">
        {stories.length === 0 && !isAnalyzing ? (
          <div className="py-20 text-center" style={{ color: 'var(--text-tertiary)' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 600 }}>No stories yet</p>
            <p className="mt-2 text-sm" style={{ fontFamily: 'var(--font-body)' }}>Click "+ new analysis" to cross-reference your first story.</p>
          </div>
        ) : (
          <div className="flex gap-12 flex-col lg:flex-row">
            {/* Featured story — 60% */}
            {featured && (
              <a href={`/story/${featured.slug}`} className="lg:w-[58%] block group">
                <div className="flex items-center gap-3 mb-3">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: confidenceColor(featured.confidenceLevel) }}>
                    {featured.confidenceLevel}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                    {featured.consensusScore}% consensus
                  </span>
                </div>
                <h2
                  className="group-hover:opacity-80 transition-opacity"
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '36px',
                    fontWeight: 700,
                    lineHeight: 1.15,
                    letterSpacing: '-0.02em',
                    color: 'var(--text-primary)',
                  }}
                >
                  {featured.headline}
                </h2>
                <p className="mt-4 line-clamp-3" style={{ fontFamily: 'var(--font-body)', fontSize: '16px', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                  {featured.synopsis?.replace(/<[^>]*>/g, '').substring(0, 300)}
                </p>
                <div className="mt-4 flex items-center gap-4">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                    {featured.sourceCount} sources
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                    {featured.countryCount} countries
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                    {timeAgo(featured.createdAt)}
                  </span>
                </div>
              </a>
            )}

            {/* Story list — 40% */}
            <div className="lg:w-[42%] lg:border-l lg:pl-8" style={{ borderColor: 'var(--border-primary)' }}>
              <div className="mb-4">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--text-tertiary)' }}>
                  Latest analyses
                </span>
              </div>
              <div>
                {rest.map((story) => (
                  <a
                    key={story.slug}
                    href={`/story/${story.slug}`}
                    className="block py-4 border-b group transition-colors"
                    style={{ borderColor: 'var(--border-primary)' }}
                  >
                    <h3
                      className="group-hover:opacity-70 transition-opacity"
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: '18px',
                        fontWeight: 600,
                        lineHeight: 1.3,
                        letterSpacing: '-0.01em',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {story.headline}
                    </h3>
                    <div className="mt-2 flex items-center gap-3">
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' as const, color: confidenceColor(story.confidenceLevel) }}>
                        {story.confidenceLevel}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                        {story.consensusScore}%
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                        {story.sourceCount} sources
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                        {timeAgo(story.createdAt)}
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Undercurrent section */}
      {reports.length > 0 && (
        <div className="py-8 border-t" style={{ borderColor: 'var(--border-primary)' }}>
          <div className="section-rule"><span>Undercurrent</span></div>
          {reports.map((report) => (
            <a
              key={report.slug}
              href={`/undercurrent/${report.slug}`}
              className="block py-5 border-b group"
              style={{ borderColor: 'var(--border-primary)', borderLeft: '3px solid var(--accent-purple)', paddingLeft: '16px' }}
            >
              <h3
                className="group-hover:opacity-70 transition-opacity"
                style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}
              >
                While everyone watched {report.dominantHeadline}...
              </h3>
              <div className="mt-2 flex items-center gap-4">
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent-purple)' }}>
                  {(report._count?.displacedStories ?? report.displacedStories?.length ?? 0)} displaced stories
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent-purple)' }}>
                  {(report._count?.quietActions ?? report.quietActions?.length ?? 0)} quiet actions
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                  {timeAgo(report.createdAt)}
                </span>
              </div>
            </a>
          ))}
        </div>
      )}

      {/* Stats bar */}
      <div className="py-8 border-t grid grid-cols-2 md:grid-cols-4 gap-8" style={{ borderColor: 'var(--border-primary)' }}>
        {[
          { label: "stories analyzed", value: stories.length },
          { label: "sources checked", value: stories.reduce((n, s) => n + s.sourceCount, 0).toLocaleString() },
          { label: "countries covered", value: [...new Set(stories.flatMap(() => []))].length || stories.reduce((max, s) => Math.max(max, s.countryCount), 0) },
          { label: "models debating", value: 4 },
        ].map((stat) => (
          <div key={stat.label}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '28px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {stat.value}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)', letterSpacing: '0.04em', textTransform: 'uppercase' as const }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
