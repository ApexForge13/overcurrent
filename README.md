# OVERCURRENT

**Global News Verification & Coverage Displacement Detection**

*See what's under the surface.*

---

## What It Does

**VERIFY MODE** — Enter any news story. Overcurrent searches across 6 world regions, cross-references sources using an AI agent hierarchy, and produces a fully sourced verification report with confidence scoring, discrepancy detection, omission tracking, framing analysis, and regional silence mapping.

**UNDERCURRENT MODE** — Enter the dominant story everyone's talking about. Overcurrent analyzes what happened *under* the noise: coverage displacement, quiet government/corporate actions, and timing anomalies.

Overcurrent does NOT claim conspiracy. It documents coverage patterns and lets the data speak for itself.

---

## Quick Start

```bash
npm install
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
npx prisma migrate dev
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, TypeScript) |
| Database | SQLite via Prisma ORM |
| AI | Anthropic Claude (Haiku for triage, Sonnet for analysis) |
| News Data | GDELT DOC 2.0 API, RSS feeds, Reddit |
| Gov Data | Congress.gov API, Federal Register API |
| Styling | Tailwind CSS (dark editorial theme) |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | SQLite path (default: `file:./dev.db`) |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `DAILY_COST_CAP` | No | Max daily spend in USD (default: 15) |
| `CONGRESS_API_KEY` | No | Congress.gov API key (optional) |

## Cost

- Haiku triage: ~$0.01/call
- Sonnet analysis: ~$0.10-0.30/call
- Typical verify: ~$0.50-1.50
- Typical undercurrent: ~$1.50-3.00
- Cost dashboard at `/costs`
