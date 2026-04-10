interface DiscrepancyCardProps {
  discrepancy: {
    issue: string;
    sideA: string;
    sideB: string;
    sourcesA: string;
    sourcesB: string;
    assessment: string | null;
  };
}

export function DiscrepancyCard({ discrepancy }: DiscrepancyCardProps) {
  return (
    <div className="bg-[#111111] border-l-2 border-l-[#ef4444] border border-[#1e1e1e] rounded-lg p-5 space-y-4">
      <h4
        className="text-sm font-semibold text-[#e5e5e5]"
        style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
      >
        {discrepancy.issue}
      </h4>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <span
            className="text-[10px] font-bold uppercase tracking-wider text-[#737373]"
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            Side A
          </span>
          <p
            className="text-sm text-[#a3a3a3]"
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            {discrepancy.sideA}
          </p>
          <p
            className="text-xs text-[#737373]"
            style={{ fontFamily: "JetBrains Mono, monospace" }}
          >
            {discrepancy.sourcesA}
          </p>
        </div>

        <div className="space-y-1.5">
          <span
            className="text-[10px] font-bold uppercase tracking-wider text-[#737373]"
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            Side B
          </span>
          <p
            className="text-sm text-[#a3a3a3]"
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            {discrepancy.sideB}
          </p>
          <p
            className="text-xs text-[#737373]"
            style={{ fontFamily: "JetBrains Mono, monospace" }}
          >
            {discrepancy.sourcesB}
          </p>
        </div>
      </div>

      <div className="border-t border-[#1e1e1e] pt-3">
        <span
          className="text-[10px] font-bold uppercase tracking-wider text-[#737373] block mb-1"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          Assessment
        </span>
        <p
          className="text-sm text-[#a3a3a3]"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          {discrepancy.assessment}
        </p>
      </div>
    </div>
  );
}
