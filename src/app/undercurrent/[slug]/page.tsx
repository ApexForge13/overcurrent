import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { UndercurrentReport } from "@/components/UndercurrentReport";

export default async function UndercurrentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const report = await prisma.undercurrentReport.findUnique({
    where: { slug },
    include: {
      displacedStories: { orderBy: { sortOrder: "asc" } },
      quietActions: { orderBy: { sortOrder: "asc" } },
      timingAnomalies: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!report) notFound();

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <a
        href="/"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-secondary mb-6 font-mono"
      >
        &larr; Back
      </a>
      <UndercurrentReport report={report} />
    </div>
  );
}
