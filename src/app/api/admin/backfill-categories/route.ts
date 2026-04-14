import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth-guard'

function guessCategory(headline: string, synopsis: string): string {
  const text = (headline + ' ' + synopsis).toLowerCase()

  if (text.match(/war|military|strike|bomb|shoot|missile|attack|ceasefire|conflict|defense|troops|killed/)) return 'conflict'
  if (text.match(/tariff|trade|import|export|sanction|embargo/)) return 'trade'
  if (text.match(/election|vote|president|congress|senate|parliament|legislation|democrat|republican|governor/)) return 'politics'
  if (text.match(/stock|market|gdp|inflation|recession|bank|fed|interest rate|economy|fiscal/)) return 'economy'
  if (text.match(/ai\b|artificial intelligence|tech|software|cyber|data|algorithm|robot|automation/)) return 'tech'
  if (text.match(/wage|worker|union|labor|strike|employment|job|workplace|minimum wage|layoff/)) return 'labor'
  if (text.match(/climate|carbon|emission|renewable|solar|wind|fossil|temperature|warming/)) return 'climate'
  if (text.match(/health|vaccine|disease|hospital|doctor|pandemic|drug|medical|cancer/)) return 'health'
  if (text.match(/fire|arson|warehouse|building/)) return 'society'

  return 'society' // default
}

export async function POST() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const stories = await prisma.story.findMany({
    where: { primaryCategory: null },
    select: { id: true, headline: true, synopsis: true },
  })

  let updated = 0
  for (const story of stories) {
    const category = guessCategory(story.headline, story.synopsis)
    await prisma.story.update({
      where: { id: story.id },
      data: { primaryCategory: category },
    })
    updated++
  }

  return Response.json({ updated, total: stories.length })
}
