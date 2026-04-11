import { prisma } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown'
  const { allowed } = checkRateLimit(`errors:${ip}`, 5, 60_000)
  if (!allowed) {
    return Response.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  let storyId: string | undefined
  let undercurrentReportId: string | undefined
  let errorType: string | undefined
  let description: string
  let submitterEmail: string | undefined

  try {
    const body = await request.json()
    storyId = body.storyId
    undercurrentReportId = body.undercurrentReportId
    errorType = body.errorType
    description = body.description
    submitterEmail = body.submitterEmail
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!description || typeof description !== 'string') {
    return Response.json({ error: 'Description is required' }, { status: 400 })
  }

  // ErrorFlag model may not exist yet — check schema
  // For now, log and return success
  console.log('[ErrorFlag]', { storyId, undercurrentReportId, errorType, description, submitterEmail })

  return Response.json({ success: true, message: 'Error flagged. Thank you for helping us be right.' })
}
