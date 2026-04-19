/**
 * Shared Stripe client + tier mapping helpers (Phase 4).
 *
 * Replaces the legacy PLANS map (stale $4.99/$3.99 pricing). New pricing
 * lives on the Stripe Products themselves (consumer_paid, b2b_researcher,
 * b2b_organization), created by scripts/stripe/setup-products.ts. The app
 * pins nothing — it looks up prices by lookup_key at checkout time so
 * pricing changes never require a code deploy.
 */

import Stripe from 'stripe'
import type { SubscriptionTier } from './permissions'

// Lazy singleton — only instantiates on first server-side access.
let _client: Stripe | null = null

export function getStripeClient(): Stripe {
  if (_client) return _client
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set — cannot use Stripe client')
  }
  _client = new Stripe(key)
  return _client
}

// Back-compat re-export. Older routes import `stripe` directly; new code
// should prefer getStripeClient() so module load never throws when the env
// var is absent (e.g. during tests).
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const client = getStripeClient()
    const value = client[prop as keyof Stripe]
    return typeof value === 'function' ? value.bind(client) : value
  },
})

/**
 * Map a Stripe Product's metadata to our SubscriptionTier enum. Returns
 * 'free' on unknown tier strings so a misconfigured product can never
 * silently upgrade a user.
 */
export function resolveTierFromProduct(product: Stripe.Product | null | undefined): SubscriptionTier {
  const raw = product?.metadata?.tier ?? product?.metadata?.lookup_key
  if (
    raw === 'consumer_paid' ||
    raw === 'b2b_researcher' ||
    raw === 'b2b_organization' ||
    raw === 'enterprise_small' ||
    raw === 'enterprise_mid' ||
    raw === 'enterprise_large' ||
    raw === 'enterprise_trophy'
  ) {
    return raw
  }
  return 'free'
}

/** Consumer tier is the only one that grants a one-time signup bonus. */
export function tierGrantsSignupBonus(tier: SubscriptionTier): boolean {
  return tier === 'consumer_paid'
}

/** Normalize a Stripe subscription.status string to our enum domain. */
export function normalizeStripeStatus(status: string): string {
  const valid = [
    'active',
    'past_due',
    'canceled',
    'trialing',
    'incomplete',
    'incomplete_expired',
    'unpaid',
  ]
  return valid.includes(status) ? status : 'incomplete'
}

/** Fetch a Stripe Price by lookup_key. Throws if not found. */
export async function getPriceByLookupKey(lookupKey: string): Promise<Stripe.Price> {
  const client = getStripeClient()
  const result = await client.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    expand: ['data.product'],
    limit: 1,
  })
  if (result.data.length === 0) {
    throw new Error(
      `No Stripe price with lookup_key="${lookupKey}". ` +
        `Run 'npx tsx scripts/stripe/setup-products.ts' first.`,
    )
  }
  return result.data[0]
}

/** Lookup keys emitted by setup-products.ts. */
export const PRICE_LOOKUP_KEYS = {
  consumer_paid_monthly: 'consumer_paid_monthly',
  consumer_paid_founding_monthly: 'consumer_paid_founding_monthly',
  consumer_paid_annual: 'consumer_paid_annual',
  b2b_researcher_monthly: 'b2b_researcher_monthly',
  b2b_organization_monthly: 'b2b_organization_monthly',
} as const

export type PriceLookupKey = (typeof PRICE_LOOKUP_KEYS)[keyof typeof PRICE_LOOKUP_KEYS]

/**
 * Founding rate is a DISTINCT $14.99/mo price (not a discount coupon).
 * The FOUNDING code is an app-level signal recognized by the checkout route
 * to swap the consumer_paid price from standard ($19.99) to founding ($14.99).
 * No Stripe coupon or promotion_code object exists.
 *
 * The 500-subscription cap is enforced in the app by counting Subscription
 * rows with stripePriceId == <founding price id>. When the cap is reached
 * the checkout route falls back to the standard price.
 */
export const FOUNDING_PROMO_CODE = 'FOUNDING'
export const FOUNDING_CAP_TOTAL = 500
