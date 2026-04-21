import express from 'express'
import cors from 'cors'

const app = express()
const PORT = process.env.PORT || 3001

// CORS — only allow requests from our domains
app.use(cors({
  origin: [
    'https://overcurrent.news',
    'https://www.overcurrent.news',
    'https://overcurrent.vercel.app',
    'http://localhost:3000',
  ],
  methods: ['POST', 'GET'],
  credentials: true,
}))

app.use(express.json())

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'overcurrent-pipeline', timestamp: new Date().toISOString() })
})

// Verify analysis endpoint
app.post('/analyze', async (req, res) => {
  const {
    query,
    // ── Story arc system fields (Step 2) — all optional ──
    umbrellaArcId,
    analysisType,
    arcLabel,
    arcImportance,
    arcPhaseAtCreation,
    arcRerunTargetStoryId,
  } = req.body

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Missing required field: query' })
  }

  // ── Feature-flag gate (v2 pivot) ──
  // Belt-and-suspenders gate in front of the SSE stream so operators pinging
  // the Express service directly see 503 rather than an opening 200 stream
  // that immediately errors. The orchestrator gate inside runVerifyPipeline
  // is the source of truth.
  if (process.env.FEATURE_DEBATE_PIPELINE !== 'true') {
    return res.status(503).json({
      error: 'Debate pipeline disabled',
      detail: 'FEATURE_DEBATE_PIPELINE !== "true". Legacy surface archived for the v2 pivot to Gap Score.',
    })
  }

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const send = (event: string, data: unknown) => {
    try {
      res.write(`data: ${JSON.stringify({ event, ...(data as object) })}\n\n`)
    } catch {
      // client disconnected
    }
  }

  // Keepalive ping
  const keepalive = setInterval(() => {
    try {
      res.write(`: keepalive\n\n`)
    } catch {
      clearInterval(keepalive)
    }
  }, 10_000)

  try {
    // Dynamic import to avoid module initialization issues
    const { runVerifyPipeline } = await import('../src/lib/pipeline')
    await runVerifyPipeline(query, send, {
      umbrellaArcId: typeof umbrellaArcId === 'string' ? umbrellaArcId : null,
      analysisType: typeof analysisType === 'string' ? analysisType : null,
      arcLabel: typeof arcLabel === 'string' ? arcLabel : null,
      arcImportance: typeof arcImportance === 'string' ? arcImportance : null,
      arcPhaseAtCreation: typeof arcPhaseAtCreation === 'string' ? arcPhaseAtCreation : null,
      arcRerunTargetStoryId: typeof arcRerunTargetStoryId === 'string' ? arcRerunTargetStoryId : null,
    })
  } catch (error) {
    console.error('Analysis error:', error)
    send('error', {
      phase: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    clearInterval(keepalive)
    res.end()
  }
})

// Undercurrent analysis endpoint
app.post('/undercurrent', async (req, res) => {
  const { query, startDate, endDate } = req.body

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Missing required field: query' })
  }

  // ── Feature-flag gate (v2 pivot) ──
  // Matches the /analyze gate: return 503 before opening the SSE stream when
  // the undercurrent pipeline is archived.
  if (process.env.FEATURE_DISCOURSE !== 'true') {
    return res.status(503).json({
      error: 'Undercurrent pipeline disabled',
      detail: 'FEATURE_DISCOURSE !== "true". Legacy surface archived for the v2 pivot to Gap Score.',
    })
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const send = (event: string, data: unknown) => {
    try {
      res.write(`data: ${JSON.stringify({ event, ...(data as object) })}\n\n`)
    } catch { /* client disconnected */ }
  }

  const keepalive = setInterval(() => {
    try { res.write(`: keepalive\n\n`) } catch { clearInterval(keepalive) }
  }, 10_000)

  try {
    const { runUndercurrentPipeline } = await import('../src/lib/undercurrent-pipeline')
    await runUndercurrentPipeline(query, startDate, endDate, send)
  } catch (error) {
    console.error('Undercurrent error:', error)
    send('error', { phase: 'error', message: error instanceof Error ? error.message : 'Unknown error' })
  } finally {
    clearInterval(keepalive)
    res.end()
  }
})

app.listen(PORT, () => {
  console.log(`Overcurrent Pipeline Service running on port ${PORT}`)
})
