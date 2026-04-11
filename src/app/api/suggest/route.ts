import { checkRateLimit } from '@/lib/rate-limit'

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const { allowed } = checkRateLimit(`suggest:${ip}`, 5, 60_000)
  if (!allowed) {
    return Response.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  let topic: string
  let description: string | undefined
  let email: string | undefined

  try {
    const body = await request.json()
    topic = body.topic
    description = body.description
    email = body.email
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!topic || typeof topic !== 'string') {
    return Response.json({ error: 'Topic is required' }, { status: 400 })
  }

  // StorySuggestion model may not exist yet — log for now.
  // We'll add the Prisma model later.
  console.log('[Suggestion]', { topic, description, email })

  return Response.json({ success: true })
}
