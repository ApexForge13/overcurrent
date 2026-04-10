interface ConfidenceBadgeProps {
  level: string;
}

const LEVEL_STYLES: Record<string, string> = {
  verified: "bg-[#22c55e]/20 text-[#22c55e] border-[#22c55e]/30",
  mostly_verified: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  mixed: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  disputed: "bg-red-500/20 text-red-400 border-red-500/30",
  unverified: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

export function ConfidenceBadge({ level }: ConfidenceBadgeProps) {
  const styles = LEVEL_STYLES[level] || LEVEL_STYLES.unverified;
  const label = level.replace(/_/g, " ");

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${styles}`}
      style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
    >
      {label}
    </span>
  );
}
