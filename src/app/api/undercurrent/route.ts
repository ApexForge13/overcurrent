export const maxDuration = 60

export async function POST(request: Request) {
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
