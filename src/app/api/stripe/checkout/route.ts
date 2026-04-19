/**
 * Stripe checkout session creator (Phase 4).
 *
 * Replaces the legacy dynamic-price-data flow. The new flow resolves prices
 * by lookup_key (set by scripts/stripe/setup-products.ts), so pricing
 * changes never require a code deploy — just re-run the setup script.
 *
 * Body shape:
 *   { lookupKey: "consumer_paid_monthly" | "consumer_paid_annual" |
 *                "b2b_researcher_monthly" | "b2b_organization_monthly",
 *     promotionCode?: "FOUNDING"  // optional — applies founding rate coupon
 *   }
 *
 * Returns:
 *   { url: "https://checkout.stripe.com/..." }
 *
 * The user must be authenticated. Creates or reuses a Stripe customer keyed
 * on supabase_user_id. On success the subscription.created webhook (handled
 * in webhook/route.ts) upserts the Subscription row + grants the consumer
 * signup bonus.
 */

import { prisma } from '@/lib/db'
import {
  getStripeClient,
  getPriceByLookupKey,
  FOUNDING_PROMO_CODE,
  FOUNDING_CAP_TOTAL,
} from '@/lib/stripe'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const VALID_LOOKUP_KEYS = new Set([
  'consumer_paid_monthly',
  'consumer_paid_founding_monthly',
  'consumer_paid_annual',
  'b2b_researcher_monthly',
  'b2b_organization_monthly',
])

/**
 * Founding-rate gate: count active+trialing subscriptions at the $14.99
 * founding price. Returns true iff there are still < FOUNDING_CAP_TOTAL
 * slots available.
 */
async function foundingCapAvailable(stripeFoundingPriceId: string): Promise<boolean> {
  const active = await prisma.subscription.count({
    where: {
      stripePriceId: stripeFoundingPriceId,
      status: { in: ['active', 'trialing'] },
    },
  })
  return active < FOUNDING_CAP_TOTAL
}

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Back-compat: legacy client passed { plan: "monthly" | "annual" | "founding" }.
  // Map legacy values to new lookup keys so in-flight pages don't break.
  const rawLookup = (body.lookupKey ?? body.plan) as string | undefined
  const legacyMap: Record<string, string> = {
    monthly: 'consumer_paid_monthly',
    annual: 'consumer_paid_annual',
    founding: 'consumer_paid_founding_monthly',
  }
  let lookupKey = rawLookup ? (legacyMap[rawLookup] ?? rawLookup) : undefined
  const promotionCode =
    typeof body.promotionCode === 'string'
      ? body.promotionCode.trim().toUpperCase()
      : rawLookup === 'founding'
        ? FOUNDING_PROMO_CODE
        : null

  if (!lookupKey || !VALID_LOOKUP_KEYS.has(lookupKey)) {
    return Response.json(
      { error: `Invalid lookupKey. Must be one of: ${[...VALID_LOOKUP_KEYS].join(', ')}` },
      { status: 400 },
    )
  }

  // Founding-rate gate: when the caller passes FOUNDING, route them to the
  // $14.99 founding price IF cap slots remain. Otherwise fall through to the
  // standard $19.99 price with a note. The FOUNDING code is purely an app-level
  // signal — no Stripe coupon object exists.
  let foundingFallback = false
  if (promotionCode === FOUNDING_PROMO_CODE) {
    // Rewrite lookup to the founding price regardless of what the client sent,
    // provided they were aiming at the consumer_paid product.
    if (
      lookupKey === 'consumer_paid_monthly' ||
      lookupKey === 'consumer_paid_founding_monthly'
    ) {
      const foundingPrice = await getPriceByLookupKey('consumer_paid_founding_monthly').catch(() => null)
      if (!foundingPrice) {
        return Response.json(
          { error: 'Founding price not configured — run scripts/stripe/setup-products.ts first' },
          { status: 500 },
        )
      }
      if (await foundingCapAvailable(foundingPrice.id)) {
        lookupKey = 'consumer_paid_founding_monthly'
      } else {
        // Cap reached — fall back to standard and flag the response.
        lookupKey = 'consumer_paid_monthly'
        foundingFallback = true
      }
    }
  } else if (lookupKey === 'consumer_paid_founding_monthly') {
    // Direct attempt at the founding price without the FOUNDING code — block.
    return Response.json(
      { error: 'Founding price requires promotionCode=FOUNDING' },
      { status: 400 },
    )
  }

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) {
    return Response.json({ error: 'Must be logged in' }, { status: 401 })
  }

  const stripe = getStripeClient()

  try {
    // Resolve price
    const price = await getPriceByLookupKey(lookupKey)

    // Create or reuse Stripe customer, keyed on supabase_user_id
    const existing = await stripe.customers.list({ email: user.email, limit: 1 })
    let customerId: string
    if (existing.data.length > 0) {
      customerId = existing.data[0].id
      // Ensure the supabase_user_id is stamped on the customer (legacy
      // customers may be missing it).
      if (existing.data[0].metadata?.supabase_user_id !== user.id) {
        await stripe.customers.update(customerId, {
          metadata: {
            ...existing.data[0].metadata,
            supabase_user_id: user.id,
          },
        })
      }
    } else {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      })
      customerId = customer.id
    }

    // Origin for redirects — honor the inbound request so staging/local work.
    const origin = new URL(request.url).origin

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: price.id, quantity: 1 }],
      // No Stripe-side discounts — FOUNDING is an app-level signal that
      // swaps the price, not a coupon. Keep allow_promotion_codes enabled
      // so future Stripe-native codes (if any) can still be entered.
      allow_promotion_codes: true,
      success_url: `${origin}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/subscribe`,
      metadata: {
        supabase_user_id: user.id,
        lookup_key: lookupKey,
        promotion_code_signal: promotionCode ?? '',
      },
      subscription_data: {
        metadata: {
          supabase_user_id: user.id,
          lookup_key: lookupKey,
          promotion_code_signal: promotionCode ?? '',
        },
      },
    })

    return Response.json({
      url: session.url,
      ...(foundingFallback
        ? {
            foundingCapReached: true,
            message:
              'Founding rate exhausted (500/500). Falling back to standard $19.99/mo pricing.',
          }
        : {}),
    })
  } catch (err) {
    console.error('[stripe/checkout] error:', err)
    const message = err instanceof Error ? err.message : 'Failed to create checkout session'
    return Response.json({ error: message }, { status: 500 })
  }
}
