interface ConsensusScoreProps {
  score: number;
}

function getColor(score: number): string {
  if (score < 30) return "#ef4444";
  if (score < 60) return "#f59e0b";
  return "#22c55e";
}

export function ConsensusScore({ score }: ConsensusScoreProps) {
  const color = getColor(score);
  const clampedScore = Math.max(0, Math.min(100, score));

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-[#1e1e1e] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${clampedScore}%`,
            backgroundColor: color,
          }}
        />
      </div>
      <span
        className="text-sm font-bold tabular-nums min-w-[3ch] text-right"
        style={{
          color,
          fontFamily: "JetBrains Mono, monospace",
        }}
      >
        {clampedScore}%
      </span>
    </div>
  );
}
