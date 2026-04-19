-- ═══════════════════════════════════════════════════════════════════════════
-- Session 4 Phase 4 — Subscriptions & Billing foundation
--
-- Adds a single Subscription table. Does NOT modify the existing email gate
-- (email_captures + client-side localStorage) — unauth users and
-- authenticated-without-subscription users are both treated as "free" tier
-- by lib/permissions.ts. Full credit consumption tracking (CreditBalance,
-- CreditLedger, overage billing logic) lands in Phase 22 — this migration
-- only persists who has what tier and whether their one-time consumer
-- signup bonus has been granted.
--
-- Consumer paid tiers ($14.99 founding / $19.99 standard / $199 annual):
--   one-time signup bonus of 1 analysis credit (signupBonusGranted flag),
--   no recurring monthly credits, overage at cost+50%.
-- B2B tiers ($99 researcher / $499 organization):
--   monthly recurring credit allocations ($50 / $250 respectively),
--   never set signupBonusGranted.
-- Enterprise tiers: manual invoicing, tier field set directly by admin —
--   no Stripe product / price is created for them.
-- ═══════════════════════════════════════════════════════════════════════════

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'active',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "billingInterval" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "signupBonusGranted" BOOLEAN NOT NULL DEFAULT false,
    "signupBonusGrantedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_userId_idx" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Subscription_stripeCustomerId_idx" ON "Subscription"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "Subscription_tier_status_idx" ON "Subscription"("tier", "status");
