import { stripe } from '@/lib/stripe'
import { headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

// Use service role for admin operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, // In production, use service_role key
)

export async function POST(request: Request) {
  const body = await request.text()
  const headersList = await headers()
  const sig = headersList.get('stripe-signature')

  let event

  try {
    if (process.env.STRIPE_WEBHOOK_SECRET && sig) {
      event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET)
    } else {
      // In dev/test without webhook secret, parse directly
      event = JSON.parse(body)
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return Response.json({ error: 'Invalid signature' }, { status: 400 })
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      const userId = session.metadata?.supabase_user_id
      const plan = session.metadata?.plan

      if (userId) {
        // Update user metadata to mark as subscribed
        await supabaseAdmin.auth.admin.updateUserById(userId, {
          user_metadata: { subscribed: true, plan, stripe_customer_id: session.customer },
        })
      }
      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object
      const customerId = subscription.customer as string

      // Find user by customer ID and remove subscription
      const customer = await stripe.customers.retrieve(customerId)
      if (!customer.deleted && customer.metadata?.supabase_user_id) {
        await supabaseAdmin.auth.admin.updateUserById(customer.metadata.supabase_user_id, {
          user_metadata: { subscribed: false, plan: null },
        })
      }
      break
    }

    case 'invoice.payment_failed': {
      // Log but don't immediately cancel — Stripe handles retry logic
      console.warn('Payment failed for:', event.data.object.customer)
      break
    }
  }

  return Response.json({ received: true })
}
