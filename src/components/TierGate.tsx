"use client"
/**
 * TierGate — inline feature-access gate (Phase 4).
 *
 * Renders its children when the current user has the required subscription
 * tier. Renders an inline upgrade CTA when they don't. NEVER redirects —
 * per master prompt standing rule: "Paywall always renders inline. Never
 * redirects."
 *
 * This is DIFFERENT from the existing Paywall.tsx + StoryPaywallWrapper.tsx
 * pair — those handle the anonymous "3 free article reads" email gate.
 * TierGate handles paid-tier feature access (debate transcripts, search,
 * alerts, outlet fingerprints, etc.) once a user IS logged in.
 *
 * Usage from a server component:
 *   const perms = await getUserPermissions()
 *   <TierGate feature="debate_transcripts" requiredTier="consumer_paid" perms={perms}>
 *     <TranscriptPanel ... />
 *   </TierGate>
 *
 * Usage from a client component where you already have the boolean:
 *   <TierGate feature="search" requiredTier="consumer_paid" hasAccess={perms.canAccessSearch}>
 *     <SearchUI ... />
 *   </TierGate>
 *
 * The component trusts whatever boolean it receives — it is intentionally
 * decoupled from permissions loading so server + client usage is symmetric.
 */

import type { SubscriptionTier, UserPermissions } from '@/lib/permissions'
import type { ReactNode } from 'react'

interface TierGateProps {
  /** Short slug naming the gated feature. Surfaces in data attrs for telemetry. */
  feature: string
  /** Minimum tier required. Drives the CTA label ("Upgrade to Consumer Paid"). */
  requiredTier: SubscriptionTier
  /** Rendered when the user has access. Ignored when gated. */
  children: ReactNode
  /**
   * Either pass the full UserPermissions object (server components) or the
   * precomputed boolean (client components). hasAccess wins if both given.
   */
  perms?: UserPermissions
  hasAccess?: boolean
  /** Custom headline for the CTA — defaults to a sensible per-tier string. */
  ctaHeadline?: string
  /** Explanation shown under the CTA headline. */
  ctaBody?: string
  /** Override the default CTA link destination. */
  ctaHref?: string
  /** Full render override — returns ReactNode, gets feature/tier context. */
  renderGate?: (params: {
    feature: string
    requiredTier: SubscriptionTier
    currentTier: SubscriptionTier | null
  }) => ReactNode
}

const TIER_LABEL: Record<SubscriptionTier, string> = {
  free: 'Free',
  consumer_paid: 'Consumer Paid',
  b2b_researcher: 'B2B Researcher',
  b2b_organization: 'B2B Organization',
  enterprise_small: 'Enterprise Small',
  enterprise_mid: 'Enterprise Mid',
  enterprise_large: 'Enterprise Large',
  enterprise_trophy: 'Enterprise Trophy',
}

const TIER_DEFAULT_HREF: Record<SubscriptionTier, string> = {
  free: '/subscribe',
  consumer_paid: '/subscribe',
  b2b_researcher: '/subscribe?tier=b2b_researcher',
  b2b_organization: '/subscribe?tier=b2b_organization',
  enterprise_small: '/enterprise',
  enterprise_mid: '/enterprise',
  enterprise_large: '/enterprise',
  enterprise_trophy: '/enterprise',
}

// Mirror of TIER_RANK in lib/permissions.ts — duplicated so the client
// bundle doesn't pull in Prisma + Supabase server code.
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

function hasTierAccess(perms: UserPermissions, requiredTier: SubscriptionTier): boolean {
  if (perms.isAdmin) return true
  if (!perms.isPaid && requiredTier !== 'free') return false
  return TIER_RANK[perms.tier] >= TIER_RANK[requiredTier]
}

function resolveAccess(props: TierGateProps): boolean {
  if (typeof props.hasAccess === 'boolean') return props.hasAccess
  if (!props.perms) return false
  return hasTierAccess(props.perms, props.requiredTier)
}

export function TierGate(props: TierGateProps) {
  const access = resolveAccess(props)
  if (access) return <>{props.children}</>

  if (props.renderGate) {
    return <>{props.renderGate({
      feature: props.feature,
      requiredTier: props.requiredTier,
      currentTier: props.perms?.tier ?? null,
    })}</>
  }

  const tierLabel = TIER_LABEL[props.requiredTier]
  const href = props.ctaHref ?? TIER_DEFAULT_HREF[props.requiredTier]
  const currentTier = props.perms?.tier ?? 'free'

  const headline = props.ctaHeadline ?? `Upgrade to ${tierLabel}`
  const body =
    props.ctaBody ??
    (props.requiredTier === 'consumer_paid'
      ? 'Full analysis access, debate transcripts, arc timelines, entity dossiers, alerts, knowledge graph, raw signal summaries, and PDF export.'
      : props.requiredTier === 'b2b_researcher' || props.requiredTier === 'b2b_organization'
        ? 'Self-service analysis runs, outlet fingerprint profiles, API access, and monthly credit allocation.'
        : 'Enterprise-grade ambient monitoring, portfolio integration, custom brief templates, and isolated deployment.')

  return (
    <div
      className="border border-accent-amber/50 bg-accent-amber/5 p-6 my-4"
      data-tier-gate-feature={props.feature}
      data-tier-gate-required={props.requiredTier}
      data-tier-gate-current={currentTier}
    >
      <div className="text-xs font-mono text-accent-amber uppercase tracking-wider mb-2">
        ── {tierLabel} subscribers only ────
      </div>
      <h3 className="font-display font-bold text-lg text-text-primary mb-2">{headline}</h3>
      <p className="text-sm text-text-secondary mb-4">{body}</p>
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={href}
          className="inline-block px-4 py-2 text-sm font-mono border border-accent-teal text-accent-teal hover:bg-accent-teal/10"
        >
          {props.perms?.isAuthenticated ? 'Upgrade now' : 'Subscribe'}
        </a>
        {!props.perms?.isAuthenticated && (
          <a href="/login" className="text-xs font-mono text-text-muted hover:text-text-primary">
            Already subscribed? Log in
          </a>
        )}
        {props.perms?.tier === 'free' && props.requiredTier === 'consumer_paid' && (
          <span className="text-xs font-mono text-accent-amber">
            Founding rate $14.99/mo while available
          </span>
        )}
      </div>
    </div>
  )
}

export default TierGate
