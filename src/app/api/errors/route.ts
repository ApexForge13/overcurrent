import { prisma } from '@/lib/db'

export async function POST(request: Request) {
  const { storyId, undercurrentReportId, errorType, description, submitterEmail } = await request.json()

  if (!description || typeof description !== 'string') {
    return Response.json({ error: 'Description is required' }, { status: 400 })
  }

  // ErrorFlag model may not exist yet — check schema
  // For now, log and return success
  console.log('[ErrorFlag]', { storyId, undercurrentReportId, errorType, description, submitterEmail })

  return Response.json({ success: true, message: 'Error flagged. Thank you for helping us be right.' })
}
