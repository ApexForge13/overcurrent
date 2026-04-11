"use client";

import { useMemo } from "react";

interface SSEEvent {
  event: string;
  phase: string;
  message: string;
  region?: string;
  [key: string]: unknown;
}

interface AnalysisProgressProps {
  events: SSEEvent[];
  mode: "verify" | "undercurrent";
}

const MODEL_COLORS: Record<string, string> = {
  Claude: "#22c55e",
  "GPT-4o": "#3b82f6",
  Gemini: "#f59e0b",
  Grok: "#a855f7",
  Moderator: "#ffffff",
};

const MODEL_POSITIONS = [
  { x: 15, y: 30 },  // top-left: Claude
  { x: 85, y: 30 },  // top-right: GPT-4o
  { x: 15, y: 70 },  // bottom-left: Gemini
  { x: 85, y: 70 },  // bottom-right: Grok
];

const MODELS = ["Claude", "GPT-4o", "Gemini", "Grok"];

export function AnalysisProgress({ events, mode }: AnalysisProgressProps) {
  const accentColor = mode === "verify" ? "#22c55e" : "#a855f7";

  // Parse current state from events
  const state = useMemo(() => {
    let currentPhase = "";
    let latestMessage = "";
    const activeModels = new Set<string>();
    const completedRegions: string[] = [];
    let debateRound = 0;
    let isComplete = false;
    let hasError = false;
    let errorMessage = "";
    let socialDrafts = 0;

    for (const evt of events) {
      currentPhase = evt.phase || currentPhase;
      latestMessage = evt.message || latestMessage;

      if (evt.event === "complete" || evt.phase === "complete") isComplete = true;
      if (evt.event === "error" || evt.phase === "error") {
        hasError = true;
        errorMessage = evt.message;
      }

      // Track debate progress
      if (evt.message?.includes("R1:")) {
        debateRound = 1;
        MODELS.forEach((m) => activeModels.add(m));
      }
      if (evt.message?.includes("R2:")) debateRound = 2;
      if (evt.message?.includes("R3:")) debateRound = 3;
      if (evt.message?.includes("Debate complete") && evt.region) {
        completedRegions.push(evt.region);
      }
      if (evt.message?.includes("social drafts")) {
        const match = evt.message.match(/(\d+)/);
        if (match) socialDrafts = parseInt(match[1]);
      }
    }

    return { currentPhase, latestMessage, activeModels, completedRegions, debateRound, isComplete, hasError, errorMessage, socialDrafts };
  }, [events]);

  // Determine which pipeline steps are done
  const steps = [
    { id: "search", label: "Gathering Sources", icon: "\u{1F50D}" },
    { id: "triage", label: "Triaging", icon: "\u{1F4CB}" },
    { id: "fetch", label: "Fetching Articles", icon: "\u{1F4F0}" },
    { id: "analysis", label: "AI Debate", icon: "\u2694\uFE0F" },
    { id: "synthesis", label: "Final Synthesis", icon: "\u{1F9E0}" },
    { id: "social", label: "Social Drafts", icon: "\u{1F4F1}" },
  ];

  const getStepStatus = (stepId: string): "done" | "active" | "pending" => {
    const phaseOrder = steps.map((s) => s.id);
    const currentIdx = phaseOrder.indexOf(state.currentPhase);
    const stepIdx = phaseOrder.indexOf(stepId);
    if (state.isComplete) return "done";
    if (stepIdx < currentIdx) return "done";
    if (stepIdx === currentIdx) return "active";
    // Check if any event has this phase
    if (events.some((e) => e.phase === stepId)) return "done";
    return "pending";
  };

  const isDebatePhase = state.currentPhase === "analysis" || state.debateRound > 0;

  return (
    <div className="relative bg-[#0d0d0d] border border-[#1e1e1e] rounded-xl overflow-hidden">
      {/* Scan line animation */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute w-full h-px opacity-20"
          style={{
            background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`,
            animation: "warroom-scanline 3s ease-in-out infinite",
            top: "50%",
          }}
        />
      </div>

      {/* Header */}
      <div className="px-5 py-3 border-b border-[#1e1e1e] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{
              backgroundColor: state.isComplete ? "#22c55e" : state.hasError ? "#ef4444" : accentColor,
              animation: state.isComplete || state.hasError ? "none" : "pulse-glow 2s ease-in-out infinite",
            }}
          />
          <span className="text-xs font-mono text-[#737373] uppercase tracking-widest">
            {state.isComplete ? "Analysis Complete" : state.hasError ? "Error" : "Live Analysis"}
          </span>
        </div>
        {state.completedRegions.length > 0 && (
          <span className="text-xs font-mono text-[#737373]">
            {state.completedRegions.length}/6 regions
          </span>
        )}
      </div>

      {/* Main content */}
      <div className="p-5">
        {/* Pipeline steps */}
        <div className="flex items-center gap-1 mb-5">
          {steps.map((step, i) => {
            const status = getStepStatus(step.id);
            return (
              <div key={step.id} className="flex items-center gap-1 flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all duration-500"
                    style={{
                      background:
                        status === "done"
                          ? `${accentColor}20`
                          : status === "active"
                            ? `${accentColor}40`
                            : "#111111",
                      border: `1px solid ${status === "done" ? accentColor : status === "active" ? accentColor : "#1e1e1e"}`,
                      boxShadow: status === "active" ? `0 0 20px ${accentColor}30` : "none",
                      animation: status === "active" ? "pulse-glow 2s ease-in-out infinite" : "none",
                    }}
                  >
                    {status === "done" ? "\u2713" : step.icon}
                  </div>
                  <span
                    className="text-[9px] font-mono mt-1 text-center leading-tight"
                    style={{
                      color: status === "done" ? accentColor : status === "active" ? "#e5e5e5" : "#737373",
                    }}
                  >
                    {step.label}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <div
                    className="h-px flex-shrink-0 w-4 mt-[-12px]"
                    style={{
                      background: status === "done" ? accentColor : "#1e1e1e",
                      transition: "background 0.5s",
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Debate Arena (shown during analysis phase) */}
        {isDebatePhase && !state.isComplete && (
          <div className="relative w-full max-w-[400px] mx-auto my-4" style={{ aspectRatio: '5/3' }}>
            {/* Connection lines */}
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
              {state.debateRound >= 2 &&
                MODELS.map((_, i) =>
                  MODELS.map((_, j) => {
                    if (i >= j) return null;
                    const a = MODEL_POSITIONS[i];
                    const b = MODEL_POSITIONS[j];
                    return (
                      <line
                        key={`${i}-${j}`}
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke={accentColor}
                        strokeWidth="0.3"
                        opacity="0.3"
                        strokeDasharray="2,2"
                      >
                        <animate
                          attributeName="stroke-dashoffset"
                          from="0"
                          to="-4"
                          dur="1s"
                          repeatCount="indefinite"
                        />
                      </line>
                    );
                  }),
                )}

              {/* Moderator center glow */}
              {state.debateRound === 3 && (
                <circle cx="50" cy="50" r="12" fill="none" stroke="#ffffff" strokeWidth="0.5" opacity="0.5">
                  <animate attributeName="r" values="10;14;10" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.5;0.2;0.5" dur="2s" repeatCount="indefinite" />
                </circle>
              )}
            </svg>

            {/* Model nodes */}
            {MODELS.map((model, i) => {
              const pos = MODEL_POSITIONS[i];
              const color = MODEL_COLORS[model];
              const isActive = state.activeModels.has(model);

              return (
                <div
                  key={model}
                  className="absolute flex flex-col items-center transition-all duration-700"
                  style={{
                    left: `${pos.x}%`,
                    top: `${pos.y}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-[10px] font-mono font-bold transition-all duration-500"
                    style={{
                      background: isActive ? `${color}30` : "#111111",
                      border: `2px solid ${isActive ? color : "#1e1e1e"}`,
                      boxShadow: isActive ? `0 0 20px ${color}40, 0 0 40px ${color}20` : "none",
                      color: isActive ? color : "#737373",
                      animation: isActive && state.debateRound > 0 ? "pulse-glow 2s ease-in-out infinite" : "none",
                    }}
                  >
                    {model.charAt(0)}
                  </div>
                  <span
                    className="text-[8px] font-mono mt-1"
                    style={{ color: isActive ? color : "#737373" }}
                  >
                    {model}
                  </span>
                </div>
              );
            })}

            {/* Moderator (center, R3 only) */}
            {state.debateRound === 3 && (
              <div
                className="absolute flex flex-col items-center"
                style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
              >
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-xs font-mono font-bold border-2 border-white/50"
                  style={{
                    background: "rgba(255,255,255,0.1)",
                    boxShadow: "0 0 30px rgba(255,255,255,0.2)",
                    animation: "pulse-glow 1.5s ease-in-out infinite",
                  }}
                >
                  {"\u2696\uFE0F"}
                </div>
                <span className="text-[8px] font-mono mt-1 text-white/70">Moderator</span>
              </div>
            )}

            {/* Round indicator */}
            {state.debateRound > 0 && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-center">
                <span className="text-[10px] font-mono px-3 py-1 rounded-full border" style={{
                  borderColor: accentColor,
                  color: accentColor,
                  background: `${accentColor}10`,
                }}>
                  {state.debateRound === 1 && "Round 1: Independent Analysis"}
                  {state.debateRound === 2 && "Round 2: Cross-Examination"}
                  {state.debateRound === 3 && "Round 3: Moderator Synthesis"}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Status message */}
        <div className="mt-3 text-center">
          <p
            className="text-sm font-mono"
            style={{ color: state.hasError ? "#ef4444" : "#a3a3a3" }}
          >
            {state.latestMessage}
          </p>

          {/* Completed regions */}
          {state.completedRegions.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1 mt-3">
              {state.completedRegions.map((r) => (
                <span
                  key={r}
                  className="text-[9px] font-mono px-2 py-0.5 rounded-full"
                  style={{
                    background: `${accentColor}15`,
                    color: accentColor,
                    border: `1px solid ${accentColor}30`,
                  }}
                >
                  {"\u2713"} {r}
                </span>
              ))}
            </div>
          )}

          {/* Social drafts generated */}
          {state.socialDrafts > 0 && (
            <p className="text-xs font-mono text-[#737373] mt-2">
              {"\u{1F4F1}"} {state.socialDrafts} social drafts generated
            </p>
          )}
        </div>
      </div>

      {/* CSS animations */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes warroom-scanline {
          0%, 100% { transform: translateY(-100px); opacity: 0; }
          50% { transform: translateY(100px); opacity: 0.3; }
        }
      ` }} />
    </div>
  );
}
