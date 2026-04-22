/**
 * /admin/triggers — trigger management dashboard.
 *
 * Server component: gathers TRIGGER_DEFINITIONS + TriggerEnablement +
 * firing-stats + baseline-status, renders the table. Mutations happen
 * via API routes (toggle + thresholds).
 */

import { prisma } from '@/lib/db'
import {
  TRIGGER_DEFINITIONS,
  ALL_TRIGGER_IDS,
} from '@/lib/gap-score/triggers/registry'
import { getFiringStats } from '@/lib/gap-score/triggers/firing-stats'
import {
  getEntityBaselineStatus,
  getZoneBaselineStatus,
} from '@/lib/gap-score/triggers/baseline-status'
import { TriggerToggle } from './TriggerToggle'
import { ThresholdEditor } from './ThresholdEditor'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function formatRelative(d: Date | null): string {
  if (!d) return 'never'
  const ms = Date.now() - d.getTime()
  if (ms < 60_000) return 'just now'
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  return `${days}d ago`
}

export default async function TriggersPage() {
  const [enablementRows, firingStats, entityBaselines, zoneBaselines] = await Promise.all([
    prisma.triggerEnablement.findMany({
      select: { triggerId: true, enabled: true, thresholdOverrides: true },
    }),
    getFiringStats(prisma),
    getEntityBaselineStatus(prisma, 50),
    getZoneBaselineStatus(prisma),
  ])
  const enablementByTrigger = new Map(enablementRows.map((r) => [r.triggerId, r]))

  const rows = ALL_TRIGGER_IDS.map((id) => {
    const def = TRIGGER_DEFINITIONS[id]
    const enrow = enablementByTrigger.get(id)
    const stats = firingStats.get(id)
    return {
      id,
      stream: def.stream,
      description: def.description,
      requiresBaseline: def.requiresBaseline,
      enabled: enrow?.enabled ?? true, // default ENABLED per manifest A3
      thresholdOverrides: enrow?.thresholdOverrides
        ? (enrow.thresholdOverrides as Record<string, number>)
        : null,
      fires24h: stats?.fires24h ?? 0,
      fires7d: stats?.fires7d ?? 0,
      fires30d: stats?.fires30d ?? 0,
      lastFiredAt: stats?.lastFiredAt ?? null,
    }
  })

  const totalFires24h = rows.reduce((acc, r) => acc + r.fires24h, 0)
  const totalFires7d = rows.reduce((acc, r) => acc + r.fires7d, 0)
  const totalFires30d = rows.reduce((acc, r) => acc + r.fires30d, 0)
  const matureEntityBaselines = entityBaselines.filter((b) => b.isMature).length
  const matureZoneBaselines = zoneBaselines.filter((b) => b.isMature).length

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-display text-xl font-bold text-text-primary mb-2">── Triggers ─────────────────────────────────────────────────</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm font-mono">
          <Stat label="Triggers" value={rows.length} />
          <Stat label="Fires 24h" value={totalFires24h} />
          <Stat label="Fires 7d" value={totalFires7d} />
          <Stat label="Fires 30d" value={totalFires30d} />
        </div>

        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-border text-text-muted">
              <th className="text-left py-2 pr-2">ID</th>
              <th className="text-left py-2 pr-2">Stream</th>
              <th className="text-left py-2 pr-2">Description</th>
              <th className="text-left py-2 pr-2">Enabled</th>
              <th className="text-right py-2 pr-2">24h</th>
              <th className="text-right py-2 pr-2">7d</th>
              <th className="text-right py-2 pr-2">30d</th>
              <th className="text-left py-2 pr-2">Last fired</th>
              <th className="text-left py-2">Thresholds</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/50 hover:bg-text-muted/5">
                <td className="py-2 pr-2 text-accent-teal">{r.id}</td>
                <td className="py-2 pr-2 text-text-secondary">{r.stream}</td>
                <td className="py-2 pr-2 text-text-secondary">{r.description}</td>
                <td className="py-2 pr-2">
                  <TriggerToggle triggerId={r.id} initialEnabled={r.enabled} />
                </td>
                <td className="py-2 pr-2 text-right text-text-primary">{r.fires24h}</td>
                <td className="py-2 pr-2 text-right text-text-primary">{r.fires7d}</td>
                <td className="py-2 pr-2 text-right text-text-primary">{r.fires30d}</td>
                <td className="py-2 pr-2 text-text-muted">{formatRelative(r.lastFiredAt)}</td>
                <td className="py-2">
                  <ThresholdEditor
                    triggerId={r.id}
                    initialOverrides={r.thresholdOverrides}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="font-display text-xl font-bold text-text-primary mb-2">── Entity baselines (50 most-relevant) ─────────────────────</h2>
        <p className="text-xs font-mono text-text-muted mb-2">
          {matureEntityBaselines} mature / {entityBaselines.length} shown — sorted immature-first then by sample-count desc
        </p>
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-border text-text-muted">
              <th className="text-left py-2 pr-2">Entity</th>
              <th className="text-left py-2 pr-2">Metric</th>
              <th className="text-right py-2 pr-2">Window</th>
              <th className="text-right py-2 pr-2">Samples</th>
              <th className="text-right py-2 pr-2">Min</th>
              <th className="text-right py-2 pr-2">Maturity</th>
              <th className="text-left py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {entityBaselines.map((b) => (
              <tr key={`${b.entityId}|${b.metricName}|${b.windowDays}`} className="border-b border-border/50">
                <td className="py-1 pr-2 text-accent-teal">{b.identifier}</td>
                <td className="py-1 pr-2 text-text-secondary">{b.metricName}</td>
                <td className="py-1 pr-2 text-right text-text-muted">{b.windowDays}d</td>
                <td className="py-1 pr-2 text-right text-text-primary">{b.sampleCount}</td>
                <td className="py-1 pr-2 text-right text-text-muted">{b.minSampleSize}</td>
                <td className="py-1 pr-2 text-right text-text-primary">
                  {Math.round(b.maturityPct * 100)}%
                </td>
                <td className="py-1">
                  {b.isMature ? (
                    <span className="text-accent-green">MATURE</span>
                  ) : (
                    <span className="text-accent-amber">calibrating</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="font-display text-xl font-bold text-text-primary mb-2">── Zone baselines ──────────────────────────────────────────</h2>
        <p className="text-xs font-mono text-text-muted mb-2">
          {matureZoneBaselines} mature / {zoneBaselines.length} total — Tier-1 maritime zones
        </p>
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-border text-text-muted">
              <th className="text-left py-2 pr-2">Zone</th>
              <th className="text-left py-2 pr-2">Metric</th>
              <th className="text-right py-2 pr-2">Samples</th>
              <th className="text-right py-2 pr-2">Min</th>
              <th className="text-right py-2 pr-2">Maturity</th>
              <th className="text-left py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {zoneBaselines.map((b) => (
              <tr key={`${b.zoneId}|${b.metricName}`} className="border-b border-border/50">
                <td className="py-1 pr-2 text-accent-teal">{b.zoneId}</td>
                <td className="py-1 pr-2 text-text-secondary">{b.metricName}</td>
                <td className="py-1 pr-2 text-right text-text-primary">{b.sampleCount}</td>
                <td className="py-1 pr-2 text-right text-text-muted">{b.minSampleSize}</td>
                <td className="py-1 pr-2 text-right text-text-primary">
                  {Math.round(b.maturityPct * 100)}%
                </td>
                <td className="py-1">
                  {b.isMature ? (
                    <span className="text-accent-green">MATURE</span>
                  ) : (
                    <span className="text-accent-amber">calibrating</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-border rounded p-3">
      <div className="text-xs text-text-muted uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-display font-bold text-text-primary">{value}</div>
    </div>
  )
}
