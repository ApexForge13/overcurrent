import { stripe, PLANS } from '@/lib/stripe'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const { plan } = await request.json()

  if (!plan || !PLANS[plan as keyof typeof PLANS]) {
    return Response.json({ error: 'Invalid plan' }, { status: 400 })
  }

  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Must be logged in' }, { status: 401 })
  }

  const planConfig = PLANS[plan as keyof typeof PLANS]

  try {
    // Create or get Stripe customer
    const customers = await stripe.customers.list({ email: user.email!, limit: 1 })
    let customerId: string

    if (customers.data.length > 0) {
      customerId = customers.data[0].id
    } else {
      const customer = await stripe.customers.create({
        email: user.email!,
        metadata: { supabase_user_id: user.id },
      })
      customerId = customer.id
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: planConfig.name,
            description: planConfig.description,
          },
          unit_amount: planConfig.price,
          recurring: { interval: planConfig.interval },
        },
        quantity: 1,
      }],
      success_url: `${process.env.NEXT_PUBLIC_SUPABASE_URL ? 'https://overcurrent.news' : 'http://localhost:3000'}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_SUPABASE_URL ? 'https://overcurrent.news' : 'http://localhost:3000'}/subscribe`,
      metadata: {
        supabase_user_id: user.id,
        plan,
      },
    })

    return Response.json({ url: session.url })
  } catch (err) {
    console.error('Stripe checkout error:', err)
    return Response.json({ error: 'Failed to create checkout session' }, { status: 500 })
  }
}
