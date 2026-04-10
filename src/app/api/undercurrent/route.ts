import { runUndercurrentPipeline } from '@/lib/undercurrent-pipeline'

export async function POST(request: Request) {
  const { query, startDate, endDate } = await request.json()

  if (!query || typeof query !== 'string') {
    return Response.json({ error: 'Missing required field: query' }, { status: 400 })
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ event, ...(data as object) })}\n\n`),
        )
      }

      try {
        const slug = await runUndercurrentPipeline(query, startDate, endDate, send)
        send('complete', { slug })
      } catch (error) {
        send('error', {
          message: error instanceof Error ? error.message : 'Unknown error',
        })
      } finally {
        controller.close()
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
