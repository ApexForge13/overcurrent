import { prisma } from '@/lib/db'
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas'

const W = 1080
const H = 1080
const BG = '#0A0A0B'
const WHITE = '#FFFFFF'
const TEAL = '#2A9D8F'
const GRAY = '#9CA3AF'
const MUTED = '#6B7280'
const RED = '#EF4444'

type Ctx = SKRSContext2D

function drawSlideBase(ctx: Ctx, slideNum: number, totalSlides: number) {
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)

  // Overcurrent wordmark bottom-left
  ctx.fillStyle = TEAL
  ctx.font = '700 16px "Inter", sans-serif'
  ctx.fillText('OVERCURRENT', 40, H - 40)
  ctx.fillRect(40, H - 32, 130, 2)

  // Slide number bottom-right
  ctx.fillStyle = MUTED
  ctx.font = '400 14px "Inter", sans-serif'
  ctx.fillText(`${slideNum}/${totalSlides}`, W - 60, H - 40)
}

function wrapText(ctx: Ctx, text: string, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let currentLine = ''

  for (const word of words) {
    const test = currentLine ? `${currentLine} ${word}` : word
    const metrics = ctx.measureText(test)
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine)
      currentLine = word
    } else {
      currentLine = test
    }
  }
  if (currentLine) lines.push(currentLine)
  return lines
}

function drawSlide1(ctx: Ctx, headline: string) {
  drawSlideBase(ctx, 1, 5)

  // Teal accent line
  ctx.fillStyle = TEAL
  ctx.fillRect(W / 2 - 60, 380, 120, 3)

  // Hook text
  ctx.fillStyle = WHITE
  ctx.font = '700 48px "Inter", sans-serif'
  ctx.textAlign = 'center'

  const hookText = headline.length > 70 ? headline.substring(0, 67) + '...' : headline
  const lines = wrapText(ctx, hookText, W - 140)
  const startY = 440
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], W / 2, startY + i * 60)
  }
  ctx.textAlign = 'left'

  // Accent line below
  ctx.fillStyle = TEAL
  ctx.fillRect(W / 2 - 60, startY + lines.length * 60 + 20, 120, 3)
}

function drawSlide2(ctx: Ctx, framings: Array<{ region: string; framing: string }>) {
  drawSlideBase(ctx, 2, 5)

  ctx.fillStyle = TEAL
  ctx.font = '700 14px "Inter", sans-serif'
  ctx.fillText('HOW EACH REGION FRAMED IT', 60, 80)

  const maxRows = Math.min(framings.length, 5)
  const rowH = Math.floor((H - 200) / Math.max(maxRows, 1))

  for (let i = 0; i < maxRows; i++) {
    const f = framings[i]
    const y = 130 + i * rowH

    // Teal dot
    ctx.fillStyle = TEAL
    ctx.beginPath()
    ctx.arc(72, y + 8, 5, 0, Math.PI * 2)
    ctx.fill()

    // Region name
    ctx.fillStyle = WHITE
    ctx.font = '700 26px "Inter", sans-serif'
    ctx.fillText(f.region, 92, y + 16)

    // Framing quote
    ctx.fillStyle = GRAY
    ctx.font = 'italic 20px "Inter", sans-serif'
    const lines = wrapText(ctx, `"${f.framing}"`, W - 160)
    for (let l = 0; l < Math.min(lines.length, 3); l++) {
      ctx.fillText(lines[l], 92, y + 48 + l * 26)
    }
  }
}

function drawSlide3(ctx: Ctx, buried: Array<{ fact: string; reportedBy: string }>) {
  drawSlideBase(ctx, 3, 5)

  ctx.fillStyle = TEAL
  ctx.font = '700 14px "Inter", sans-serif'
  ctx.fillText('REPORTED BUT BURIED', 60, 80)

  const maxItems = Math.min(buried.length, 3)
  const itemH = Math.floor((H - 200) / Math.max(maxItems, 1))

  for (let i = 0; i < maxItems; i++) {
    const b = buried[i]
    const y = 130 + i * itemH

    // Red vertical line
    ctx.fillStyle = RED
    ctx.fillRect(50, y, 3, itemH - 30)

    // Fact
    ctx.fillStyle = WHITE
    ctx.font = '700 22px "Inter", sans-serif'
    const factLines = wrapText(ctx, b.fact, W - 140)
    for (let l = 0; l < Math.min(factLines.length, 4); l++) {
      ctx.fillText(factLines[l], 72, y + 28 + l * 30)
    }

    // Attribution
    ctx.fillStyle = GRAY
    ctx.font = '400 16px "Inter", sans-serif'
    ctx.fillText(b.reportedBy.substring(0, 80), 72, y + 28 + Math.min(factLines.length, 4) * 30 + 16)
  }
}

function drawSlide4(ctx: Ctx, disc: { issue: string; sideA: string; sideB: string; sourcesA: string; sourcesB: string }) {
  drawSlideBase(ctx, 4, 5)

  ctx.fillStyle = TEAL
  ctx.font = '700 14px "Inter", sans-serif'
  ctx.fillText('KEY DISCREPANCY', 60, 80)

  // Issue
  ctx.fillStyle = WHITE
  ctx.font = '700 26px "Inter", sans-serif'
  const issueLines = wrapText(ctx, disc.issue, W - 120)
  for (let l = 0; l < Math.min(issueLines.length, 2); l++) {
    ctx.fillText(issueLines[l], 60, 130 + l * 34)
  }

  const colW = (W - 140) / 2
  const colY = 230

  // Side A
  ctx.fillStyle = TEAL
  ctx.font = '700 16px "Inter", sans-serif'
  ctx.fillText('SIDE A', 60, colY)
  ctx.fillStyle = WHITE
  ctx.font = '400 20px "Inter", sans-serif'
  const aLines = wrapText(ctx, disc.sideA, colW - 20)
  for (let l = 0; l < Math.min(aLines.length, 8); l++) {
    ctx.fillText(aLines[l], 60, colY + 30 + l * 26)
  }
  ctx.fillStyle = MUTED
  ctx.font = '400 14px "Inter", sans-serif'
  ctx.fillText(disc.sourcesA.substring(0, 45), 60, colY + 30 + Math.min(aLines.length, 8) * 26 + 16)

  // Divider
  ctx.fillStyle = MUTED
  ctx.fillRect(W / 2, colY - 10, 1, 500)

  // Side B
  const rightX = W / 2 + 20
  ctx.fillStyle = RED
  ctx.font = '700 16px "Inter", sans-serif'
  ctx.fillText('SIDE B', rightX, colY)
  ctx.fillStyle = WHITE
  ctx.font = '400 20px "Inter", sans-serif'
  const bLines = wrapText(ctx, disc.sideB, colW - 20)
  for (let l = 0; l < Math.min(bLines.length, 8); l++) {
    ctx.fillText(bLines[l], rightX, colY + 30 + l * 26)
  }
  ctx.fillStyle = MUTED
  ctx.font = '400 14px "Inter", sans-serif'
  ctx.fillText(disc.sourcesB.substring(0, 45), rightX, colY + 30 + Math.min(bLines.length, 8) * 26 + 16)
}

function drawSlide5(ctx: Ctx, sourceCount: number, countryCount: number, regionCount: number) {
  drawSlideBase(ctx, 5, 5)

  ctx.textAlign = 'center'

  ctx.fillStyle = WHITE
  ctx.font = '700 36px "Inter", sans-serif'
  ctx.fillText('Every outlet shows you', W / 2, 380)
  ctx.fillText('their version.', W / 2, 426)

  ctx.fillStyle = TEAL
  ctx.font = '700 36px "Inter", sans-serif'
  ctx.fillText('We show you everyone\'s.', W / 2, 500)

  ctx.fillStyle = TEAL
  ctx.font = '400 24px "Inter", sans-serif'
  ctx.fillText('overcurrent.news', W / 2, 580)

  ctx.fillStyle = GRAY
  ctx.font = '400 18px "Inter", sans-serif'
  ctx.fillText(`${sourceCount} sources \u00B7 ${countryCount} countries \u00B7 ${regionCount} regions`, W / 2, 640)

  ctx.textAlign = 'left'
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const story = await prisma.story.findUnique({
    where: { id },
    include: {
      discrepancies: true,
      framings: true,
      sources: true,
    },
  })

  if (!story) {
    return Response.json({ error: 'Story not found' }, { status: 404 })
  }

  // Parse buried evidence
  let buriedEvidence: Array<{ fact: string; reportedBy: string; notPickedUpBy: string[] }> = []
  try {
    const parsed = JSON.parse(story.confidenceNote || '{}')
    buriedEvidence = parsed.buriedEvidence ?? []
  } catch { /* skip */ }

  const countries = new Set(story.sources.map(s => s.country))
  const regions = new Set(story.sources.map(s => s.region))
  const slides: Buffer[] = []

  // Slide 1: Hook
  const c1 = createCanvas(W, H)
  drawSlide1(c1.getContext('2d'), story.headline)
  slides.push(c1.toBuffer('image/png'))

  // Slide 2: Framing
  const c2 = createCanvas(W, H)
  drawSlide2(c2.getContext('2d'), story.framings.map(f => ({ region: f.region, framing: f.framing })))
  slides.push(c2.toBuffer('image/png'))

  // Slide 3: Buried evidence
  const c3 = createCanvas(W, H)
  drawSlide3(c3.getContext('2d'), buriedEvidence.slice(0, 3).map(b => ({
    fact: b.fact,
    reportedBy: `Reported by: ${b.reportedBy} — not picked up by ${b.notPickedUpBy?.length ?? 0} other outlets`,
  })))
  slides.push(c3.toBuffer('image/png'))

  // Slide 4: Discrepancy
  const c4 = createCanvas(W, H)
  if (story.discrepancies[0]) {
    const d = story.discrepancies[0]
    drawSlide4(c4.getContext('2d'), { issue: d.issue, sideA: d.sideA, sideB: d.sideB, sourcesA: d.sourcesA, sourcesB: d.sourcesB })
  } else {
    drawSlideBase(c4.getContext('2d'), 4, 5)
  }
  slides.push(c4.toBuffer('image/png'))

  // Slide 5: CTA
  const c5 = createCanvas(W, H)
  drawSlide5(c5.getContext('2d'), story.sources.length, countries.size, regions.size)
  slides.push(c5.toBuffer('image/png'))

  return Response.json({
    success: true,
    slides: slides.map((buf, i) => ({
      slide: i + 1,
      filename: `slide-${i + 1}.png`,
      dataUrl: `data:image/png;base64,${buf.toString('base64')}`,
    })),
    headline: story.headline,
  })
}
