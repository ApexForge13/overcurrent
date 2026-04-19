import { prisma } from '@/lib/db'
import { getDailyCost, getTotalCost } from '@/lib/anthropic'
import { requireAdmin } from '@/lib/auth-guard'

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const [dailyCost, totalCost, costLogs] = await Promise.all([
    getDailyCost(),
    getTotalCost(),
    prisma.costLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100, // raised from 50 so Provider Summary has a fuller picture
    }),
  ])

  const dailyCap = parseFloat(process.env.DAILY_COST_CAP ?? '15')

  return Response.json({
    dailyCost,
    totalCost,
    dailyCap,
    totalBudget: 200,
    costLogs,
  })
}
