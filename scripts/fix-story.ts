import { Pool } from 'pg'

const pool = new Pool({
  connectionString: 'postgresql://postgres.fonvftqbkhfldhdzhgcl:BaxterH1313%21%21@aws-1-us-west-2.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false },
})

async function main() {
  const client = await pool.connect()
  try {
    // Find the latest Iran story
    const { rows: stories } = await client.query(`
      SELECT id, headline, "createdAt", "confidenceNote"
      FROM "Story"
      WHERE headline ILIKE '%iran%peace%'
      ORDER BY "createdAt" DESC
      LIMIT 2
    `)

    for (const s of stories) {
      console.log(`${s.id} | ${s.headline.substring(0, 70)} | ${s.createdAt}`)
    }

    if (stories.length === 0) {
      console.log('No stories found')
      return
    }

    const story = stories[0]
    console.log(`\nFixing story: ${story.id}`)

    // 1. Fix the date in propagation timeline
    const note = JSON.parse(story.confidenceNote || '{}')
    if (note.propagationTimeline) {
      for (const frame of note.propagationTimeline) {
        frame.label = 'Apr 13'
      }
      console.log(`Fixed timeline labels to "Apr 13" (${note.propagationTimeline.length} frames)`)
    }

    // Save updated confidenceNote
    await client.query(
      `UPDATE "Story" SET "confidenceNote" = $1 WHERE id = $2`,
      [JSON.stringify(note), story.id]
    )
    console.log('Saved updated confidenceNote')

    // 2. Remove false omissions about Pakistani/Middle Eastern coverage
    const { rows: omissions } = await client.query(
      `SELECT id, missing FROM "Omission" WHERE "storyId" = $1`,
      [story.id]
    )
    console.log(`\nFound ${omissions.length} omissions:`)

    const countryKeywords: Record<string, string[]> = {
      PK: ['pakistani', 'pakistan', 'islamabad'],
      ME: ['middle east', 'middle eastern'],
      IR: ['iranian', 'iran'],
      IL: ['israeli', 'israel'],
    }

    // Check which countries have sources
    const { rows: sources } = await client.query(
      `SELECT DISTINCT country, outlet FROM "Source" WHERE "storyId" = $1`,
      [story.id]
    )
    const sourceCountries = new Set(sources.map((s: { country: string }) => s.country))
    console.log(`Source countries: ${[...sourceCountries].join(', ')}`)

    const toDelete: string[] = []
    for (const o of omissions) {
      const lower = o.missing.toLowerCase()
      console.log(`  [${o.id}] ${o.missing.substring(0, 80)}`)

      for (const [code, keywords] of Object.entries(countryKeywords)) {
        if (keywords.some(kw => lower.includes(kw))) {
          // Check if we have sources from this country/region
          const hasSources = code === 'ME'
            ? [...sourceCountries].some(c => ['QA', 'SA', 'AE', 'EG', 'IL', 'TR', 'IR'].includes(c))
            : sourceCountries.has(code)

          if (hasSources) {
            console.log(`    → REMOVING (we have ${code} sources)`)
            toDelete.push(o.id)
          }
        }
      }
    }

    if (toDelete.length > 0) {
      await client.query(
        `DELETE FROM "Omission" WHERE id = ANY($1)`,
        [toDelete]
      )
      console.log(`\nDeleted ${toDelete.length} false omissions`)
    }

    // 3. Remove follow-up questions about "zero coverage" from countries we have
    const { rows: followups } = await client.query(
      `SELECT id, question FROM "FollowUpQuestion" WHERE "storyId" = $1`,
      [story.id]
    )
    console.log(`\nFound ${followups.length} follow-up questions:`)

    const fuToDelete: string[] = []
    for (const q of followups) {
      const lower = q.question.toLowerCase()
      console.log(`  [${q.id}] ${q.question.substring(0, 80)}`)

      if (/\b(zero|no |why is there|absence|silent)\b/.test(lower)) {
        for (const [code, keywords] of Object.entries(countryKeywords)) {
          if (keywords.some(kw => lower.includes(kw))) {
            const hasSources = code === 'ME'
              ? [...sourceCountries].some(c => ['QA', 'SA', 'AE', 'EG', 'IL', 'TR', 'IR'].includes(c))
              : sourceCountries.has(code)
            if (hasSources) {
              console.log(`    → REMOVING`)
              fuToDelete.push(q.id)
            }
          }
        }
      }
    }

    if (fuToDelete.length > 0) {
      await client.query(
        `DELETE FROM "FollowUpQuestion" WHERE id = ANY($1)`,
        [fuToDelete]
      )
      console.log(`\nDeleted ${fuToDelete.length} false follow-up questions`)
    }

    console.log('\nDone!')
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(console.error)
