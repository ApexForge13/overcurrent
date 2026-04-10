export const maxDuration = 60

export async function POST(request: Request) {
  let query: string

  try {
    const body = await request.json()
    query = body.query
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
        const { runVerifyPipeline } = await import('@/lib/pipeline')
        await runVerifyPipeline(query, send)
      } catch (error) {
        console.error('Analyze error:', error)
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
