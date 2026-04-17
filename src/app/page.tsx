"use client";

import { useState, useEffect, useCallback } from "react";
import { AnalysisProgress } from "@/components/AnalysisProgress";
import { CATEGORIES, getCategoryColor } from "@/data/categories";
import { createClient } from "@/lib/supabase/client";

// ── Types ──────────────────────────────────────────────────────────────────
interface StoryItem {
  id: string;
  slug: string;
  headline: string;
  synopsis: string;
  confidenceLevel: string;
  primaryCategory?: string;
  thePattern?: string;
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

// ── Helpers ────────────────────────────────────────────────────────────────
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

function confidencePct(level: string, consensus: number): string {
  // Prefer consensus score if available, else approximate from level
  if (consensus && consensus > 0) return `${consensus}%`;
  const l = level.toUpperCase();
  if (l === "HIGH") return "80%+";
  if (l === "MEDIUM") return "60%";
  if (l === "DEVELOPING") return "50%";
  if (l === "LOW") return "<50%";
  return "";
}

/** Extract the Pattern — the compelling italic line — or fall back to stats */
function buildPattern(story: StoryItem): string {
  if (story.thePattern && story.thePattern.length > 10 && story.thePattern.length < 320) {
    return story.thePattern;
  }
  return `${story.sourceCount} sources across ${story.countryCount} countries. ${story.consensusScore}% agreed on what happened.`;
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function HomePage() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeMode] = useState<"verify" | "undercurrent">("verify");
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
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

  const featured = stories[0];
  const latest = stories.slice(1);

  // Aggregate stats
  const totalStories = stories.length;
  const totalSources = stories.reduce((sum, s) => sum + s.sourceCount, 0);
  const maxCountries = stories.reduce((max, s) => Math.max(max, s.countryCount), 0);

  return (
    <div>
      {/* Top tagline — minimal, centered */}
      <div className="max-w-[1200px] mx-auto px-6 py-8">
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: '13px',
            color: 'var(--text-tertiary)',
            letterSpacing: '0.01em',
          }}
        >
          Every outlet shows you their version. <span style={{ color: 'var(--text-secondary)' }}>We show you everyone&apos;s.</span>
        </p>
      </div>

      {/* Analysis progress (admin only, when triggered) */}
      {events.length > 0 && (
        <div className="max-w-[1200px] mx-auto px-6 py-6 border-t border-b" style={{ borderColor: 'var(--border-primary)' }}>
          <AnalysisProgress events={events} mode={analyzeMode} />
        </div>
      )}

      {/* Empty state */}
      {stories.length === 0 && !isAnalyzing ? (
        <div className="max-w-[1200px] mx-auto px-6 py-24 text-center" style={{ color: 'var(--text-tertiary)' }}>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: '32px', fontWeight: 600, color: 'var(--text-secondary)' }}>
            No stories yet
          </p>
          <p className="mt-3" style={{ fontFamily: 'var(--font-body)', fontSize: '14px' }}>
            New analyses appear here after they clear admin review.
          </p>
        </div>
      ) : (
        <>
          {/* ═══════════════ HERO + SIDEBAR LIST ═══════════════ */}
          {featured && (
            <section
              className="hero-fade-in"
              style={{
                background: 'linear-gradient(180deg, rgba(42, 157, 143, 0.03) 0%, transparent 100%)',
                borderBottom: '1px solid var(--border-primary)',
              }}
            >
              <div className="max-w-[1200px] mx-auto px-6 py-14 md:py-20">
                <div className="flex flex-col lg:flex-row lg:gap-12">
                  {/* Featured — left column (~60%) */}
                  <div className="lg:w-[60%] relative">
                    <HeroAnalysis story={featured} isAdmin={isAdmin} onDelete={handleDelete} />
                  </div>

                  {/* Sidebar list — right column (~40%) */}
                  {latest.length > 0 && (
                    <aside className="lg:w-[40%] mt-16 lg:mt-0 lg:border-l lg:pl-10" style={{ borderColor: 'var(--border-primary)' }}>
                      <SectionLabel>Latest analyses</SectionLabel>
                      <div className="mt-6">
                        {latest.slice(0, 5).map((story, i) => (
                          <SidebarRow key={story.slug} story={story} isAdmin={isAdmin} onDelete={handleDelete} index={i} />
                        ))}
                      </div>
                    </aside>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* Overflow: stories 6+ as additional compact rows below the hero */}
          {latest.length > 5 && (
            <section className="max-w-[1200px] mx-auto px-6 py-12">
              <SectionLabel>More analyses</SectionLabel>
              <div className="mt-6">
                {latest.slice(5).map((story, i) => (
                  <SidebarRow key={story.slug} story={story} isAdmin={isAdmin} onDelete={handleDelete} index={i} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* ═══════════════ UNDERCURRENT ═══════════════ */}
      {reports.length > 0 && (
        <section className="max-w-[1200px] mx-auto px-6 py-16 border-t" style={{ borderColor: 'var(--border-primary)' }}>
          <SectionLabel>Undercurrent</SectionLabel>
          <div className="mt-8 space-y-5">
            {reports.map((report) => (
              <a
                key={report.slug}
                href={`/undercurrent/${report.slug}`}
                className="block py-5 border-b group hover-card"
                style={{
                  borderColor: 'var(--border-primary)',
                  borderLeft: '3px solid var(--accent-purple)',
                  paddingLeft: '20px',
                  transition: 'background 200ms ease, transform 200ms ease',
                }}
              >
                <h3
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '20px',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    lineHeight: 1.3,
                  }}
                >
                  While everyone watched {report.dominantHeadline}...
                </h3>
                <div className="mt-3 flex items-center gap-5">
                  <StatChip color="var(--accent-purple)">
                    {(report._count?.displacedStories ?? report.displacedStories?.length ?? 0)} displaced stories
                  </StatChip>
                  <StatChip color="var(--accent-purple)">
                    {(report._count?.quietActions ?? report.quietActions?.length ?? 0)} quiet actions
                  </StatChip>
                  <StatChip>{timeAgo(report.createdAt)}</StatChip>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* ═══════════════ BY THE NUMBERS ═══════════════ */}
      {stories.length > 0 && (
        <section className="max-w-[1200px] mx-auto px-6 py-20 border-t" style={{ borderColor: 'var(--border-primary)' }}>
          <SectionLabel>By the numbers</SectionLabel>
          <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-4">
            <Stat number={totalStories.toString()} label="stories analyzed" />
            <Stat number={totalSources.toLocaleString()} label="sources checked" />
            <Stat number={maxCountries.toString()} label="countries covered" />
            <Stat number="4" label="models debating" />
          </div>
        </section>
      )}

      {/* ═══════════════ SUBSCRIBE ═══════════════ */}
      <SubscribeBar />

      {/* Page-level animations + hover effects */}
      <style jsx global>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .hero-fade-in {
          animation: fadeUp 500ms ease-out both;
        }
        .grid-fade-in {
          animation: fadeUp 500ms ease-out both;
        }
        .stats-fade-in {
          animation: fadeIn 600ms ease-out both;
          animation-delay: 300ms;
        }
        .hover-card:hover {
          background: rgba(42, 157, 143, 0.03);
          transform: translateY(-2px);
        }
        .analysis-card:hover {
          border-color: rgba(42, 157, 143, 0.4) !important;
          transform: translateY(-2px);
        }
        .cta-arrow {
          display: inline-block;
          transition: transform 200ms ease;
        }
        .cta-link:hover .cta-arrow {
          transform: translateX(3px);
        }
      `}</style>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// HERO ANALYSIS
// ───────────────────────────────────────────────────────────────────────────
function HeroAnalysis({
  story,
  isAdmin,
  onDelete,
}: {
  story: StoryItem;
  isAdmin: boolean;
  onDelete: (id: string, headline: string) => void;
}) {
  const pattern = buildPattern(story);
  const category = story.primaryCategory;
  const categoryColor = category ? getCategoryColor(category) : 'var(--text-tertiary)';
  const categoryLabel = category
    ? CATEGORIES[category as keyof typeof CATEGORIES]?.label.split(' ')[0] ?? category
    : null;
  const confColor = confidenceColor(story.confidenceLevel);

  return (
    <div className="relative">
      {/* Admin delete */}
      {isAdmin && (
        <button
          onClick={() => onDelete(story.id, story.headline)}
          title="Delete story"
          style={{
            position: 'absolute',
            top: '-8px',
            right: '0',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: '14px',
            color: 'var(--text-tertiary)',
            padding: '4px 8px',
            opacity: 0.4,
            transition: 'opacity 150ms, color 150ms',
            zIndex: 2,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '1';
            e.currentTarget.style.color = 'var(--accent-red)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '0.4';
            e.currentTarget.style.color = 'var(--text-tertiary)';
          }}
        >
          {"\u2715"}
        </button>
      )}

      {/* Featured label row */}
      <div className="flex items-center gap-4 mb-8">
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            fontWeight: 600,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--text-tertiary)',
          }}
        >
          Featured analysis
        </span>
        <div style={{ flex: 1, maxWidth: '48px', height: '1px', background: 'var(--border-primary)' }} />
        {categoryLabel && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              fontWeight: 700,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: categoryColor,
            }}
          >
            {categoryLabel}
          </span>
        )}
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: confColor,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: confColor,
            }}
          />
          {story.confidenceLevel} · {confidencePct(story.confidenceLevel, story.consensusScore)}
        </span>
      </div>

      {/* THE PATTERN — hero text */}
      <a
        href={`/story/${story.slug}`}
        className="block group cta-link"
        style={{ textDecoration: 'none', color: 'inherit' }}
      >
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(22px, 2.6vw, 32px)',
            fontWeight: 600,
            lineHeight: 1.3,
            letterSpacing: '-0.01em',
            color: 'var(--text-primary)',
            fontStyle: 'italic',
            transition: 'color 200ms ease',
          }}
        >
          <span style={{ color: 'var(--accent-teal, #2A9D8F)', marginRight: '6px' }}>&ldquo;</span>
          {pattern}
          <span style={{ color: 'var(--accent-teal, #2A9D8F)', marginLeft: '6px' }}>&rdquo;</span>
        </h1>

        {/* Headline — subtitle treatment */}
        <h2
          className="mt-6"
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'clamp(15px, 1.3vw, 17px)',
            fontWeight: 400,
            lineHeight: 1.55,
            color: 'var(--text-secondary)',
          }}
        >
          {story.headline}
        </h2>

        {/* Stats bar */}
        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2">
          <HeroStat>{story.sourceCount.toLocaleString()} sources</HeroStat>
          <HeroStat>{story.countryCount} countries</HeroStat>
          <HeroStat>{story.regionCount} regions</HeroStat>
          <HeroStat>4 AI models</HeroStat>
          <HeroStat muted>{timeAgo(story.createdAt)}</HeroStat>
        </div>

        {/* CTA */}
        <div className="mt-6">
          <span
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: '14px',
              fontWeight: 500,
              color: 'var(--accent-teal, #2A9D8F)',
              letterSpacing: '0.01em',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              borderBottom: '1px solid rgba(42, 157, 143, 0.3)',
              paddingBottom: '2px',
            }}
          >
            Read full analysis
            <span className="cta-arrow">&rarr;</span>
          </span>
        </div>
      </a>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// SIDEBAR ROW — compact list item, white headline, no italic teal Pattern
// ───────────────────────────────────────────────────────────────────────────
function SidebarRow({
  story,
  isAdmin,
  onDelete,
  index,
}: {
  story: StoryItem;
  isAdmin: boolean;
  onDelete: (id: string, headline: string) => void;
  index: number;
}) {
  const category = story.primaryCategory;
  const categoryColor = category ? getCategoryColor(category) : 'var(--text-tertiary)';
  const categoryLabel = category
    ? CATEGORIES[category as keyof typeof CATEGORIES]?.label.split(' ')[0] ?? category
    : null;
  const confColor = confidenceColor(story.confidenceLevel);

  return (
    <div
      className="relative"
      style={{
        borderBottom: '1px solid var(--border-primary)',
        animation: 'fadeUp 500ms ease-out both',
        animationDelay: `${Math.min(index * 60, 300)}ms`,
      }}
    >
      {isAdmin && (
        <button
          onClick={() => onDelete(story.id, story.headline)}
          title="Delete story"
          style={{
            position: 'absolute',
            top: '12px',
            right: '0',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: 'var(--text-tertiary)',
            padding: '2px 6px',
            opacity: 0.3,
            transition: 'opacity 150ms, color 150ms',
            zIndex: 2,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '1';
            e.currentTarget.style.color = 'var(--accent-red)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '0.3';
            e.currentTarget.style.color = 'var(--text-tertiary)';
          }}
        >
          {"\u2715"}
        </button>
      )}

      <a
        href={`/story/${story.slug}`}
        className="block group"
        style={{
          textDecoration: 'none',
          color: 'inherit',
          padding: '14px 0',
          transition: 'background 150ms',
          paddingRight: isAdmin ? '24px' : '0',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {/* Top row: category + confidence */}
        <div className="flex items-center gap-3 mb-2">
          {categoryLabel && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: categoryColor,
              }}
            >
              {categoryLabel}
            </span>
          )}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '0.04em',
              color: confColor,
              textTransform: 'uppercase',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: '5px',
                height: '5px',
                borderRadius: '50%',
                background: confColor,
              }}
            />
            {story.confidenceLevel} {confidencePct(story.confidenceLevel, story.consensusScore)}
          </span>
        </div>

        {/* Headline — white, Playfair, 2-line clamp */}
        <h3
          className="transition-colors"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '17px',
            fontWeight: 600,
            lineHeight: 1.3,
            letterSpacing: '-0.01em',
            color: 'var(--text-primary)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            marginBottom: '8px',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-teal, #2A9D8F)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
        >
          {story.headline}
        </h3>

        {/* Stats — mono, muted */}
        <div className="flex items-center flex-wrap gap-x-3 gap-y-1">
          <StatChip>{story.sourceCount} sources</StatChip>
          <DotSeparator />
          <StatChip>{story.countryCount} countries</StatChip>
          <DotSeparator />
          <StatChip>{timeAgo(story.createdAt)}</StatChip>
        </div>
      </a>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// SHARED BITS
// ───────────────────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          fontWeight: 600,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </span>
      <div style={{ flex: 1, height: '1px', background: 'var(--border-primary)' }} />
    </div>
  );
}

function StatChip({ children, color = 'var(--text-tertiary)' }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        color,
        letterSpacing: '0.02em',
      }}
    >
      {children}
    </span>
  );
}

function DotSeparator() {
  return (
    <span
      aria-hidden
      style={{
        width: '3px',
        height: '3px',
        borderRadius: '50%',
        background: 'var(--text-tertiary)',
        opacity: 0.4,
        display: 'inline-block',
      }}
    />
  );
}

function HeroStat({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        color: muted ? 'var(--text-tertiary)' : 'var(--text-secondary)',
        letterSpacing: '0.02em',
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      {children}
    </span>
  );
}

function Stat({ number, label }: { number: string; label: string }) {
  return (
    <div className="stats-fade-in text-center md:text-left">
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(32px, 4vw, 52px)',
          fontWeight: 600,
          lineHeight: 1,
          color: 'var(--text-primary)',
          letterSpacing: '-0.02em',
        }}
      >
        {number}
      </div>
      <div
        className="mt-3"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--text-tertiary)',
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// SUBSCRIBE
// ───────────────────────────────────────────────────────────────────────────
function SubscribeBar() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || status === 'loading') return;
    setStatus('loading');
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.ok) {
        setStatus('success');
        setEmail('');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }

  return (
    <section className="max-w-[1200px] mx-auto px-6 py-16 border-t" style={{ borderColor: 'var(--border-primary)' }}>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: '14px',
            color: 'var(--text-secondary)',
            maxWidth: '480px',
            lineHeight: 1.5,
          }}
        >
          Free weekly digest: the stories everyone covered differently.
        </p>
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-0 w-full md:w-auto"
          style={{ maxWidth: '440px' }}
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            disabled={status === 'loading' || status === 'success'}
            style={{
              flex: 1,
              padding: '12px 14px',
              fontFamily: 'var(--font-body)',
              fontSize: '14px',
              background: 'transparent',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-primary)',
              borderRight: 'none',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={status === 'loading' || status === 'success'}
            style={{
              padding: '12px 20px',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: status === 'success' ? 'var(--accent-green)' : 'var(--accent-teal, #2A9D8F)',
              background: 'transparent',
              border: '1px solid var(--border-primary)',
              borderLeft: '1px solid var(--border-primary)',
              cursor: status === 'loading' || status === 'success' ? 'default' : 'pointer',
              transition: 'background 200ms ease, color 200ms ease',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              if (status === 'idle' || status === 'error') {
                e.currentTarget.style.background = 'rgba(42, 157, 143, 0.08)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {status === 'loading' ? '...' : status === 'success' ? 'subscribed ✓' : 'subscribe'}
          </button>
        </form>
      </div>
      {status === 'error' && (
        <p
          className="mt-3"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--accent-red)',
          }}
        >
          Something went wrong. Try again?
        </p>
      )}
    </section>
  );
}
