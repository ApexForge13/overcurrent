"use client"
import { useState } from 'react'

interface DebateRound {
  id: string
  region: string
  round: number
  modelName: string
  provider: string
  content: string
}

interface DebateHighlightsProps {
  debateRounds: DebateRound[]
}

interface ConsensusFinding {
  fact: string
  models_agreeing: string[]
  evidence_quality: string
}
interface ResolvedDispute {
  claim: string
  initial_split: { supporting: string[]; opposing: string[] }
  resolution: string
  final_confidence: string
}
interface UnresolvedDispute {
  claim: string
  side_a: { position: string; models: string[] }
  side_b: { position: string; models: string[] }
  moderator_note: string
}
interface CaughtError {
  original_claim: string
  claimed_by: string[]
  caught_by: string
  error_type: string
  explanation: string
}

function parseModeratorContent(content: string): {
  consensus_findings: ConsensusFinding[]
  resolved_disputes: ResolvedDispute[]
  unresolved_disputes: UnresolvedDispute[]
  caught_errors: CaughtError[]
  debate_quality_note: string
} {
  try {
    const parsed = JSON.parse(content)
    return {
      consensus_findings: parsed.consensus_findings ?? [],
      resolved_disputes: parsed.resolved_disputes ?? [],
      unresolved_disputes: parsed.unresolved_disputes ?? [],
      caught_errors: parsed.caught_errors ?? [],
      debate_quality_note: parsed.debate_quality_note ?? '',
    }
  } catch {
    return { consensus_findings: [], resolved_disputes: [], unresolved_disputes: [], caught_errors: [], debate_quality_note: '' }
  }
}

export function DebateHighlights({ debateRounds }: DebateHighlightsProps) {
  const [expanded, setExpanded] = useState(true)

  // Get moderator rounds (round 3)
  const moderatorRounds = debateRounds.filter(r => r.round === 3)
  if (moderatorRounds.length === 0) return null

  // Get all unique model names from round 1
  const modelsUsed = [...new Set(debateRounds.filter(r => r.round === 1).map(r => r.modelName))]

  // Aggregate all moderator findings across regions
  const allFindings = moderatorRounds.map(r => ({
    region: r.region,
    ...parseModeratorContent(r.content),
  }))

  const totalConsensus = allFindings.reduce((n, f) => n + f.consensus_findings.length, 0)
  const totalDisputes = allFindings.reduce((n, f) => n + f.resolved_disputes.length + f.unresolved_disputes.length, 0)
  const totalErrors = allFindings.reduce((n, f) => n + f.caught_errors.length, 0)

  return (
    <section className="mt-10">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between mb-4 group">
        <h2 className="font-display font-bold text-xl text-text-primary flex items-center gap-2">
          Model Debate
          <span className="text-xs font-mono text-text-muted font-normal">
            {modelsUsed.join(' vs ')}
          </span>
        </h2>
        <span className="text-text-muted text-sm">{expanded ? '▼' : '▶'}</span>
      </button>

      {expanded && (
        <div className="space-y-6">
          <p className="text-sm text-text-muted">
            {modelsUsed.length} AI models independently analyzed the same sources, then challenged each other&apos;s findings.
            {totalConsensus > 0 && ` ${totalConsensus} consensus findings.`}
            {totalDisputes > 0 && ` ${totalDisputes} disputes.`}
            {totalErrors > 0 && ` ${totalErrors} errors caught.`}
          </p>

          {allFindings.map((finding) => (
            <div key={finding.region} className="border border-border rounded-lg overflow-hidden">
              <div className="bg-surface px-4 py-2 border-b border-border">
                <h3 className="text-sm font-mono text-text-secondary">{finding.region}</h3>
              </div>

              <div className="p-4 space-y-4">
                {/* Consensus */}
                {finding.consensus_findings.map((c, i) => (
                  <div key={i} className="border-l-2 border-green-500 pl-3">
                    <p className="text-xs font-mono text-green-400 mb-1">CONSENSUS — {c.models_agreeing.join(', ')}</p>
                    <p className="text-sm text-text-secondary">{c.fact}</p>
                  </div>
                ))}

                {/* Resolved */}
                {finding.resolved_disputes.map((d, i) => (
                  <div key={i} className="border-l-2 border-amber-500 pl-3">
                    <p className="text-xs font-mono text-amber-400 mb-1">RESOLVED DISPUTE — {d.final_confidence}</p>
                    <p className="text-sm text-text-secondary">{d.claim}</p>
                    <p className="text-xs text-text-muted mt-1">{d.resolution}</p>
                  </div>
                ))}

                {/* Unresolved */}
                {finding.unresolved_disputes.map((d, i) => (
                  <div key={i} className="border-l-2 border-red-500 pl-3">
                    <p className="text-xs font-mono text-red-400 mb-1">UNRESOLVED</p>
                    <p className="text-sm text-text-secondary">{d.claim}</p>
                    <div className="grid grid-cols-2 gap-2 mt-2 text-xs text-text-muted">
                      <div><span className="text-text-secondary">{d.side_a.models.join(', ')}:</span> {d.side_a.position}</div>
                      <div><span className="text-text-secondary">{d.side_b.models.join(', ')}:</span> {d.side_b.position}</div>
                    </div>
                  </div>
                ))}

                {/* Caught Errors */}
                {finding.caught_errors.map((e, i) => (
                  <div key={i} className="border-l-2 border-purple-500 pl-3">
                    <p className="text-xs font-mono text-purple-400 mb-1">ERROR CAUGHT by {e.caught_by} — {e.error_type}</p>
                    <p className="text-sm text-text-secondary">{e.original_claim}</p>
                    <p className="text-xs text-text-muted mt-1">{e.explanation}</p>
                  </div>
                ))}

                {finding.consensus_findings.length === 0 && finding.resolved_disputes.length === 0 && finding.unresolved_disputes.length === 0 && finding.caught_errors.length === 0 && (
                  <p className="text-sm text-text-muted">No debate data for this region.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
