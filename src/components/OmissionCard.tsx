interface OmissionCardProps {
  omission: {
    outletRegion: string;
    missing: string;
    presentIn: string;
    significance: string | null;
  };
}

export function OmissionCard({ omission }: OmissionCardProps) {
  return (
    <div className="bg-[#111111] border-l-2 border-l-[#f59e0b] border border-[#1e1e1e] rounded-lg p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          {omission.outletRegion}
        </span>
      </div>

      <div>
        <span
          className="text-[10px] font-bold uppercase tracking-wider text-[#737373] block mb-1"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          Missing
        </span>
        <p
          className="text-sm text-[#e5e5e5]"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          {omission.missing}
        </p>
      </div>

      <div>
        <span
          className="text-[10px] font-bold uppercase tracking-wider text-[#737373] block mb-1"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          Present in
        </span>
        <p
          className="text-sm text-[#a3a3a3]"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          {omission.presentIn}
        </p>
      </div>

      <p
        className="text-xs text-[#737373] italic border-t border-[#1e1e1e] pt-3"
        style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
      >
        {omission.significance}
      </p>
    </div>
  );
}
