/**
 * Stripe webhook — subscription lifecycle sync (Phase 4).
 *
 * Canonical state lives in the Subscription table. For backward compat
 * during the transition away from the legacy `user_metadata.subscribed`
 * flag (still read by StoryPaywallWrapper), we dual-write: Supabase user
 * metadata continues to reflect subscribed/not-subscribed until that
 * wrapper migrates in a later phase.
 *
 * Events handled:
 *   customer.subscription.created  — new subscription, grant consumer signup bonus
 *   customer.subscription.updated  — status / price / cancel-at-period-end changes
 *   customer.subscription.deleted  — subscription canceled
 *   invoice.payment_failed         — log only; Stripe handles retry
 *   checkout.session.completed     — no-op here; subscription.created does the work
 */

import { headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { prisma } from '@/lib/db'
import {
  getStripeClient,
  resolveTierFromProduct,
  normalizeStripeStatus,
  tierGrantsSignupBonus,
} from '@/lib/stripe'

// Supabase admin client — used to mirror subscribed flag into user_metadata
// so the legacy StoryPaywallWrapper continues to work during migration.
// In production this should use SUPABASE_SERVICE_ROLE_KEY; the anon key
// is used today per the legacy setup.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

export async function POST(request: Request) {
  const body = await request.text()
  const headersList = await headers()
  const sig = headersList.get('stripe-signature')
  const stripe = getStripeClient()

  let event: Stripe.Event
  try {
    if (process.env.STRIPE_WEBHOOK_SECRET && sig) {
      event = stripe.webhooks.constructEvent(
        body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET,
      )
    } else {
      // Dev/test without webhook secret — parse raw JSON. Never use in prod.
      event = JSON.parse(body) as Stripe.Event
    }
  } catch (err) {
    console.error('[stripe/webhook] signature verify failed:', err)
    return Response.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        await syncSubscription(event.data.object as Stripe.Subscription)
        break
      }

      case 'customer.subscription.deleted': {
        await handleDeleted(event.data.object as Stripe.Subscription)
        break
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice
        console.warn('[stripe/webhook] payment_failed customer=', inv.customer)
        break
      }

      // checkout.session.completed intentionally no-op — we listen to
      // subscription.created/updated instead, which fire immediately after
      // and carry more reliable state.
    }
  } catch (err) {
    console.error('[stripe/webhook] handler error:', err)
    // Return 500 so Stripe retries. Don't swallow — silent failures are worse
    // than transient duplicate deliveries (webhooks are idempotent by design).
    return Response.json({ error: 'handler error' }, { status: 500 })
  }

  return Response.json({ received: true })
}

/**
 * Upsert a Subscription row from a Stripe.Subscription object. Also grants
 * the one-time consumer signup bonus on first .created event. Dual-writes
 * user_metadata.subscribed for backward compat with StoryPaywallWrapper.
 */
async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const stripe = getStripeClient()
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id

  // Resolve Supabase user id. Prefer customer.metadata.supabase_user_id
  // (set by our checkout route on customer create). Fall back to email
  // lookup if metadata is missing on legacy customers.
  const customer = await stripe.customers.retrieve(customerId)
  if (customer.deleted) return
  const supabaseUserId = customer.metadata?.supabase_user_id ?? null
  const email = customer.email ?? null
  if (!supabaseUserId && !email) {
    console.warn(`[stripe/webhook] sub ${sub.id} has no supabase_user_id and no email; skipping`)
    return
  }

  // Resolve tier from the first subscription item's product.
  const item = sub.items.data[0]
  const product = item?.price?.product
    ? (typeof item.price.product === 'string'
        ? await stripe.products.retrieve(item.price.product)
        : (item.price.product as Stripe.Product))
    : null
  const tier = resolveTierFromProduct(product)
  const status = normalizeStripeStatus(sub.status)
  const billingInterval = item?.price?.recurring?.interval ?? null

  const whereClause = supabaseUserId
    ? { userId: supabaseUserId }
    : { stripeCustomerId: customerId }

  const existing = await prisma.subscription.findFirst({ where: whereClause })

  // Decide whether to grant the consumer signup bonus. Grant exactly once
  // per Subscription row: only on the FIRST transition into an active
  // consumer_paid state, and only if signupBonusGranted is still false.
  const shouldGrantBonus =
    tierGrantsSignupBonus(tier) &&
    (status === 'active' || status === 'trialing') &&
    !existing?.signupBonusGranted

  const data = {
    userId: supabaseUserId ?? existing?.userId ?? email!, // fallback to email when no supabase id
    userEmail: email ?? existing?.userEmail ?? '',
    tier,
    status,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    stripePriceId: item?.price?.id ?? null,
    billingInterval,
    currentPeriodStart:
      typeof (sub as unknown as { current_period_start?: number }).current_period_start === 'number'
        ? new Date((sub as unknown as { current_period_start: number }).current_period_start * 1000)
        : null,
    currentPeriodEnd:
      typeof (sub as unknown as { current_period_end?: number }).current_period_end === 'number'
        ? new Date((sub as unknown as { current_period_end: number }).current_period_end * 1000)
        : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
    canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    ...(shouldGrantBonus
      ? { signupBonusGranted: true, signupBonusGrantedAt: new Date() }
      : {}),
  }

  if (existing) {
    await prisma.subscription.update({
      where: { id: existing.id },
      data,
    })
  } else {
    await prisma.subscription.create({ data })
  }

  // Dual-write user_metadata for legacy StoryPaywallWrapper. Any non-free,
  // non-delinquent tier counts as "subscribed" for that component's bypass.
  if (supabaseUserId) {
    const isSubscribed =
      tier !== 'free' && (status === 'active' || status === 'trialing')
    await supabaseAdmin.auth.admin
      .updateUserById(supabaseUserId, {
        user_metadata: {
          subscribed: isSubscribed,
          tier,
          stripe_customer_id: customerId,
        },
      })
      .catch((err) => {
        console.warn('[stripe/webhook] user_metadata dual-write failed:', err)
      })
  }

  if (shouldGrantBonus) {
    console.log(
      `[stripe/webhook] Granted 1-credit signup bonus to consumer_paid subscriber ${supabaseUserId ?? email}`,
    )
  }
}

async function handleDeleted(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
  const stripe = getStripeClient()

  const existing = await prisma.subscription.findFirst({
    where: { stripeSubscriptionId: sub.id },
  })

  if (existing) {
    await prisma.subscription.update({
      where: { id: existing.id },
      data: {
        status: 'canceled',
        tier: 'free',
        canceledAt: new Date(),
      },
    })
  }

  // Mirror into user_metadata for legacy wrapper.
  const customer = await stripe.customers.retrieve(customerId)
  if (!customer.deleted && customer.metadata?.supabase_user_id) {
    await supabaseAdmin.auth.admin
      .updateUserById(customer.metadata.supabase_user_id, {
        user_metadata: {
          subscribed: false,
          tier: 'free',
          stripe_customer_id: customerId,
        },
      })
      .catch((err) => {
        console.warn('[stripe/webhook] legacy user_metadata clear failed:', err)
      })
  }
}
