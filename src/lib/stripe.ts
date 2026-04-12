import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-03-25.dahlia',
})

// Price IDs will be created on first use and cached
// For now, we create them dynamically via the API
export const PLANS = {
  monthly: {
    name: 'Overcurrent Monthly',
    price: 499, // cents
    interval: 'month' as const,
    description: 'Full access to all analyses',
  },
  annual: {
    name: 'Overcurrent Annual',
    price: 3999, // cents
    interval: 'year' as const,
    description: 'Save 33% — full access to all analyses',
  },
  founding: {
    name: 'Overcurrent Founding Member',
    price: 399, // cents
    interval: 'month' as const,
    description: '$3.99/mo locked forever — first 500 subscribers',
  },
}
