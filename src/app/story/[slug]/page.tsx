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

  // Fetch other published stories for "More Analyses"
  const moreStories = await prisma.story.findMany({
    where: {
      status: "published",
      slug: { not: slug },
    },
    select: {
      slug: true,
      headline: true,
      primaryCategory: true,
      sourceCount: true,
      countryCount: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 4,
  });

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
        <StoryDetail story={JSON.parse(JSON.stringify(story))} />
      </StoryPaywallWrapper>

      {/* More Analyses */}
      {moreStories.length > 0 && (
        <div style={{ marginTop: "64px", borderTop: "1px solid var(--border-primary)", paddingTop: "32px" }}>
          <h2 style={{
            fontFamily: "var(--font-display)",
            fontSize: "24px",
            fontWeight: 700,
            color: "var(--text-primary)",
            marginBottom: "24px",
          }}>
            More Analyses
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {moreStories.map((s) => (
              <a
                key={s.slug}
                href={`/story/${s.slug}`}
                style={{
                  display: "block",
                  padding: "20px",
                  border: "1px solid var(--border-primary)",
                  textDecoration: "none",
                  transition: "border-color 0.2s",
                }}
                className="hover:border-[var(--text-tertiary)]"
              >
                {s.primaryCategory && (
                  <span style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "9px",
                    fontWeight: 600,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "var(--accent-green)",
                  }}>
                    {s.primaryCategory.replace(/_/g, " ")}
                  </span>
                )}
                <h3 style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "16px",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  lineHeight: 1.3,
                  marginTop: s.primaryCategory ? "6px" : "0",
                }}>
                  {s.headline}
                </h3>
                <p style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  color: "var(--text-tertiary)",
                  marginTop: "8px",
                }}>
                  {s.sourceCount} sources · {s.countryCount} countries
                </p>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
