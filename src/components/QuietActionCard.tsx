interface QuietActionCardProps {
  action: {
    actionType: string;
    title: string;
    description: string;
    date: string;
    source: string;
    mediaCoverage: string;
    significance: string;
    sortOrder: number;
  };
}

const TYPE_STYLES: Record<string, string> = {
  legislation: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  executive_order: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  regulatory: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  corporate_disclosure: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  court_ruling: "bg-red-500/10 text-red-400 border-red-500/20",
  policy_change: "bg-teal-500/10 text-teal-400 border-teal-500/20",
};

export function QuietActionCard({ action }: QuietActionCardProps) {
  const typeStyle = TYPE_STYLES[action.actionType] || TYPE_STYLES.legislation;
  const typeLabel = action.actionType.replace(/_/g, " ");

  const dateFormatted = new Date(action.date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="bg-[#111111] border border-[#1e1e1e] rounded-lg p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${typeStyle}`}
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          {typeLabel}
        </span>
        <span
          className="text-xs text-[#737373]"
          style={{ fontFamily: "JetBrains Mono, monospace" }}
        >
          {dateFormatted}
        </span>
      </div>

      <h4
        className="text-sm font-semibold text-[#e5e5e5]"
        style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
      >
        {action.title}
      </h4>

      <p
        className="text-sm text-[#a3a3a3]"
        style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
      >
        {action.description}
      </p>

      {action.mediaCoverage && (
        <div className="border-t border-[#1e1e1e] pt-3">
          <span
            className="text-[10px] font-bold uppercase tracking-wider text-[#737373] block mb-1"
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            Coverage received
          </span>
          <p
            className="text-sm text-[#a3a3a3]"
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            {action.mediaCoverage}
          </p>
        </div>
      )}

      <p
        className="text-xs text-[#737373] italic"
        style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
      >
        {action.significance}
      </p>

      {action.source && (
        <a
          href={action.source}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-xs text-[#a855f7] hover:text-[#c084fc] transition-colors"
          style={{ fontFamily: "JetBrains Mono, monospace" }}
        >
          Official source &rarr;
        </a>
      )}
    </div>
  );
}
