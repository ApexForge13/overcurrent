"use client";

interface ProgressEvent {
  event: string;
  phase: string;
  message: string;
  [key: string]: unknown;
}

interface AnalysisProgressProps {
  events: ProgressEvent[];
  mode: "verify" | "undercurrent";
}

const VERIFY_PHASES = ["search", "triage", "fetch", "analysis", "synthesis", "complete"];
const UNDERCURRENT_PHASES = ["identify", "displacement", "quiet_actions", "synthesis", "complete"];

const PHASE_LABELS: Record<string, string> = {
  search: "Searching sources",
  triage: "Triaging results",
  fetch: "Fetching articles",
  analysis: "Analyzing claims",
  synthesis: "Synthesizing report",
  identify: "Identifying displaced stories",
  displacement: "Analyzing displacement patterns",
  quiet_actions: "Finding quiet actions",
  complete: "Complete",
};

function Spinner({ color }: { color: string }) {
  return (
    <svg
      className="animate-spin h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke={color}
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill={color}
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function Checkmark({ color }: { color: string }) {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 13l4 4L19 7"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AnalysisProgress({ events, mode }: AnalysisProgressProps) {
  const phases = mode === "verify" ? VERIFY_PHASES : UNDERCURRENT_PHASES;
  const accentColor = mode === "verify" ? "#22c55e" : "#a855f7";

  const completedPhases = new Set(
    events
      .filter((e) => e.event === "phase_complete" || e.event === "complete")
      .map((e) => e.phase)
  );

  const currentPhase = events.length > 0 ? events[events.length - 1].phase : null;
  const latestMessage = events.length > 0 ? events[events.length - 1].message : null;

  return (
    <div className="bg-[#111111] border border-[#1e1e1e] rounded-lg p-6">
      <div className="space-y-3">
        {phases.map((phase) => {
          const isCompleted = completedPhases.has(phase);
          const isCurrent = phase === currentPhase && !isCompleted;

          return (
            <div key={phase} className="flex items-center gap-3">
              <div className="w-5 flex justify-center">
                {isCompleted ? (
                  <Checkmark color={accentColor} />
                ) : isCurrent ? (
                  <Spinner color={accentColor} />
                ) : (
                  <div className="h-2 w-2 rounded-full bg-[#333]" />
                )}
              </div>
              <span
                className={`text-sm ${
                  isCompleted
                    ? "text-[#a3a3a3]"
                    : isCurrent
                    ? "text-[#e5e5e5] font-medium"
                    : "text-[#737373]"
                }`}
                style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
              >
                {PHASE_LABELS[phase] || phase}
              </span>
            </div>
          );
        })}
      </div>

      {latestMessage && (
        <p
          className="mt-4 text-xs text-[#737373] border-t border-[#1e1e1e] pt-3"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          {latestMessage}
        </p>
      )}
    </div>
  );
}
