import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { StoryDetail } from "@/components/StoryDetail";
import { ReAnalyzeButton } from "@/components/ReAnalyzeButton";

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
        <ReAnalyzeButton query={story.searchQuery} storySlug={story.slug} />
      </div>
      <StoryDetail story={story} />
    </div>
  );
}
