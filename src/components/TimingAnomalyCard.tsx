interface TimingAnomalyCardProps {
  anomaly: {
    event: string;
    timing: string;
    pattern: string;
    historicalContext: string | null;
    significance: string;
  };
}

export function TimingAnomalyCard({ anomaly }: TimingAnomalyCardProps) {
  return (
    <div className="bg-[#111111] border border-[#1e1e1e] rounded-lg p-5 space-y-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-[#a855f7]">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <div className="flex-1">
          <h4
            className="text-sm font-semibold text-[#e5e5e5] mb-1"
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            {anomaly.event}
          </h4>
          <p
            className="text-xs text-[#737373]"
            style={{ fontFamily: "JetBrains Mono, monospace" }}
          >
            {anomaly.timing}
          </p>
        </div>
      </div>

      <p
        className="text-sm text-[#a3a3a3]"
        style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
      >
        {anomaly.pattern}
      </p>

      {anomaly.historicalContext && (
        <div className="border-t border-[#1e1e1e] pt-3">
          <span
            className="text-[10px] font-bold uppercase tracking-wider text-[#737373] block mb-1"
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            Historical context
          </span>
          <p
            className="text-sm text-[#a3a3a3]"
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            {anomaly.historicalContext}
          </p>
        </div>
      )}

      <p
        className="text-xs text-[#737373] italic"
        style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
      >
        {anomaly.significance}
      </p>
    </div>
  );
}
