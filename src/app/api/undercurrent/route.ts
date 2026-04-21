import { requireAdmin } from '@/lib/auth-guard'
import { featureFlags } from '@/lib/feature-flags'

export const maxDuration = 300

export async function POST(request: Request) {
  if (!featureFlags.DISCOURSE_LAYER_ENABLED) return Response.json({ error: 'Not Found' }, { status: 404 })
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  let query: string
  let startDate: string | undefined
  let endDate: string | undefined

  try {
    const body = await request.json()
    query = body.query
    startDate = body.startDate
    endDate = body.endDate
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!query || typeof query !== 'string') {
    return Response.json({ error: 'Missing required field: query' }, { status: 400 })
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ event, ...(data as object) })}\n\n`),
          )
        } catch {
          // controller may be closed
        }
      }

      // Send keepalive pings every 10s to prevent timeout
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`))
        } catch {
          clearInterval(keepalive)
        }
      }, 10_000)

      try {
        const { runUndercurrentPipeline } = await import('@/lib/undercurrent-pipeline')
        await runUndercurrentPipeline(query, startDate, endDate, send)
      } catch (error) {
        console.error('Undercurrent error:', error)
        send('error', {
          phase: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        })
      } finally {
        clearInterval(keepalive)
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
