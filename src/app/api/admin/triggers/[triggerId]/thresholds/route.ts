/**
 * POST /api/admin/triggers/[triggerId]/thresholds
 *
 * Body: { thresholdOverrides: object | null }
 * Effect: upserts TriggerEnablement row, validates JSON shape (must be
 * a flat object of string→number or null to clear). Busts the cache.
 */

import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth-guard'
import { clearEnablementCache } from '@/lib/gap-score/triggers/enablement'
import { TRIGGER_DEFINITIONS } from '@/lib/gap-score/triggers/registry'

function validateOverrides(raw: unknown): { ok: true; value: object | null } | { ok: false; reason: string } {
  if (raw === null) return { ok: true, value: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'thresholdOverrides must be an object or null' }
  }
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== 'string' || k.length === 0) {
      return { ok: false, reason: 'override keys must be non-empty strings' }
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { ok: false, reason: `override value for "${k}" must be a finite number` }
    }
  }
  return { ok: true, value: raw as object }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ triggerId: string }> },
) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { triggerId } = await params
  if (!TRIGGER_DEFINITIONS[triggerId]) {
    return Response.json({ error: 'Unknown triggerId' }, { status: 404 })
  }

  let body: { thresholdOverrides?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const validation = validateOverrides(body.thresholdOverrides)
  if (!validation.ok) {
    return Response.json({ error: validation.reason }, { status: 400 })
  }

  const updated = await prisma.triggerEnablement.upsert({
    where: { triggerId },
    create: {
      triggerId,
      enabled: true, // intent-to-fire default per manifest A3
      thresholdOverrides: validation.value as object | undefined,
      updatedBy: auth.user.email,
    },
    update: {
      thresholdOverrides: validation.value as object | undefined,
      updatedBy: auth.user.email,
    },
  })
  clearEnablementCache()
  return Response.json({
    triggerId: updated.triggerId,
    thresholdOverrides: updated.thresholdOverrides,
  })
}
