interface CostDisplayProps {
  cost: number;
  seconds?: number;
}

export function CostDisplay({ cost, seconds }: CostDisplayProps) {
  const formatted = `$${cost.toFixed(4)}`;

  return (
    <span
      className="text-xs text-[#737373]"
      style={{ fontFamily: "JetBrains Mono, monospace" }}
    >
      {formatted}
      {seconds !== undefined && ` \u00b7 ${seconds}s`}
    </span>
  );
}
