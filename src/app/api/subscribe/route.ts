import { prisma } from '@/lib/db'

export async function POST(request: Request) {
  const { email } = await request.json()

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return Response.json({ error: 'Valid email required' }, { status: 400 })
  }

  const normalized = email.toLowerCase().trim()

  try {
    // Upsert — reactivate if previously unsubscribed
    await prisma.subscriber.upsert({
      where: { email: normalized },
      create: { email: normalized },
      update: { status: 'active', unsubscribedAt: null },
    })

    return Response.json({ success: true })
  } catch {
    return Response.json({ error: 'Failed to subscribe' }, { status: 500 })
  }
}
