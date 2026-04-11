"use client";

import { useState, useEffect, useCallback } from "react";
import { ModeToggle } from "@/components/ModeToggle";
import { SearchBar } from "@/components/SearchBar";
import { AnalysisProgress } from "@/components/AnalysisProgress";
import { StoryCard } from "@/components/StoryCard";
import { UndercurrentCard } from "@/components/UndercurrentCard";

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

export default function HomePage() {
  const [mode, setMode] = useState<"verify" | "undercurrent">("verify");
  const [isLoading, setIsLoading] = useState(false);
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);

  const fetchFeed = useCallback(async () => {
    try {
      const [storiesRes, reportsRes] = await Promise.all([
        fetch("/api/stories?limit=20"),
        fetch("/api/reports?limit=20"),
      ]);
      if (storiesRes.ok) {
        const data = await storiesRes.json();
        setStories(data.stories || []);
      }
      if (reportsRes.ok) {
        const data = await reportsRes.json();
        setReports(data.reports || []);
      }
    } catch {
      // silently fail on initial load
    }
  }, []);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  async function handleSubmit(query: string) {
    setIsLoading(true);
    setEvents([]);

    const endpoint = mode === "verify" ? "/api/analyze" : "/api/undercurrent";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      if (!response.body) throw new Error("No response stream");

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

              if (data.event === "complete" || data.phase === "complete") {
                await fetchFeed();
                setIsLoading(false);
              }
              if (data.event === "error" || data.phase === "error") {
                setIsLoading(false);
              }
            } catch {
              // skip malformed SSE events
            }
          }
        }
      }
    } catch (err) {
      setEvents((prev) => [
        ...prev,
        {
          event: "error",
          phase: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Hero */}
      <div className="text-center mb-10">
        <h1 className="font-display font-black text-4xl md:text-5xl mb-3">
          <span className="text-text-muted">OVER</span>
          <span className="text-accent-green">CURRENT</span>
        </h1>
        <p className="text-text-secondary text-lg font-body">
          {mode === "verify"
            ? "Cross-reference global news. Detect omissions. Verify claims."
            : "See what\u2019s under the surface. The news under the news."}
        </p>
      </div>

      {/* Mode Toggle */}
      <div className="flex justify-center mb-6">
        <ModeToggle mode={mode} onToggle={setMode} />
      </div>

      {/* Search */}
      <div className="max-w-2xl mx-auto mb-8">
        <SearchBar mode={mode} onSubmit={handleSubmit} isLoading={isLoading} />
      </div>

      {/* Analysis Progress */}
      {events.length > 0 && (
        <div className="max-w-2xl mx-auto mb-10">
          <AnalysisProgress events={events} mode={mode} />
        </div>
      )}

      {/* Feed */}
      <div className="border-t border-border pt-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display font-bold text-xl text-text-primary">
            {mode === "verify" ? "Recent Analyses" : "Undercurrent Reports"}
          </h2>
          <span className="text-xs font-mono text-text-muted">
            {mode === "verify"
              ? `${stories.length} stories`
              : `${reports.length} reports`}
          </span>
        </div>

        {mode === "verify" ? (
          <div className="grid gap-4">
            {stories.length === 0 && !isLoading && (
              <p className="text-text-muted text-center py-12">
                No stories analyzed yet. Enter a topic above to get started.
              </p>
            )}
            {stories.map((story, i) => (
              <StoryCard key={story.slug} story={story} index={i} />
            ))}
          </div>
        ) : (
          <div className="grid gap-4">
            {reports.length === 0 && !isLoading && (
              <p className="text-text-muted text-center py-12">
                No undercurrent reports yet. Enter a dominant story above to
                analyze what&apos;s being buried.
              </p>
            )}
            {reports.map((report) => (
              <UndercurrentCard
                key={report.slug}
                report={{
                  ...report,
                  displacedStoryCount:
                    report._count?.displacedStories ??
                    report.displacedStories?.length ??
                    0,
                  quietActionCount:
                    report._count?.quietActions ??
                    report.quietActions?.length ??
                    0,
                  riskLevel: report.riskLevel || "MEDIUM",
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
