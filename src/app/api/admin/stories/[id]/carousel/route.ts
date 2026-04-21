import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth-guard'
import { featureFlags } from '@/lib/feature-flags'

const W = 1080
const H = 1080
const BG = '#0A0A0B'
const WHITE = '#FFFFFF'
const TEAL = '#2A9D8F'
const GRAY = '#9CA3AF'
const MUTED = '#6B7280'
const RED = '#EF4444'
const AMBER = '#F59E0B'

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function wrapSvgText(text: string, maxChars: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const w of words) {
    if ((current + ' ' + w).trim().length > maxChars && current) {
      lines.push(current.trim())
      current = w
    } else {
      current = current ? current + ' ' + w : w
    }
  }
  if (current) lines.push(current.trim())
  return lines
}

function slideBase(slideNum: number, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  ${inner}
  <text x="40" y="${H - 40}" fill="${TEAL}" font-family="Inter, Helvetica Neue, sans-serif" font-size="16" font-weight="700">OVERCURRENT</text>
  <rect x="40" y="${H - 32}" width="130" height="2" fill="${TEAL}"/>
  <text x="${W - 60}" y="${H - 40}" fill="${MUTED}" font-family="Inter, sans-serif" font-size="14">${slideNum}/5</text>
</svg>`
}

function slide1(headline: string): string {
  const hook = headline.length > 70 ? headline.substring(0, 67) + '...' : headline
  const lines = wrapSvgText(hook, 30)
  const startY = 440 - (lines.length * 30)
  const textLines = lines.map((l, i) =>
    `<text x="${W / 2}" y="${startY + i * 64}" fill="${WHITE}" font-family="Inter, sans-serif" font-size="48" font-weight="700" text-anchor="middle">${escapeXml(l)}</text>`
  ).join('\n  ')

  return slideBase(1, `
  <rect x="${W / 2 - 60}" y="${startY - 40}" width="120" height="3" fill="${TEAL}"/>
  ${textLines}
  <rect x="${W / 2 - 60}" y="${startY + lines.length * 64 + 10}" width="120" height="3" fill="${TEAL}"/>
  `)
}

function slide2(framings: Array<{ region: string; framing: string }>): string {
  const rows = framings.slice(0, 5)
  const rowH = 150
  const items = rows.map((f, i) => {
    const y = 130 + i * rowH
    const quote = f.framing.length > 55 ? f.framing.substring(0, 52) + '...' : f.framing
    return `
    <circle cx="72" cy="${y + 8}" r="5" fill="${TEAL}"/>
    <text x="92" y="${y + 16}" fill="${WHITE}" font-family="Inter, sans-serif" font-size="26" font-weight="700">${escapeXml(f.region)}</text>
    <text x="92" y="${y + 48}" fill="${GRAY}" font-family="Inter, sans-serif" font-size="20" font-style="italic">"${escapeXml(quote)}"</text>`
  }).join('')

  return slideBase(2, `
  <text x="60" y="80" fill="${TEAL}" font-family="Inter, sans-serif" font-size="14" font-weight="700" letter-spacing="2">HOW EACH REGION FRAMED IT</text>
  ${items}
  `)
}

function slide3(buried: Array<{ fact: string; reportedBy: string }>): string {
  const items = buried.slice(0, 3)
  const itemH = 250
  const rows = items.map((b, i) => {
    const y = 130 + i * itemH
    const fact = b.fact.length > 70 ? b.fact.substring(0, 67) + '...' : b.fact
    const lines = wrapSvgText(fact, 45)
    const textLines = lines.slice(0, 3).map((l, li) =>
      `<text x="72" y="${y + 28 + li * 30}" fill="${WHITE}" font-family="Inter, sans-serif" font-size="22" font-weight="700">${escapeXml(l)}</text>`
    ).join('')
    const attrY = y + 28 + Math.min(lines.length, 3) * 30 + 20
    const attr = b.reportedBy.length > 70 ? b.reportedBy.substring(0, 67) + '...' : b.reportedBy
    return `
    <rect x="50" y="${y}" width="3" height="${itemH - 40}" fill="${RED}"/>
    ${textLines}
    <text x="72" y="${attrY}" fill="${GRAY}" font-family="Inter, sans-serif" font-size="16">${escapeXml(attr)}</text>`
  }).join('')

  return slideBase(3, `
  <text x="60" y="80" fill="${TEAL}" font-family="Inter, sans-serif" font-size="14" font-weight="700" letter-spacing="2">REPORTED BUT BURIED</text>
  ${rows}
  `)
}

function slide4(disc: { issue: string; sideA: string; sideB: string; sourcesA: string; sourcesB: string }): string {
  const issueLines = wrapSvgText(disc.issue, 40)
  const issueText = issueLines.slice(0, 2).map((l, i) =>
    `<text x="60" y="${130 + i * 34}" fill="${WHITE}" font-family="Inter, sans-serif" font-size="26" font-weight="700">${escapeXml(l)}</text>`
  ).join('')

  const colY = 240
  const aLines = wrapSvgText(disc.sideA, 25).slice(0, 6)
  const bLines = wrapSvgText(disc.sideB, 25).slice(0, 6)
  const aText = aLines.map((l, i) => `<text x="60" y="${colY + 34 + i * 26}" fill="${WHITE}" font-family="Inter, sans-serif" font-size="20">${escapeXml(l)}</text>`).join('')
  const bText = bLines.map((l, i) => `<text x="${W / 2 + 20}" y="${colY + 34 + i * 26}" fill="${WHITE}" font-family="Inter, sans-serif" font-size="20">${escapeXml(l)}</text>`).join('')

  return slideBase(4, `
  <text x="60" y="80" fill="${TEAL}" font-family="Inter, sans-serif" font-size="14" font-weight="700" letter-spacing="2">KEY DISCREPANCY</text>
  ${issueText}
  <text x="60" y="${colY}" fill="${TEAL}" font-family="Inter, sans-serif" font-size="16" font-weight="700">SIDE A</text>
  ${aText}
  <text x="60" y="${colY + 34 + aLines.length * 26 + 20}" fill="${MUTED}" font-family="Inter, sans-serif" font-size="14">${escapeXml(disc.sourcesA.substring(0, 45))}</text>
  <rect x="${W / 2}" y="${colY - 10}" width="1" height="400" fill="${MUTED}"/>
  <text x="${W / 2 + 20}" y="${colY}" fill="${RED}" font-family="Inter, sans-serif" font-size="16" font-weight="700">SIDE B</text>
  ${bText}
  <text x="${W / 2 + 20}" y="${colY + 34 + bLines.length * 26 + 20}" fill="${MUTED}" font-family="Inter, sans-serif" font-size="14">${escapeXml(disc.sourcesB.substring(0, 45))}</text>
  `)
}

function slide5(sourceCount: number, countryCount: number, regionCount: number): string {
  return slideBase(5, `
  <text x="${W / 2}" y="380" fill="${WHITE}" font-family="Inter, sans-serif" font-size="36" font-weight="700" text-anchor="middle">Every outlet shows you</text>
  <text x="${W / 2}" y="426" fill="${WHITE}" font-family="Inter, sans-serif" font-size="36" font-weight="700" text-anchor="middle">their version.</text>
  <text x="${W / 2}" y="500" fill="${TEAL}" font-family="Inter, sans-serif" font-size="36" font-weight="700" text-anchor="middle">We show you everyone's.</text>
  <text x="${W / 2}" y="580" fill="${TEAL}" font-family="Inter, sans-serif" font-size="24" text-anchor="middle">overcurrent.news</text>
  <text x="${W / 2}" y="640" fill="${GRAY}" font-family="Inter, sans-serif" font-size="18" text-anchor="middle">${sourceCount} sources · ${countryCount} countries · ${regionCount} regions</text>
  `)
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!featureFlags.LEGACY_STORY_PAGES_ENABLED) return Response.json({ error: 'Not Found' }, { status: 404 })
  const auth = await requireAdmin()
  if (auth.error) return auth.error

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

  let buriedEvidence: Array<{ fact: string; reportedBy: string; notPickedUpBy: string[] }> = []
  try {
    const parsed = JSON.parse(story.confidenceNote || '{}')
    buriedEvidence = parsed.buriedEvidence ?? []
  } catch { /* skip */ }

  const countries = new Set(story.sources.map(s => s.country))
  const regions = new Set(story.sources.map(s => s.region))

  // Generate 5 SVG slides
  const svgs = [
    slide1(story.headline),
    slide2(story.framings.map(f => ({ region: f.region, framing: f.framing }))),
    slide3(buriedEvidence.slice(0, 3).map(b => ({
      fact: b.fact,
      reportedBy: `Reported by: ${b.reportedBy} — not picked up by ${b.notPickedUpBy?.length ?? 0} others`,
    }))),
    story.discrepancies[0]
      ? slide4({ issue: story.discrepancies[0].issue, sideA: story.discrepancies[0].sideA, sideB: story.discrepancies[0].sideB, sourcesA: story.discrepancies[0].sourcesA, sourcesB: story.discrepancies[0].sourcesB })
      : slideBase(4, `<text x="${W / 2}" y="${H / 2}" fill="${GRAY}" font-family="Inter, sans-serif" font-size="24" text-anchor="middle">No discrepancies found</text>`),
    slide5(story.sources.length, countries.size, regions.size),
  ]

  return Response.json({
    success: true,
    slides: svgs.map((svg, i) => ({
      slide: i + 1,
      filename: `slide-${i + 1}.svg`,
      // Return SVG as data URL for display + download
      dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
      svg,
    })),
    headline: story.headline,
  })
}
