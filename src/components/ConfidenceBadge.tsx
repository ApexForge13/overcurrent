export function ConfidenceBadge({ level }: { level: string }) {
  const color =
    level.toUpperCase() === "HIGH" || level.toUpperCase() === "VERIFIED" || level.toUpperCase() === "MOSTLY_VERIFIED"
      ? "var(--accent-green)"
      : level.toUpperCase() === "MEDIUM" || level.toUpperCase() === "DEVELOPING" || level.toUpperCase() === "MIXED"
        ? "var(--accent-amber)"
        : "var(--accent-red)";
  const label = level.replace(/_/g, " ");

  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color,
      }}
    >
      {label}
    </span>
  );
}
