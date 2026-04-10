import { ConfidenceBadge } from "./ConfidenceBadge";
import { ConsensusScore } from "./ConsensusScore";

interface ClaimCardProps {
  claim: {
    claim: string;
    confidence: string;
    consensusPct: number;
    supportedBy: string;
    contradictedBy: string;
    notes: string | null;
  };
}

function parseList(csv: string): string[] {
  if (!csv || !csv.trim()) return [];
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}

export function ClaimCard({ claim }: ClaimCardProps) {
  const supporters = parseList(claim.supportedBy);
  const contradictors = parseList(claim.contradictedBy);

  return (
    <div className="bg-[#111111] border border-[#1e1e1e] rounded-lg p-5 space-y-4">
      <div className="flex items-start gap-3">
        <ConfidenceBadge level={claim.confidence} />
        <p
          className="text-[#e5e5e5] text-sm flex-1"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          {claim.claim}
        </p>
      </div>

      <div>
        <span
          className="text-xs text-[#737373] mb-1 block"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          Consensus
        </span>
        <ConsensusScore score={claim.consensusPct} />
      </div>

      {supporters.length > 0 && (
        <div>
          <span
            className="text-xs text-[#737373] mb-1.5 block"
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            Supported by
          </span>
          <div className="flex flex-wrap gap-1.5">
            {supporters.map((s) => (
              <span
                key={s}
                className="text-xs px-2 py-0.5 rounded bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20"
                style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {contradictors.length > 0 && (
        <div>
          <span
            className="text-xs text-[#737373] mb-1.5 block"
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            Contradicted by
          </span>
          <div className="flex flex-wrap gap-1.5">
            {contradictors.map((c) => (
              <span
                key={c}
                className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20"
                style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {claim.notes && (
        <p
          className="text-xs text-[#737373] italic border-t border-[#1e1e1e] pt-3"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          {claim.notes}
        </p>
      )}
    </div>
  );
}
