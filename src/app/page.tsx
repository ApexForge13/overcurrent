"use client";

import { useState, useEffect, useCallback } from "react";
import { AnalysisProgress } from "@/components/AnalysisProgress";
import { CATEGORIES, CATEGORY_SLUGS, getCategoryColor } from "@/data/categories";
import { createClient } from "@/lib/supabase/client";

interface StoryItem {
  id: string;
  slug: string;
  headline: string;
  synopsis: string;
  confidenceLevel: string;
  primaryCategory?: string;
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
  const [analyzeMode, setAnalyzeMode] = useState<"verify" | "undercurrent">("verify");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.email === 'connermhecht13@gmail.com') setIsAdmin(true);
      } catch { /* not logged in */ }
    })();
  }, []);

  async function handleDelete(id: string, headline: string) {
    if (!confirm(`Delete "${headline}"?\n\nThis will permanently remove the story and all its data.`)) return;
    try {
      const res = await fetch(`/api/admin/stories/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setStories(prev => prev.filter(s => s.id !== id));
      } else {
        alert('Failed to delete story');
      }
    } catch {
      alert('Failed to delete story');
    }
  }

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
      const endpoint = analyzeMode === "verify" ? "/api/analyze" : "/api/undercurrent";
      const response = await fetch(endpoint, {
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

  const filteredStories = categoryFilter === "all"
    ? stories
    : stories.filter((s) => s.primaryCategory === categoryFilter);
  const searchFiltered = searchQuery.trim()
    ? filteredStories.filter(s =>
        s.headline.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.synopsis?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : filteredStories;
  const featured = searchFiltered[0];
  const rest = searchFiltered.slice(1);

  return (
    <div className="max-w-[1200px] mx-auto px-6">
      {/* Tagline */}
      <div className="py-6 border-b" style={{ borderColor: 'var(--border-primary)' }}>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: '14px', color: 'var(--text-tertiary)' }}>
          Every outlet shows you their version. We show you everyone&apos;s.
        </p>
      </div>

      {/* Analysis progress (visible if admin triggers from /admin) */}
      {events.length > 0 && (
        <div className="py-6 border-b" style={{ borderColor: 'var(--border-primary)' }}>
          <AnalysisProgress events={events} mode={analyzeMode} />
        </div>
      )}

      {/* Category filter pills */}
      {stories.length > 0 && (
        <div className="flex items-center gap-2 py-4 overflow-x-auto flex-nowrap" style={{ borderBottom: '1px solid var(--border-primary)' }}>
          <button
            onClick={() => setCategoryFilter("all")}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              padding: '4px 10px',
              color: categoryFilter === "all" ? 'var(--text-primary)' : 'var(--text-tertiary)',
              background: 'none',
              border: 'none',
              borderBottom: categoryFilter === "all" ? '2px solid var(--text-primary)' : '2px solid transparent',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            ALL
          </button>
          {CATEGORY_SLUGS.filter(s => s !== 'undercurrent').map((slug) => (
            <button
              key={slug}
              onClick={() => setCategoryFilter(slug)}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                padding: '4px 10px',
                color: categoryFilter === slug ? getCategoryColor(slug) : 'var(--text-tertiary)',
                background: 'none',
                border: 'none',
                borderBottom: categoryFilter === slug ? `2px solid ${getCategoryColor(slug)}` : '2px solid transparent',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                textTransform: 'capitalize',
              }}
            >
              {CATEGORIES[slug].label.split(' ')[0]}
            </button>
          ))}
        </div>
      )}

      {/* Search input */}
      {stories.length > 0 && (
        <div className="pt-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search stories..."
            style={{
              width: '100%',
              padding: '8px 0',
              fontFamily: 'var(--font-body)',
              fontSize: '14px',
              background: 'transparent',
              color: 'var(--text-primary)',
              border: 'none',
              borderBottom: '1px solid var(--border-primary)',
              outline: 'none',
              marginBottom: '8px',
            }}
          />
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
              <div className="lg:w-[58%] relative">
                {isAdmin && (
                  <button
                    onClick={() => handleDelete(featured.id, featured.headline)}
                    title="Delete story"
                    style={{
                      position: 'absolute', top: 0, right: 0,
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontFamily: 'var(--font-mono)', fontSize: '14px',
                      color: 'var(--text-tertiary)', padding: '4px 8px',
                      opacity: 0.5, transition: 'opacity 150ms, color 150ms',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--accent-red)'; }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
                  >
                    {"\u2715"}
                  </button>
                )}
                <a href={`/story/${featured.slug}`} className="block group">
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
              </div>
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
                  <div
                    key={story.slug}
                    className="relative py-4 border-b"
                    style={{ borderColor: 'var(--border-primary)' }}
                  >
                    {isAdmin && (
                      <button
                        onClick={() => handleDelete(story.id, story.headline)}
                        title="Delete story"
                        style={{
                          position: 'absolute', top: '12px', right: 0,
                          background: 'none', border: 'none', cursor: 'pointer',
                          fontFamily: 'var(--font-mono)', fontSize: '12px',
                          color: 'var(--text-tertiary)', padding: '2px 6px',
                          opacity: 0.4, transition: 'opacity 150ms, color 150ms',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--accent-red)'; }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = '0.4'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}
                      >
                        {"\u2715"}
                      </button>
                    )}
                    <a
                      href={`/story/${story.slug}`}
                      className="block group transition-colors"
                    >
                      <h3
                        className="group-hover:opacity-70 transition-opacity pr-6"
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
                  </div>
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
