import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { StoryDetail } from "@/components/StoryDetail";

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
    },
  });

  if (!story) notFound();

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <a
        href="/"
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-secondary mb-6 font-mono"
      >
        &larr; Back
      </a>
      <StoryDetail story={story} />
    </div>
  );
}
