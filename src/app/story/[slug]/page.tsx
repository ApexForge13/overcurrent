import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { StoryDetail } from "@/components/StoryDetail";
import { ReAnalyzeButton } from "@/components/ReAnalyzeButton";
import { StoryPaywallWrapper } from "@/components/StoryPaywallWrapper";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  const story = await prisma.story.findUnique({
    where: { slug },
    select: {
      headline: true,
      synopsis: true,
      confidenceLevel: true,
      sourceCount: true,
      countryCount: true,
      primaryCategory: true,
    },
  });

  if (!story) return { title: "Story Not Found — OVERCURRENT" };

  const description =
    story.synopsis?.replace(/<[^>]*>/g, "").substring(0, 160) ||
    "Coverage analysis by Overcurrent";

  return {
    title: `${story.headline} — OVERCURRENT`,
    description,
    keywords: [
      story.primaryCategory || "",
      "news analysis",
      "overcurrent",
      "media coverage",
      "fact checking",
    ].filter(Boolean),
    openGraph: {
      title: story.headline,
      description,
      type: "article",
      siteName: "OVERCURRENT",
      url: `https://overcurrent.news/story/${slug}`,
      images: [
        {
          url: `https://overcurrent.news/api/og?headline=${encodeURIComponent(story.headline)}&confidence=${story.confidenceLevel}&sources=${story.sourceCount}&countries=${story.countryCount}`,
          width: 1200,
          height: 630,
          alt: story.headline,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: story.headline,
      description,
      images: [
        `https://overcurrent.news/api/og?headline=${encodeURIComponent(story.headline)}&confidence=${story.confidenceLevel}&sources=${story.sourceCount}&countries=${story.countryCount}`,
      ],
    },
  };
}

export default async function StoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const story = await prisma.story.findUnique({
    where: { slug },
    include: {
      sources: true,
      claims: { orderBy: { sortOrder: "asc" } },
      discrepancies: true,
      omissions: true,
      framings: true,
      silences: true,
      followUps: { orderBy: { sortOrder: "asc" } },
      debateRounds: true,
      discourseGap: true,
      discourseSnapshots: { include: { posts: true } },
    },
  });

  if (!story) notFound();

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <a
          href="/"
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-secondary font-mono"
        >
          &larr; Back
        </a>
        {/* ReAnalyzeButton hidden from public — admin only via /admin */}
      </div>
      <StoryPaywallWrapper slug={slug}>
        <StoryDetail story={story} />
      </StoryPaywallWrapper>
    </div>
  );
}
