import { prisma } from '@/lib/db'
import { getDailyCost, getTotalCost } from '@/lib/anthropic'

export async function GET() {
  const [dailyCost, totalCost, costLogs] = await Promise.all([
    getDailyCost(),
    getTotalCost(),
    prisma.costLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
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
