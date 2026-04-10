"use client";

interface BudgetBarProps {
  dailyCost: number;
  dailyCap: number;
  totalCost: number;
  totalBudget: number;
}

function Bar({
  label,
  used,
  total,
}: {
  label: string;
  used: number;
  total: number;
}) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const isWarning = pct > 80;
  const color = isWarning ? "#ef4444" : "#22c55e";

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span
          className="text-[#a3a3a3]"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          {label}
        </span>
        <span
          className="tabular-nums"
          style={{
            fontFamily: "JetBrains Mono, monospace",
            color,
          }}
        >
          ${used.toFixed(2)} / ${total.toFixed(2)}
        </span>
      </div>
      <div className="h-1.5 bg-[#1e1e1e] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}

export function BudgetBar({
  dailyCost,
  dailyCap,
  totalCost,
  totalBudget,
}: BudgetBarProps) {
  return (
    <div className="space-y-3 bg-[#111111] border border-[#1e1e1e] rounded-lg p-4">
      <Bar label="Daily usage" used={dailyCost} total={dailyCap} />
      <Bar label="Total budget" used={totalCost} total={totalBudget} />
    </div>
  );
}
