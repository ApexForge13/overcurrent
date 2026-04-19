/**
 * Stripe products + prices + coupon bootstrap (Phase 4).
 *
 * Idempotent — safe to run multiple times. Uses each resource's `lookup_key`
 * (Products, Prices) or `id` (Coupon) to detect existing objects and avoid
 * re-creating them. Updates metadata on every run so credit allocations and
 * tier flags stay in sync with this script.
 *
 * Run against test mode first. Do NOT run against live mode until the full
 * subscribe → webhook → Subscription row flow has been manually verified.
 *
 *   Test:  STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/stripe/setup-products.ts
 *   Live:  STRIPE_SECRET_KEY=sk_live_... npx tsx scripts/stripe/setup-products.ts
 *
 * Outputs: prints every resource's id to stdout + writes a JSON snapshot to
 * scripts/stripe/products-snapshot.json so the app can pin price_ids.
 *
 * Three products (enterprise is manual invoicing — never auto-created):
 *   consumer_paid       $19.99/mo or $199/yr, 1-credit signup bonus, no recurring credits
 *   b2b_researcher      $99/mo, $50/mo credits included
 *   b2b_organization    $499/mo, $250/mo credits included
 *
 * Founding rate coupon:
 *   FOUNDING500: $5 off forever, max_redemptions=500, applies to consumer_paid monthly
 */

import 'dotenv/config'
import Stripe from 'stripe'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY
if (!STRIPE_SECRET_KEY) {
  console.error('ERROR: STRIPE_SECRET_KEY is not set. Put it in .env (test mode key — sk_test_…).')
  process.exit(1)
}

const isLiveMode = STRIPE_SECRET_KEY.startsWith('sk_live_')

const stripe = new Stripe(STRIPE_SECRET_KEY)

// ─────────────────────────────────────────────────────────────────────────
// Product specs
// ─────────────────────────────────────────────────────────────────────────

interface PriceSpec {
  lookupKey: string
  unitAmountCents: number
  interval: 'month' | 'year'
  nickname: string
}

interface ProductSpec {
  lookupKey: string
  name: string
  description: string
  metadata: Record<string, string>
  prices: PriceSpec[]
}

// Consumer: one-time signup bonus model (no recurring monthly credits).
// All three prices carry the same bonus — one free analysis on first subscribe,
// then overage-only after.
//
// Founding rate: consumer_paid_founding_monthly is a DISTINCT $14.99/mo price,
// not a discount coupon applied to the $19.99 standard price. The $19.99 price
// stays and is the permanent rate. Access to the $14.99 price is gated by the
// FOUNDING promo code at checkout and capped at 500 active subscriptions; after
// that point the checkout route falls back to the standard $19.99 price.
// The cap is enforced in the app (counting Subscription rows at the founding
// price id) — Stripe itself does not limit the price.
const CONSUMER_PAID: ProductSpec = {
  lookupKey: 'consumer_paid',
  name: 'Overcurrent — Consumer Paid',
  description:
    'Full analysis access: debate transcripts, arc timelines, entity dossiers, alerts, knowledge graph, raw signal summaries, PDF export. One free analysis credit included on signup (non-recurring). Additional analyses at cost+50% overage.',
  metadata: {
    tier: 'consumer_paid',
    signup_bonus_credits: '1',
    signup_bonus_once: 'true',
    monthly_credits: '0',
    monthly_credits_usd: '0',
    overage_markup_percent: '50',
    overage_cost_basis_usd_per_credit: '4.50',
    founding_price_lookup_key: 'consumer_paid_founding_monthly',
    founding_cap_total: '500',
  },
  prices: [
    {
      lookupKey: 'consumer_paid_monthly',
      unitAmountCents: 1999,
      interval: 'month',
      nickname: 'Consumer Paid — Monthly (standard)',
    },
    {
      lookupKey: 'consumer_paid_founding_monthly',
      unitAmountCents: 1499,
      interval: 'month',
      nickname: 'Consumer Paid — Founding Monthly (first 500 via FOUNDING code)',
    },
    {
      lookupKey: 'consumer_paid_annual',
      unitAmountCents: 19900,
      interval: 'year',
      nickname: 'Consumer Paid — Annual (17% off)',
    },
  ],
}

// B2B Researcher: $50 of credits included per month (recurring). Credits
// decay on period reset unless the subscription is annual (Phase 22 wires
// rollover). monthly_credits = floor($50 / $4.50) = 11.
const B2B_RESEARCHER: ProductSpec = {
  lookupKey: 'b2b_researcher',
  name: 'Overcurrent — B2B Researcher',
  description:
    'All consumer paid features plus self-service analysis runs, basic API access, and $50/month of included credits (~11 analyses). Overage at cost+50%.',
  metadata: {
    tier: 'b2b_researcher',
    signup_bonus_credits: '0',
    signup_bonus_once: 'false',
    monthly_credits: '11',
    monthly_credits_usd: '50',
    overage_markup_percent: '50',
    overage_cost_basis_usd_per_credit: '4.50',
  },
  prices: [
    {
      lookupKey: 'b2b_researcher_monthly',
      unitAmountCents: 9900,
      interval: 'month',
      nickname: 'B2B Researcher — Monthly',
    },
  ],
}

// B2B Organization: $250 of credits included per month. monthly_credits =
// floor($250 / $4.50) = 55.
const B2B_ORGANIZATION: ProductSpec = {
  lookupKey: 'b2b_organization',
  name: 'Overcurrent — B2B Organization',
  description:
    'All researcher features plus outlet fingerprint access, priority pipeline, and $250/month of included credits (~55 analyses). Overage at cost+50%. Multi-seat management.',
  metadata: {
    tier: 'b2b_organization',
    signup_bonus_credits: '0',
    signup_bonus_once: 'false',
    monthly_credits: '55',
    monthly_credits_usd: '250',
    overage_markup_percent: '50',
    overage_cost_basis_usd_per_credit: '4.50',
  },
  prices: [
    {
      lookupKey: 'b2b_organization_monthly',
      unitAmountCents: 49900,
      interval: 'month',
      nickname: 'B2B Organization — Monthly',
    },
  ],
}

const PRODUCTS: ProductSpec[] = [CONSUMER_PAID, B2B_RESEARCHER, B2B_ORGANIZATION]

// Founding rate is a DISTINCT $14.99/mo price (not a discount coupon).
// Access is gated by the FOUNDING promo code at checkout and capped at 500
// active subscriptions via app-level counting — no Stripe coupon or promo
// code object is created. When the cap is reached, the checkout route
// falls back to the standard $19.99 price.
const FOUNDING_PROMO_CODE = 'FOUNDING'
const FOUNDING_CAP_TOTAL = 500

// ─────────────────────────────────────────────────────────────────────────
// Upsert helpers
// ─────────────────────────────────────────────────────────────────────────

async function upsertProduct(spec: ProductSpec): Promise<Stripe.Product> {
  // Stripe allows lookup by metadata via search (beta) but the simpler path
  // is to list and filter client-side — we have at most a handful of products.
  const existing = await stripe.products.list({ limit: 100, active: true })
  const match = existing.data.find((p) => p.metadata?.lookup_key === spec.lookupKey)

  if (match) {
    // Update in place to keep metadata + name current with this script.
    const updated = await stripe.products.update(match.id, {
      name: spec.name,
      description: spec.description,
      metadata: { ...spec.metadata, lookup_key: spec.lookupKey },
    })
    console.log(`  product update: ${spec.lookupKey} -> ${updated.id}`)
    return updated
  }

  const created = await stripe.products.create({
    name: spec.name,
    description: spec.description,
    metadata: { ...spec.metadata, lookup_key: spec.lookupKey },
  })
  console.log(`  product create: ${spec.lookupKey} -> ${created.id}`)
  return created
}

async function upsertPrice(product: Stripe.Product, spec: PriceSpec): Promise<Stripe.Price> {
  const existing = await stripe.prices.list({
    product: product.id,
    active: true,
    limit: 100,
    lookup_keys: [spec.lookupKey],
  })
  const match = existing.data[0]

  if (match) {
    // Prices are immutable in Stripe for amount/interval. Only nickname/metadata
    // can update in-place without archiving and re-creating.
    const updated = await stripe.prices.update(match.id, {
      nickname: spec.nickname,
      metadata: {
        lookup_key: spec.lookupKey,
        tier: product.metadata.tier,
      },
    })
    console.log(`    price update: ${spec.lookupKey} -> ${updated.id} ($${(spec.unitAmountCents / 100).toFixed(2)}/${spec.interval})`)
    return updated
  }

  const created = await stripe.prices.create({
    product: product.id,
    unit_amount: spec.unitAmountCents,
    currency: 'usd',
    recurring: { interval: spec.interval },
    nickname: spec.nickname,
    lookup_key: spec.lookupKey,
    metadata: {
      lookup_key: spec.lookupKey,
      tier: product.metadata.tier,
    },
  })
  console.log(`    price create: ${spec.lookupKey} -> ${created.id} ($${(spec.unitAmountCents / 100).toFixed(2)}/${spec.interval})`)
  return created
}

// Founding gate is enforced in the app (checkout route counts Subscription
// rows at the founding price id). No Stripe coupon or promo code objects
// are created — the FOUNDING code is recognized app-side as a signal that
// the user wants the founding price, and the 500 cap is counted against
// our own DB rather than Stripe redemptions.

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

interface Snapshot {
  mode: 'test' | 'live'
  generatedAt: string
  products: Array<{
    lookupKey: string
    productId: string
    prices: Array<{ lookupKey: string; priceId: string; unitAmountCents: number; interval: string }>
    metadata: Record<string, string>
  }>
  founding: {
    promoCode: string
    capTotal: number
    foundingPriceLookupKey: string
    enforcement: 'app_level_count_of_subscription_rows'
  }
}

async function main() {
  console.log('\n━━━ STRIPE SETUP ━━━')
  console.log(`mode: ${isLiveMode ? 'LIVE' : 'test'}`)
  console.log(`date: ${new Date().toISOString()}`)
  console.log()

  if (isLiveMode) {
    console.warn('━━━ WARNING: LIVE MODE DETECTED ━━━')
    console.warn('STRIPE_SECRET_KEY is a live key. This script will create REAL products.')
    console.warn('Press Ctrl-C NOW if you meant to run in test mode.')
    console.warn('Continuing in 5 seconds…\n')
    await new Promise((r) => setTimeout(r, 5000))
  }

  const snapshot: Snapshot = {
    mode: isLiveMode ? 'live' : 'test',
    generatedAt: new Date().toISOString(),
    products: [],
    founding: {
      promoCode: FOUNDING_PROMO_CODE,
      capTotal: FOUNDING_CAP_TOTAL,
      foundingPriceLookupKey: 'consumer_paid_founding_monthly',
      enforcement: 'app_level_count_of_subscription_rows',
    },
  }

  for (const spec of PRODUCTS) {
    console.log(`▶ ${spec.lookupKey}`)
    const product = await upsertProduct(spec)
    const prices: Array<{ lookupKey: string; priceId: string; unitAmountCents: number; interval: string }> = []
    for (const priceSpec of spec.prices) {
      const price = await upsertPrice(product, priceSpec)
      prices.push({
        lookupKey: priceSpec.lookupKey,
        priceId: price.id,
        unitAmountCents: priceSpec.unitAmountCents,
        interval: priceSpec.interval,
      })
    }
    snapshot.products.push({
      lookupKey: spec.lookupKey,
      productId: product.id,
      prices,
      metadata: spec.metadata,
    })
  }

  console.log('\n▶ founding rate')
  console.log(`  promo code:        ${FOUNDING_PROMO_CODE} (app-level signal, no Stripe coupon created)`)
  console.log(`  founding price:    consumer_paid_founding_monthly ($14.99/mo)`)
  console.log(`  cap:               ${FOUNDING_CAP_TOTAL} active subscriptions, enforced by checkout route`)

  // Write snapshot for the app to pin price IDs. The app reads prices via
  // lookup_key at runtime — the snapshot is primarily for human reference.
  const dir = dirname(fileURLToPath(import.meta.url))
  const snapshotPath = join(dir, 'products-snapshot.json')
  mkdirSync(dir, { recursive: true })
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2))
  console.log(`\nSnapshot written: ${snapshotPath}`)

  console.log('\n━━━ DONE ━━━')
  console.log('Next steps:')
  console.log('  1. Add STRIPE_SECRET_KEY (test) to Vercel env')
  console.log('  2. Add STRIPE_WEBHOOK_SECRET (test) to Vercel env after registering the webhook endpoint')
  console.log('  3. Set the Stripe webhook URL: https://<host>/api/stripe/webhook')
  console.log('     Events: customer.subscription.created, customer.subscription.updated, customer.subscription.deleted')
  console.log('  4. Run the subscribe flow end-to-end in test mode before switching to live keys.')
  console.log()
}

main()
  .catch((err) => {
    console.error('[setup-products] FATAL:', err)
    process.exit(1)
  })
