import Link from "next/link";
import { CostDisplay } from "./CostDisplay";

interface UndercurrentCardProps {
  report: {
    slug: string;
    dominantHeadline: string;
    synopsis: string;
    displacedStoryCount: number;
    quietActionCount: number;
    riskLevel: string;
    totalCost: number;
    createdAt: string;
    dateRangeStart: string;
    dateRangeEnd: string;
  };
}

const RISK_STYLES: Record<string, string> = {
  HIGH: "bg-red-500/20 text-red-400 border-red-500/30",
  MEDIUM: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  LOW: "bg-green-500/20 text-green-400 border-green-500/30",
};

function formatDateRange(start: string, end: string) {
  const s = new Date(start).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const e = new Date(end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${s} \u2013 ${e}`;
}

export function UndercurrentCard({ report }: UndercurrentCardProps) {
  const riskStyle = RISK_STYLES[report.riskLevel] || RISK_STYLES.LOW;

  return (
    <Link href={`/undercurrent/${report.slug}`} className="block group">
      <article className="bg-[#111111] border border-[#a855f7]/20 rounded-lg p-5 transition-all duration-200 hover:border-[#a855f7]/40 hover:bg-[#131118]">
        <div className="flex items-start justify-between gap-3 mb-3">
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${riskStyle}`}
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            {report.riskLevel} RISK
          </span>
          <span className="text-xs text-[#737373]" style={{ fontFamily: "JetBrains Mono, monospace" }}>
            {formatDateRange(report.dateRangeStart, report.dateRangeEnd)}
          </span>
        </div>

        <h3
          className="text-lg font-semibold text-[#e5e5e5] mb-2 group-hover:text-white transition-colors"
          style={{ fontFamily: "Playfair Display, serif" }}
        >
          What happened while you were watching{" "}
          <span className="text-[#a855f7]">&ldquo;{report.dominantHeadline}&rdquo;</span>
        </h3>

        <p
          className="text-sm text-[#a3a3a3] mb-4 line-clamp-2"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          {report.synopsis}
        </p>

        <div className="flex items-center justify-between">
          <span
            className="text-xs text-[#737373]"
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            {report.displacedStoryCount} displaced stories &middot; {report.quietActionCount} quiet actions
          </span>
          <CostDisplay cost={report.totalCost} />
        </div>
      </article>
    </Link>
  );
}
