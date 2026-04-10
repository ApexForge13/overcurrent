interface FramingCardProps {
  framing: {
    region: string;
    framing: string;
    contrastWith: string | null;
  };
}

const REGION_COLORS: Record<string, string> = {
  "North America": "#3b82f6",
  "Europe": "#8b5cf6",
  "Asia": "#f59e0b",
  "Middle East": "#ef4444",
  "Africa": "#22c55e",
  "Latin America": "#ec4899",
  "Oceania": "#06b6d4",
};

export function FramingCard({ framing }: FramingCardProps) {
  const regionColor = REGION_COLORS[framing.region] || "#737373";

  return (
    <div
      className="bg-[#111111] border border-[#1e1e1e] rounded-lg p-5 space-y-3"
      style={{ borderLeftWidth: "2px", borderLeftColor: regionColor }}
    >
      <span
        className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
        style={{
          backgroundColor: `${regionColor}15`,
          color: regionColor,
          borderWidth: "1px",
          borderColor: `${regionColor}30`,
          fontFamily: "IBM Plex Sans, sans-serif",
        }}
      >
        {framing.region}
      </span>

      <p
        className="text-sm text-[#e5e5e5]"
        style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
      >
        {framing.framing}
      </p>

      {framing.contrastWith && (
        <p
          className="text-xs text-[#737373] italic border-t border-[#1e1e1e] pt-3"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          Contrast: {framing.contrastWith}
        </p>
      )}
    </div>
  );
}
