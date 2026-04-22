import 'dotenv/config'
import { prisma } from '../src/lib/db'

async function main() {
  const byCategory = await prisma.trackedEntity.groupBy({
    by: ['category'],
    _count: { _all: true },
    orderBy: { category: 'asc' },
  })
  console.log('── Category breakdown ──')
  console.table(byCategory.map((r) => ({ category: r.category, count: r._count._all })))

  const total = byCategory.reduce((acc, r) => acc + r._count._all, 0)
  console.log(`Total: ${total}`)

  // USD/SGD present?
  const sgd = await prisma.trackedEntity.findUnique({
    where: { identifier: 'USD/SGD' },
    select: { identifier: true, name: true, category: true, subcategory: true },
  })
  console.log('── USD/SGD ──')
  console.log(sgd ?? '(not found)')

  // Treasury futures category
  const treasuries = await prisma.trackedEntity.findMany({
    where: { identifier: { in: ['ZB=F', 'ZN=F', 'ZT=F', 'ZF=F'] } },
    select: { identifier: true, category: true, subcategory: true },
    orderBy: { identifier: 'asc' },
  })
  console.log('── Treasury futures ──')
  console.table(treasuries)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err)
    await prisma.$disconnect()
    process.exit(1)
  })
