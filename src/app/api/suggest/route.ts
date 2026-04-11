export async function POST(request: Request) {
  const { topic, description, email } = await request.json()

  if (!topic || typeof topic !== 'string') {
    return Response.json({ error: 'Topic is required' }, { status: 400 })
  }

  // StorySuggestion model may not exist yet — log for now.
  // We'll add the Prisma model later.
  console.log('[Suggestion]', { topic, description, email })

  return Response.json({ success: true })
}
