/**
 * Local pipeline runner — runs the full analysis from your terminal.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/run-pipeline.ts "Iran Strait of Hormuz blockade"
 *
 * All progress + errors print to stdout in real-time so you can
 * watch each phase, debug hangs, and see exactly where it crashes.
 */

import * as dotenv from 'dotenv'
dotenv.config({ override: true })

async function main() {
  // Parse --force-full-quality flag (per-run override for the cost-optimization
  // layer). Strip it from argv so the remaining args still join cleanly into
  // the query. Spec: docs/plans/2026-04-19-cost-optimization-layer.md.
  const argv = process.argv.slice(2)
  const forceFullQualityIdx = argv.findIndex((a) => a === '--force-full-quality' || a === '--force-full')
  const forceFullQuality = forceFullQualityIdx >= 0
  if (forceFullQuality) argv.splice(forceFullQualityIdx, 1)

  const query = argv.join(' ').trim()
  if (!query) {
    console.error('Usage: npx tsx --tsconfig tsconfig.json scripts/run-pipeline.ts [--force-full-quality] "your query here"')
    process.exit(1)
  }

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  OVERCURRENT LOCAL PIPELINE`)
  console.log(`  Query: ${query}`)
  console.log(`  Time:  ${new Date().toISOString()}`)
  if (forceFullQuality) console.log(`  Mode:  --force-full-quality (cost-optimization flags bypassed)`)
  console.log(`${'═'.repeat(60)}\n`)

  // Check env vars
  const required = ['DATABASE_URL', 'ANTHROPIC_API_KEY']
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`  ✗ Missing env var: ${key}`)
      process.exit(1)
    }
    console.log(`  ✓ ${key}`)
  }
  const optional = ['OPENAI_API_KEY', 'GOOGLE_AI_API_KEY', 'XAI_API_KEY', 'TWITTER_BEARER_TOKEN']
  for (const key of optional) {
    console.log(`  ${process.env[key] ? '✓' : '✗'} ${key}`)
  }
  console.log('')

  const { runVerifyPipeline } = await import('@/lib/pipeline')

  const startTime = Date.now()
  let lastPhase = ''

  try {
    const slug = await runVerifyPipeline(query, (event: string, data: unknown) => {
      const d = data as Record<string, unknown>
      const phase = String(d.phase || event)
      const message = String(d.message || '')
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

      if (phase !== lastPhase) {
        console.log(`\n── ${phase.toUpperCase()} ${'─'.repeat(40)} [${elapsed}s]`)
        lastPhase = phase
      }

      if (message) {
        console.log(`  ${message}`)
      }

      if (phase === 'complete') {
        console.log(`\n${'═'.repeat(60)}`)
        console.log(`  ✓ COMPLETE`)
        console.log(`  Slug: ${d.slug}`)
        console.log(`  Story ID: ${d.storyId}`)
        console.log(`  Total time: ${elapsed}s`)
        console.log(`${'═'.repeat(60)}\n`)
      }

      if (phase === 'error') {
        console.error(`\n  ✗ ERROR: ${message}`)
      }
    }, { forceFullQuality })

    console.log(`\nStory saved with slug: ${slug}`)
    console.log(`View at: https://overcurrent.news/story/${slug}`)
    console.log(`Admin review at: https://overcurrent.news/admin`)
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.error(`\n${'═'.repeat(60)}`)
    console.error(`  ✗ PIPELINE CRASHED after ${elapsed}s`)
    console.error(`  Last phase: ${lastPhase}`)
    console.error(`  Error: ${err instanceof Error ? err.message : err}`)
    if (err instanceof Error && err.stack) {
      console.error(`\n  Stack trace:`)
      for (const line of err.stack.split('\n').slice(0, 15)) {
        console.error(`    ${line}`)
      }
    }
    console.error(`${'═'.repeat(60)}\n`)
    process.exit(1)
  }

  process.exit(0)
}

main()
