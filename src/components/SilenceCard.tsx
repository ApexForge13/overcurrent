interface SilenceCardProps {
  silence: {
    region: string;
    sourcesSearched: number;
    possibleReasons: string | null;
    isSignificant: boolean;
  };
}

export function SilenceCard({ silence }: SilenceCardProps) {
  return (
    <div className="bg-[#111111] border border-[#1e1e1e] rounded-lg p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span
          className="text-sm font-semibold text-[#e5e5e5]"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          {silence.region}
        </span>
        {silence.isSignificant && (
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30"
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            SIGNIFICANT
          </span>
        )}
      </div>

      <p
        className="text-xs text-[#737373]"
        style={{ fontFamily: "JetBrains Mono, monospace" }}
      >
        {silence.sourcesSearched} sources searched
      </p>

      <div>
        <span
          className="text-[10px] font-bold uppercase tracking-wider text-[#737373] block mb-1"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          Possible reasons
        </span>
        <p
          className="text-sm text-[#a3a3a3]"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          {silence.possibleReasons}
        </p>
      </div>
    </div>
  );
}
