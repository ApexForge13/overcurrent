export function ConsensusScore({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const color =
    clamped >= 70
      ? "var(--accent-green)"
      : clamped >= 40
        ? "var(--accent-amber)"
        : "var(--accent-red)";

  return (
    <div className="flex items-center gap-3">
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "28px",
          fontWeight: 600,
          color,
        }}
      >
        {clamped}%
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          color: "var(--text-tertiary)",
          letterSpacing: "0.04em",
        }}
      >
        consensus
      </span>
    </div>
  );
}
