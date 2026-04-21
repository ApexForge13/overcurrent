import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { featureFlags } from "@/lib/feature-flags";
import { UndercurrentReport } from "@/components/UndercurrentReport";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  const report = await prisma.undercurrentReport.findUnique({
    where: { slug },
    select: {
      dominantHeadline: true,
      synopsis: true,
    },
  });

  if (!report) return { title: "Report Not Found — OVERCURRENT" };

  const description =
    report.synopsis?.replace(/<[^>]*>/g, "").substring(0, 160) ||
    "Undercurrent analysis by Overcurrent";

  const title = `While everyone watched ${report.dominantHeadline}... — OVERCURRENT`;

  return {
    title,
    description,
    keywords: [
      "undercurrent",
      "media distraction",
      "overcurrent",
      "news analysis",
      "displaced stories",
    ],
    openGraph: {
      title,
      description,
      type: "article",
      siteName: "OVERCURRENT",
      url: `https://overcurrent.news/undercurrent/${slug}`,
      images: [
        {
          url: `https://overcurrent.news/api/og?headline=${encodeURIComponent(`While everyone watched ${report.dominantHeadline}...`)}&confidence=DEVELOPING&sources=0&countries=0`,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [
        `https://overcurrent.news/api/og?headline=${encodeURIComponent(`While everyone watched ${report.dominantHeadline}...`)}&confidence=DEVELOPING&sources=0&countries=0`,
      ],
    },
  };
}

export default async function UndercurrentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  if (!featureFlags.DISCOURSE_LAYER_ENABLED) notFound();
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
