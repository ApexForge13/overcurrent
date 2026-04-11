import { prisma } from '@/lib/db'

export async function GET() {
  const [active, total] = await Promise.all([
    prisma.subscriber.count({ where: { status: 'active' } }),
    prisma.subscriber.count(),
  ])

  return Response.json({ active, total })
}
