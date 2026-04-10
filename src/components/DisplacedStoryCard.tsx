interface DisplacedStoryCardProps {
  story: {
    headline: string;
    peakCoverage: string | number;
    dropoffDate: string;
    currentCoverage: string | number;
    coverageDropPct: number;
    wasResolved: boolean;
    resolutionNote: string | null;
    significance: string;
    sampleSources: string;
  };
}

export function DisplacedStoryCard({ story }: DisplacedStoryCardProps) {
  const sources = story.sampleSources
    ? story.sampleSources.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const dropoffFormatted = new Date(story.dropoffDate).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <div className="bg-[#111111] border border-[#1e1e1e] rounded-lg p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <h4
          className="text-sm font-semibold text-[#e5e5e5] flex-1"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          {story.headline}
        </h4>
        <span
          className="text-2xl font-bold text-red-400 whitespace-nowrap"
          style={{ fontFamily: "JetBrains Mono, monospace" }}
        >
          -{story.coverageDropPct}%
        </span>
      </div>

      <div className="flex items-center gap-2">
        {story.wasResolved ? (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30">
            RESOLVED
          </span>
        ) : (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">
            UNRESOLVED
          </span>
        )}
      </div>

      <div className="flex items-center gap-4 text-xs text-[#737373]" style={{ fontFamily: "JetBrains Mono, monospace" }}>
        <span>Peak: {story.peakCoverage} articles</span>
        <span>&rarr;</span>
        <span>Now: {story.currentCoverage} articles</span>
        <span>&middot;</span>
        <span>Drop-off: {dropoffFormatted}</span>
      </div>

      {story.resolutionNote && (
        <p
          className="text-sm text-[#a3a3a3]"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          {story.resolutionNote}
        </p>
      )}

      <div className="border-t border-[#1e1e1e] pt-3">
        <span
          className="text-[10px] font-bold uppercase tracking-wider text-[#737373] block mb-1"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          Why it matters
        </span>
        <p
          className="text-sm text-[#a3a3a3]"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          {story.significance}
        </p>
      </div>

      {sources.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sources.map((src, i) => (
            <a
              key={i}
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#737373] hover:text-[#a3a3a3] transition-colors underline underline-offset-2"
              style={{ fontFamily: "JetBrains Mono, monospace" }}
            >
              source {i + 1}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
