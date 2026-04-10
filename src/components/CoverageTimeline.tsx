interface CoverageTimelineProps {
  data: Array<{ date: string; volume: number }>;
  dropoffDate?: string;
  highlightStart?: string;
  highlightEnd?: string;
}

export function CoverageTimeline({
  data,
  dropoffDate,
  highlightStart,
  highlightEnd,
}: CoverageTimelineProps) {
  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center h-20 bg-[#111111] border border-[#1e1e1e] rounded-lg text-xs text-[#737373]"
        style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
      >
        No timeline data
      </div>
    );
  }

  const width = 300;
  const height = 80;
  const padding = { top: 4, right: 4, bottom: 16, left: 4 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxVolume = Math.max(...data.map((d) => d.volume), 1);
  const barWidth = Math.max(1, chartW / data.length - 1);

  const dropoffIndex = dropoffDate
    ? data.findIndex((d) => d.date >= dropoffDate)
    : -1;

  const highlightStartIdx = highlightStart
    ? data.findIndex((d) => d.date >= highlightStart)
    : -1;
  const highlightEndIdx = highlightEnd
    ? data.findIndex((d) => d.date > highlightEnd)
    : -1;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full max-w-[300px] h-20"
      style={{ fontFamily: "JetBrains Mono, monospace" }}
    >
      {/* Highlight region */}
      {highlightStartIdx >= 0 && (
        <rect
          x={padding.left + highlightStartIdx * (chartW / data.length)}
          y={padding.top}
          width={
            ((highlightEndIdx >= 0 ? highlightEndIdx : data.length) - highlightStartIdx) *
            (chartW / data.length)
          }
          height={chartH}
          fill="#a855f7"
          opacity={0.1}
          rx={2}
        />
      )}

      {/* Bars */}
      {data.map((d, i) => {
        const barH = (d.volume / maxVolume) * chartH;
        const x = padding.left + i * (chartW / data.length);
        const y = padding.top + chartH - barH;
        const isAfterDropoff = dropoffIndex >= 0 && i >= dropoffIndex;

        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barWidth}
            height={barH}
            rx={1}
            fill={isAfterDropoff ? "#ef4444" : "#22c55e"}
            opacity={isAfterDropoff ? 0.4 + (0.6 * (data.length - i)) / data.length : 0.7}
          />
        );
      })}

      {/* X-axis labels: first and last */}
      <text
        x={padding.left}
        y={height - 2}
        fontSize={7}
        fill="#737373"
      >
        {data[0].date.slice(5)}
      </text>
      <text
        x={width - padding.right}
        y={height - 2}
        fontSize={7}
        fill="#737373"
        textAnchor="end"
      >
        {data[data.length - 1].date.slice(5)}
      </text>
    </svg>
  );
}
