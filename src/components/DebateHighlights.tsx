"use client";

import { useState, useEffect, useCallback } from "react";

/* ───────── Types ───────── */

interface DebateRound {
  id: string;
  region: string;
  round: number;
  modelName: string;
  provider: string;
  content: string;
}

interface DebateHighlightsProps {
  debateRounds: DebateRound[];
}

interface KeyFinding {
  finding: string;
  confidence?: string;
}

interface Challenge {
  target: string;
  challenger: string;
  claim: string;
  challenge: string;
}

interface ConsensusFinding {
  fact: string;
  models_agreeing: string[];
  evidence_quality: string;
}

interface ResolvedDispute {
  claim: string;
  initial_split: { supporting: string[]; opposing: string[] };
  resolution: string;
  final_confidence: string;
}

interface UnresolvedDispute {
  claim: string;
  side_a: { position: string; models: string[] };
  side_b: { position: string; models: string[] };
  moderator_note: string;
}

interface CaughtError {
  original_claim: string;
  claimed_by: string[];
  caught_by: string;
  error_type: string;
  explanation: string;
}

/* ───────── Constants ───────── */

const MODEL_COLORS: Record<string, string> = {
  Claude: "#22c55e",
  "GPT-4o": "#3b82f6",
  Gemini: "#f59e0b",
  Grok: "#a855f7",
  "Claude (Moderator)": "#ffffff",
};

function getModelColor(name: string): string {
  if (MODEL_COLORS[name]) return MODEL_COLORS[name];
  for (const key of Object.keys(MODEL_COLORS)) {
    if (name.toLowerCase().includes(key.toLowerCase())) return MODEL_COLORS[key];
  }
  return "#6b7280";
}

/* ───────── Parsers ───────── */

function parseR1Content(content: string): KeyFinding[] {
  try {
    const parsed = JSON.parse(content);
    // Match actual debate-round1.ts output: key_facts array
    if (parsed.key_facts && Array.isArray(parsed.key_facts)) {
      return parsed.key_facts.map((f: { fact?: string; finding?: string; confidence?: string }) => ({
        finding: f.fact || f.finding || JSON.stringify(f),
        confidence: f.confidence,
      }));
    }
    if (parsed.key_findings && Array.isArray(parsed.key_findings)) {
      return parsed.key_findings.map((f: { fact?: string; finding?: string; confidence?: string }) => ({
        finding: f.fact || f.finding || (typeof f === 'string' ? f : JSON.stringify(f)),
        confidence: f.confidence,
      }));
    }
    // Fallback: grab any array-like field but extract text properly
    for (const key of Object.keys(parsed)) {
      if (Array.isArray(parsed[key]) && parsed[key].length > 0) {
        return parsed[key].slice(0, 5).map((item: Record<string, unknown>) => {
          if (typeof item === "string") return { finding: item };
          // Try common text fields
          const text = item.fact || item.finding || item.claim || item.title || item.description;
          return { finding: typeof text === 'string' ? text : JSON.stringify(item) };
        });
      }
    }
  } catch {
    const lines = content
      .split(/\n|(?<=[.!?])\s+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 10);
    return lines.slice(0, 4).map((l) => ({ finding: l }));
  }
  return [];
}

function parseR2Content(content: string, modelName: string): Challenge[] {
  try {
    const parsed = JSON.parse(content);
    const challenges: Challenge[] = [];

    // Match actual debate-round2.ts output format
    if (parsed.challenges && Array.isArray(parsed.challenges)) {
      for (const c of parsed.challenges) {
        challenges.push({
          target: c.other_model ?? c.target_model ?? c.target ?? "Unknown",
          challenger: modelName,
          claim: c.their_claim ?? c.original_claim ?? c.claim ?? "",
          challenge: c.your_challenge ?? c.challenge ?? c.counter_argument ?? "",
        });
      }
    }
    // Also include corrections
    if (parsed.corrections && Array.isArray(parsed.corrections)) {
      for (const c of parsed.corrections) {
        challenges.push({
          target: c.other_model ?? "Unknown",
          challenger: modelName,
          claim: c.issue ?? "",
          challenge: c.correction ?? "",
        });
      }
    }
    // Include concessions (model admitting its own errors)
    if (parsed.concessions && Array.isArray(parsed.concessions)) {
      for (const c of parsed.concessions) {
        challenges.push({
          target: modelName,
          challenger: modelName,
          claim: c.your_original_claim ?? "",
          challenge: `CONCEDED: ${c.revised_position ?? c.why_wrong ?? ""}`,
        });
      }
    }
    return challenges;
  } catch {
    return [];
  }
}

function parseModeratorContent(content: string) {
  try {
    const parsed = JSON.parse(content);
    return {
      consensus_findings: (parsed.consensus_findings ?? []) as ConsensusFinding[],
      resolved_disputes: (parsed.resolved_disputes ?? []) as ResolvedDispute[],
      unresolved_disputes: (parsed.unresolved_disputes ?? []) as UnresolvedDispute[],
      caught_errors: (parsed.caught_errors ?? []) as CaughtError[],
      debate_quality_note: (parsed.debate_quality_note ?? "") as string,
    };
  } catch {
    return {
      consensus_findings: [] as ConsensusFinding[],
      resolved_disputes: [] as ResolvedDispute[],
      unresolved_disputes: [] as UnresolvedDispute[],
      caught_errors: [] as CaughtError[],
      debate_quality_note: "",
    };
  }
}

/* ───────── Inline keyframes (injected once) ───────── */

const KEYFRAMES = `
@keyframes dh-fadeSlideIn {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes dh-challengeAppear {
  from { opacity: 0; transform: scale(0.85); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes dh-glowPulse {
  0%, 100% { box-shadow: 0 0 8px var(--glow-color); }
  50%      { box-shadow: 0 0 20px var(--glow-color); }
}
@keyframes dh-verdictDrop {
  from { opacity: 0; transform: translateY(-30px) scale(0.9); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes dh-lineGrow {
  from { stroke-dashoffset: 200; }
  to   { stroke-dashoffset: 0; }
}
@keyframes dh-scanline {
  0%   { background-position: 0 -100%; }
  100% { background-position: 0 200%; }
}
`;

let keyframesInjected = false;
function ensureKeyframes() {
  if (typeof document === "undefined" || keyframesInjected) return;
  const style = document.createElement("style");
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
  keyframesInjected = true;
}

/* ───────── Sub-components ───────── */

function ModelAvatar({ name, delay, visible }: { name: string; delay: number; visible: boolean }) {
  const color = getModelColor(name);
  return (
    <div
      className="flex flex-col items-center gap-2"
      style={{
        opacity: visible ? 1 : 0,
        animation: visible ? `dh-fadeSlideIn 0.6s ${delay}ms ease-out both` : "none",
      }}
    >
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold border-2"
        style={
          {
            borderColor: color,
            backgroundColor: `${color}18`,
            color,
            "--glow-color": `${color}66`,
            animation: visible ? "dh-glowPulse 3s ease-in-out infinite" : "none",
          } as React.CSSProperties
        }
      >
        {name.charAt(0)}
      </div>
      <span className="text-xs font-mono text-[#d4d4d4] text-center max-w-[90px] leading-tight">
        {name}
      </span>
    </div>
  );
}

function FindingCard({
  finding,
  delay,
  visible,
  color,
}: {
  finding: KeyFinding;
  delay: number;
  visible: boolean;
  color: string;
}) {
  return (
    <div
      className="rounded px-3 py-2 text-xs text-[#d4d4d4] border-l-2"
      style={{
        borderLeftColor: color,
        backgroundColor: `${color}0d`,
        opacity: visible ? 1 : 0,
        animation: visible ? `dh-fadeSlideIn 0.5s ${delay}ms ease-out both` : "none",
      }}
    >
      <p className="leading-relaxed">{finding.finding}</p>
      {finding.confidence && (
        <span className="text-[10px] font-mono mt-1 inline-block" style={{ color }}>
          {finding.confidence}
        </span>
      )}
    </div>
  );
}

function ChallengeCard({
  challenge,
  delay,
  visible,
}: {
  challenge: Challenge;
  delay: number;
  visible: boolean;
}) {
  const challengerColor = getModelColor(challenge.challenger);
  const targetColor = getModelColor(challenge.target);

  return (
    <div
      className="rounded-lg border p-3 text-xs relative"
      style={{
        borderColor: `${challengerColor}44`,
        backgroundColor: "#0a0a0a",
        opacity: visible ? 1 : 0,
        animation: visible ? `dh-challengeAppear 0.5s ${delay}ms ease-out both` : "none",
      }}
    >
      {/* Arrow header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="font-mono font-bold" style={{ color: challengerColor }}>
          {challenge.challenger}
        </span>
        <svg width="20" height="10" viewBox="0 0 20 10" className="flex-shrink-0">
          <line
            x1="0"
            y1="5"
            x2="14"
            y2="5"
            stroke={challengerColor}
            strokeWidth="1.5"
            strokeDasharray="200"
            style={{
              animation: visible ? `dh-lineGrow 0.6s ${delay + 200}ms ease-out both` : "none",
            }}
          />
          <polygon points="14,2 20,5 14,8" fill={challengerColor} />
        </svg>
        <span className="font-mono font-bold" style={{ color: targetColor }}>
          {challenge.target}
        </span>
      </div>
      {challenge.claim && (
        <p className="text-[#a3a3a3] mb-1">
          <span className="text-[#737373]">Claim:</span> {challenge.claim}
        </p>
      )}
      <p className="text-[#d4d4d4]">{challenge.challenge}</p>
    </div>
  );
}

function VerdictCard({
  type,
  delay,
  visible,
  children,
}: {
  type: "consensus" | "resolved" | "unresolved" | "error";
  delay: number;
  visible: boolean;
  children: React.ReactNode;
}) {
  const styles = {
    consensus: { border: "#22c55e44", bg: "#22c55e0d", label: "CONSENSUS", labelColor: "#22c55e" },
    resolved: { border: "#f59e0b44", bg: "#f59e0b0d", label: "RESOLVED", labelColor: "#f59e0b" },
    unresolved: { border: "#ef444444", bg: "#ef44440d", label: "UNRESOLVED", labelColor: "#ef4444" },
    error: { border: "#a855f744", bg: "#a855f70d", label: "ERROR CAUGHT", labelColor: "#a855f7" },
  }[type];

  return (
    <div
      className="rounded-lg border p-4 relative"
      style={{
        borderColor: styles.border,
        backgroundColor: styles.bg,
        opacity: visible ? 1 : 0,
        animation: visible ? `dh-verdictDrop 0.6s ${delay}ms ease-out both` : "none",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">&#9878;</span>
        <span
          className="text-[10px] font-mono font-bold uppercase tracking-widest"
          style={{ color: styles.labelColor }}
        >
          {styles.label}
        </span>
      </div>
      {children}
    </div>
  );
}

/* ───────── Region Debate Panel ───────── */

interface RegionData {
  region: string;
  r1: { modelName: string; findings: KeyFinding[] }[];
  r2: Challenge[];
  moderator: ReturnType<typeof parseModeratorContent>;
}

function RegionDebatePanel({ data, playing }: { data: RegionData; playing: boolean }) {
  const [phase, setPhase] = useState(0); // 0=idle, 1=R1, 2=R2, 3=R3

  useEffect(() => {
    if (!playing) {
      setPhase(0);
      return;
    }
    setPhase(1);
    const t2 = setTimeout(() => setPhase(2), 800 + data.r1.length * 400);
    const t3 = setTimeout(() => setPhase(3), 1600 + data.r1.length * 400 + data.r2.length * 350);
    return () => {
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [playing, data.r1.length, data.r2.length]);

  const mod = data.moderator;

  return (
    <div className="space-y-6">
      {/* ── Phase 1: Model Avatars + Findings ── */}
      <div>
        <h4
          className="text-[10px] font-mono uppercase tracking-widest mb-4"
          style={{ color: "#525252" }}
        >
          Round 1 &mdash; Independent Analysis
        </h4>
        <div
          className="flex gap-6 overflow-x-auto pb-2 sm:grid sm:overflow-visible"
          style={{ gridTemplateColumns: `repeat(${Math.min(data.r1.length, 4)}, 1fr)` }}
        >
          {data.r1.map((model, mi) => (
            <div
              key={model.modelName}
              className="flex flex-col items-center gap-3 flex-shrink-0 sm:flex-shrink"
              style={{ minWidth: '200px' }}
            >
              <ModelAvatar
                name={model.modelName}
                delay={mi * 200}
                visible={phase >= 1}
              />
              <div className="space-y-2 w-full">
                {model.findings.map((f, fi) => (
                  <FindingCard
                    key={fi}
                    finding={f}
                    delay={mi * 200 + (fi + 1) * 300}
                    visible={phase >= 1}
                    color={getModelColor(model.modelName)}
                  />
                ))}
                {model.findings.length === 0 && phase >= 1 && (
                  <p className="text-[10px] text-[#525252] text-center italic">No parsed findings</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Phase 2: Cross-Examination ── */}
      {data.r2.length > 0 && (
        <div
          style={{
            opacity: phase >= 2 ? 1 : 0,
            transition: "opacity 0.4s ease",
          }}
        >
          <h4
            className="text-[10px] font-mono uppercase tracking-widest mb-4"
            style={{ color: "#525252" }}
          >
            Round 2 &mdash; Cross-Examination
          </h4>
          <div className="grid gap-3 md:grid-cols-2">
            {data.r2.map((ch, ci) => (
              <ChallengeCard key={ci} challenge={ch} delay={ci * 350} visible={phase >= 2} />
            ))}
          </div>
        </div>
      )}

      {/* ── Phase 3: Moderator Verdicts ── */}
      <div
        style={{
          opacity: phase >= 3 ? 1 : 0,
          transition: "opacity 0.4s ease",
        }}
      >
        <h4
          className="text-[10px] font-mono uppercase tracking-widest mb-4 flex items-center gap-2"
          style={{ color: "#525252" }}
        >
          Round 3 &mdash; Moderator Resolution
          <span className="text-base">&#9878;</span>
        </h4>
        <div className="space-y-3">
          {mod.consensus_findings.map((c, i) => (
            <VerdictCard key={`c${i}`} type="consensus" delay={i * 250} visible={phase >= 3}>
              <p className="text-sm text-[#d4d4d4]">{c.fact}</p>
              <p className="text-[10px] text-[#22c55e] font-mono mt-1">
                {c.models_agreeing.join(", ")} &middot; {c.evidence_quality}
              </p>
            </VerdictCard>
          ))}

          {mod.resolved_disputes.map((d, i) => (
            <VerdictCard key={`r${i}`} type="resolved" delay={(mod.consensus_findings.length + i) * 250} visible={phase >= 3}>
              <p className="text-sm text-[#d4d4d4]">{d.claim}</p>
              <p className="text-xs text-[#a3a3a3] mt-1">{d.resolution}</p>
              <p className="text-[10px] font-mono mt-1 text-[#f59e0b]">{d.final_confidence}</p>
            </VerdictCard>
          ))}

          {mod.unresolved_disputes.map((d, i) => (
            <VerdictCard
              key={`u${i}`}
              type="unresolved"
              delay={(mod.consensus_findings.length + mod.resolved_disputes.length + i) * 250}
              visible={phase >= 3}
            >
              <p className="text-sm text-[#d4d4d4]">{d.claim}</p>
              <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                <div>
                  <span className="text-[#ef4444] font-mono text-[10px]">{d.side_a.models.join(", ")}</span>
                  <p className="text-[#a3a3a3] mt-0.5">{d.side_a.position}</p>
                </div>
                <div>
                  <span className="text-[#ef4444] font-mono text-[10px]">{d.side_b.models.join(", ")}</span>
                  <p className="text-[#a3a3a3] mt-0.5">{d.side_b.position}</p>
                </div>
              </div>
              {d.moderator_note && (
                <p className="text-[10px] text-[#737373] mt-2 italic">{d.moderator_note}</p>
              )}
            </VerdictCard>
          ))}

          {mod.caught_errors.map((e, i) => (
            <VerdictCard
              key={`e${i}`}
              type="error"
              delay={
                (mod.consensus_findings.length +
                  mod.resolved_disputes.length +
                  mod.unresolved_disputes.length +
                  i) *
                250
              }
              visible={phase >= 3}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#a855f7]/20 text-[#a855f7]">
                  CAUGHT!
                </span>
                <span className="text-[10px] font-mono text-[#737373]">{e.error_type}</span>
              </div>
              <p className="text-sm text-[#d4d4d4]">{e.original_claim}</p>
              <p className="text-xs text-[#a3a3a3] mt-1">
                <span style={{ color: getModelColor(e.caught_by) }}>{e.caught_by}</span> caught error from{" "}
                {e.claimed_by.join(", ")}
              </p>
              <p className="text-[10px] text-[#737373] mt-1">{e.explanation}</p>
            </VerdictCard>
          ))}

          {mod.debate_quality_note && phase >= 3 && (
            <div
              className="rounded border border-[#262626] p-3 text-xs text-[#737373] italic mt-4"
              style={{
                animation: `dh-fadeSlideIn 0.5s ${
                  (mod.consensus_findings.length +
                    mod.resolved_disputes.length +
                    mod.unresolved_disputes.length +
                    mod.caught_errors.length) *
                    250 +
                  300
                }ms ease-out both`,
              }}
            >
              {mod.debate_quality_note}
            </div>
          )}

          {mod.consensus_findings.length === 0 &&
            mod.resolved_disputes.length === 0 &&
            mod.unresolved_disputes.length === 0 &&
            mod.caught_errors.length === 0 &&
            phase >= 3 && (
              <p className="text-sm text-[#525252] italic">No moderator data for this region.</p>
            )}
        </div>
      </div>
    </div>
  );
}

/* ───────── Main Component ───────── */

export function DebateHighlights({ debateRounds }: DebateHighlightsProps) {
  const [expanded, setExpanded] = useState(true);
  const [activeRegion, setActiveRegion] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [autoPlayed, setAutoPlayed] = useState(false);

  useEffect(() => {
    ensureKeyframes();
  }, []);

  // Group rounds by region
  const regions = [...new Set(debateRounds.map((r) => r.region))];

  // Build region data
  const buildRegionData = useCallback(
    (region: string): RegionData => {
      const regionRounds = debateRounds.filter((r) => r.region === region);
      const r1Rounds = regionRounds.filter((r) => r.round === 1);
      const r2Rounds = regionRounds.filter((r) => r.round === 2);
      const r3Rounds = regionRounds.filter((r) => r.round === 3);

      const r1 = r1Rounds.map((r) => ({
        modelName: r.modelName,
        findings: parseR1Content(r.content),
      }));

      const r2 = r2Rounds.flatMap((r) => parseR2Content(r.content, r.modelName));

      const moderator =
        r3Rounds.length > 0
          ? parseModeratorContent(r3Rounds[0].content)
          : { consensus_findings: [], resolved_disputes: [], unresolved_disputes: [], caught_errors: [], debate_quality_note: "" };

      return { region, r1, r2, moderator };
    },
    [debateRounds]
  );

  // Set default active region
  useEffect(() => {
    if (regions.length > 0 && !activeRegion) {
      setActiveRegion(regions[0]);
    }
  }, [regions, activeRegion]);

  // Auto-play on mount
  useEffect(() => {
    if (!autoPlayed && activeRegion && expanded) {
      const t = setTimeout(() => {
        setPlaying(true);
        setAutoPlayed(true);
      }, 300);
      return () => clearTimeout(t);
    }
  }, [autoPlayed, activeRegion, expanded]);

  const moderatorRounds = debateRounds.filter((r) => r.round === 3);
  if (moderatorRounds.length === 0 && debateRounds.filter((r) => r.round === 1).length === 0) {
    return null;
  }

  const modelsUsed = [...new Set(debateRounds.filter((r) => r.round === 1).map((r) => r.modelName))];

  const handleReplay = () => {
    setPlaying(false);
    setTimeout(() => setPlaying(true), 50);
  };

  const currentData = activeRegion ? buildRegionData(activeRegion) : null;

  return (
    <section className="mt-10">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between mb-4 group"
      >
        <h2 className="font-bold text-xl text-[#e5e5e5] flex items-center gap-2" style={{ fontFamily: "Playfair Display, serif" }}>
          Model Debate
          <span className="text-xs font-mono text-[#525252] font-normal">
            {modelsUsed.join(" vs ")}
          </span>
        </h2>
        <span className="text-[#525252] text-sm">{expanded ? "\u25BC" : "\u25B6"}</span>
      </button>

      {expanded && (
        <div className="space-y-4">
          {/* Info bar */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-[#525252]">
              {modelsUsed.length} models analyzed sources independently, cross-examined each other, then a moderator resolved disputes.
            </p>
            <button
              onClick={handleReplay}
              className="text-[10px] font-mono uppercase tracking-wider px-3 py-1.5 rounded border border-[#333] text-[#a3a3a3] hover:text-white hover:border-[#555] transition-colors"
            >
              &#8635; Replay Debate
            </button>
          </div>

          {/* Region tabs */}
          {regions.length > 1 && (
            <div className="flex gap-1 border-b border-[#1e1e1e] pb-0">
              {regions.map((region) => (
                <button
                  key={region}
                  onClick={() => {
                    setActiveRegion(region);
                    setPlaying(false);
                    setTimeout(() => setPlaying(true), 50);
                  }}
                  className="px-3 py-2 text-xs font-mono transition-colors relative"
                  style={{
                    color: activeRegion === region ? "#e5e5e5" : "#525252",
                  }}
                >
                  {region}
                  {activeRegion === region && (
                    <div
                      className="absolute bottom-0 left-0 right-0 h-px"
                      style={{ backgroundColor: "#e5e5e5" }}
                    />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* War Room panel */}
          <div
            className="rounded-lg border border-[#1e1e1e] p-6 relative overflow-hidden"
            style={{
              backgroundColor: "#080808",
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)",
              backgroundSize: "40px 40px",
            }}
          >
            {/* Scanline overlay */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: "linear-gradient(transparent 50%, rgba(0,255,0,0.008) 50%)",
                backgroundSize: "100% 4px",
              }}
            />

            {currentData && <RegionDebatePanel data={currentData} playing={playing} />}
          </div>
        </div>
      )}
    </section>
  );
}
