/**
 * UserPermissions — single source of truth for gated-feature access (Phase 4).
 *
 * The rule (confirmed in Phase 1 checkpoint):
 *   Unauthenticated users         → free tier
 *   Authenticated, no subscription → free tier
 *   Authenticated, active subscription → tier from Subscription.tier
 *
 * The existing email_captures + localStorage "3 free articles" gate is
 * separate and unrelated — it caps anonymous article reads, not premium-
 * feature access. A user who captured their email but hasn't subscribed is
 * still "free" for this helper.
 *
 * Phase 22 will layer credit consumption checks on top of these boolean
 * capability flags. This phase only answers "does this user have access
 * to capability X?" — never "how many credits do they have left?"
 */

import { prisma } from '@/lib/db'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export type SubscriptionTier =
  | 'free'
  | 'consumer_paid'
  | 'b2b_researcher'
  | 'b2b_organization'
  | 'enterprise_small'
  | 'enterprise_mid'
  | 'enterprise_large'
  | 'enterprise_trophy'

export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'trialing'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'

export interface UserPermissions {
  // Identity
  userId: string | null
  userEmail: string | null
  isAuthenticated: boolean
  isAdmin: boolean

  // Subscription
  tier: SubscriptionTier
  status: SubscriptionStatus | null
  isPaid: boolean              // any tier above free with non-delinquent status
  stripeCustomerId: string | null

  // Consumer-tier gates (consumer_paid +)
  canViewDebateTranscripts: boolean
  canAccessSearch: boolean
  canBuildAlerts: boolean
  canAccessOutletProfiles: boolean
  canAccessArcTimelines: boolean
  canAccessKnowledgeGraph: boolean
  canAccessRawSignalSummaries: boolean
  canExportPdf: boolean
  canFollowArcs: boolean
  canUseInAnalysisChat: boolean

  // B2B gates (b2b_researcher +)
  canUseSelfServicePortal: boolean
  canAccessOutletFingerprints: boolean
  canAccessAPI: boolean

  // Enterprise-only gates
  canAccessEnterpriseFeatures: boolean
  canAccessAmbientMonitoring: boolean
}

// ─────────────────────────────────────────────────────────────────────────
// Tier hierarchy — numeric ranks drive the grants matrix below
// ─────────────────────────────────────────────────────────────────────────

const TIER_RANK: Record<SubscriptionTier, number> = {
  free: 0,
  consumer_paid: 1,
  b2b_researcher: 2,
  b2b_organization: 3,
  enterprise_small: 4,
  enterprise_mid: 5,
  enterprise_large: 6,
  enterprise_trophy: 7,
}

function atLeast(userTier: SubscriptionTier, requiredTier: SubscriptionTier): boolean {
  return TIER_RANK[userTier] >= TIER_RANK[requiredTier]
}

// A subscription is "paid" only when in one of these statuses. past_due and
// incomplete are delinquent — fall back to free tier until resolved.
function isPaidStatus(status: SubscriptionStatus): boolean {
  return status === 'active' || status === 'trialing'
}

// Admin allowlist — mirrors the admin layout's ADMIN_EMAILS env var
function parseAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? 'connermhecht13@gmail.com')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

// ─────────────────────────────────────────────────────────────────────────
// Build a UserPermissions object from a tier + identity
// ─────────────────────────────────────────────────────────────────────────

export function buildPermissions(params: {
  userId: string | null
  userEmail: string | null
  tier: SubscriptionTier
  status: SubscriptionStatus | null
  stripeCustomerId: string | null
  isAdmin: boolean
}): UserPermissions {
  const { userId, userEmail, tier, status, stripeCustomerId, isAdmin } = params

  // If delinquent, downgrade capability checks to free-tier grants but keep
  // the tier label intact so the UI can show "Your subscription is past due".
  const paid = status !== null && isPaidStatus(status)
  const effectiveTier: SubscriptionTier = paid ? tier : 'free'

  const gte = (required: SubscriptionTier) => atLeast(effectiveTier, required)
  // Admins bypass every gate, mirrors how /admin/* auth works.
  const grant = (required: SubscriptionTier) => isAdmin || gte(required)

  return {
    userId,
    userEmail,
    isAuthenticated: !!userId,
    isAdmin,
    tier,
    status,
    isPaid: paid && tier !== 'free',
    stripeCustomerId,

    // Consumer-tier capabilities
    canViewDebateTranscripts: grant('consumer_paid'),
    canAccessSearch: grant('consumer_paid'),
    canBuildAlerts: grant('consumer_paid'),
    canAccessOutletProfiles: grant('consumer_paid'),
    canAccessArcTimelines: grant('consumer_paid'),
    canAccessKnowledgeGraph: grant('consumer_paid'),
    canAccessRawSignalSummaries: grant('consumer_paid'),
    canExportPdf: grant('consumer_paid'),
    canFollowArcs: grant('consumer_paid'),
    canUseInAnalysisChat: grant('consumer_paid'),

    // B2B capabilities
    canUseSelfServicePortal: grant('b2b_researcher'),
    canAccessOutletFingerprints: grant('b2b_organization'),
    canAccessAPI: grant('b2b_researcher'),

    // Enterprise capabilities
    canAccessEnterpriseFeatures: grant('enterprise_small'),
    canAccessAmbientMonitoring: grant('enterprise_small'),
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Server-side helper — reads Supabase auth + Subscription table
// ─────────────────────────────────────────────────────────────────────────

export async function getUserPermissions(): Promise<UserPermissions> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  const userId = user?.id ?? null
  const userEmail = user?.email ?? null
  const isAdmin = !!userEmail && parseAdminEmails().includes(userEmail.toLowerCase())

  // Unauthenticated → free tier with no identity
  if (!userId) {
    return buildPermissions({
      userId: null,
      userEmail: null,
      tier: 'free',
      status: null,
      stripeCustomerId: null,
      isAdmin: false,
    })
  }

  const subscription = await prisma.subscription
    .findUnique({
      where: { userId },
      select: {
        tier: true,
        status: true,
        stripeCustomerId: true,
      },
    })
    .catch(() => null)

  const tier = (subscription?.tier as SubscriptionTier | undefined) ?? 'free'
  const status = (subscription?.status as SubscriptionStatus | undefined) ?? null
  const stripeCustomerId = subscription?.stripeCustomerId ?? null

  return buildPermissions({
    userId,
    userEmail,
    tier,
    status,
    stripeCustomerId,
    isAdmin,
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Convenience guards for API routes
// ─────────────────────────────────────────────────────────────────────────

/**
 * Ensure the caller has at least `requiredTier`. Returns a Response if they
 * don't (for API routes to bail out early), or null if they do.
 */
export async function requireTier(requiredTier: SubscriptionTier): Promise<Response | null> {
  const perms = await getUserPermissions()
  if (perms.isAdmin) return null
  if (atLeast(perms.tier, requiredTier) && perms.isPaid) return null
  return Response.json(
    {
      error: 'subscription_required',
      requiredTier,
      currentTier: perms.tier,
      status: perms.status,
    },
    { status: 402 },
  )
}

/**
 * Require any active paid subscription. Use when the exact tier doesn't
 * matter — just that the user has paid.
 */
export async function requirePaid(): Promise<Response | null> {
  const perms = await getUserPermissions()
  if (perms.isAdmin) return null
  if (perms.isPaid) return null
  return Response.json(
    {
      error: 'subscription_required',
      currentTier: perms.tier,
      status: perms.status,
    },
    { status: 402 },
  )
}
