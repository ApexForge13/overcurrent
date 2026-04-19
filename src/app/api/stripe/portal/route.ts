/**
 * Stripe Billing Portal session creator (Phase 4).
 *
 * Gives an authenticated user with a Stripe customer a URL to Stripe's
 * hosted subscription-management UI (update card, cancel, switch plan,
 * download invoices). Enterprise accounts with no Stripe customer id
 * get a 404 — they're manually invoiced and never flow through the portal.
 *
 * Body: {} (no params needed — customer is resolved from the Subscription table)
 * Returns: { url: "https://billing.stripe.com/..." }
 */

import { prisma } from '@/lib/db'
import { getStripeClient } from '@/lib/stripe'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Must be logged in' }, { status: 401 })
  }

  const subscription = await prisma.subscription.findUnique({
    where: { userId: user.id },
    select: { stripeCustomerId: true, tier: true },
  })

  if (!subscription?.stripeCustomerId) {
    return Response.json(
      { error: 'No Stripe customer on file. Enterprise accounts use manual invoicing.' },
      { status: 404 },
    )
  }

  const stripe = getStripeClient()
  const origin = new URL(request.url).origin

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${origin}/account`,
    })
    return Response.json({ url: session.url })
  } catch (err) {
    console.error('[stripe/portal] error:', err)
    const message = err instanceof Error ? err.message : 'Failed to create portal session'
    return Response.json({ error: message }, { status: 500 })
  }
}
