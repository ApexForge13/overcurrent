import Link from "next/link";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { CostDisplay } from "./CostDisplay";

interface StoryCardProps {
  story: {
    slug: string;
    headline: string;
    synopsis: string;
    confidenceLevel: string;
    sourceCount: number;
    countryCount: number;
    regionCount: number;
    consensusScore: number;
    totalCost: number;
    createdAt: string;
  };
}

export function StoryCard({ story }: StoryCardProps) {
  const date = new Date(story.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Link href={`/story/${story.slug}`} className="block group">
      <article className="bg-[#111111] border border-[#1e1e1e] rounded-lg p-5 transition-all duration-200 hover:border-[#333] hover:bg-[#141414]">
        <div className="flex items-start justify-between gap-3 mb-3">
          <ConfidenceBadge level={story.confidenceLevel} />
          <span className="text-xs text-[#737373]" style={{ fontFamily: "JetBrains Mono, monospace" }}>
            {date}
          </span>
        </div>

        <h3
          className="text-lg font-semibold text-[#e5e5e5] mb-2 group-hover:text-white transition-colors"
          style={{ fontFamily: "Playfair Display, serif" }}
        >
          {story.headline}
        </h3>

        <p
          className="text-sm text-[#a3a3a3] mb-4 line-clamp-2"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        >
          {story.synopsis}
        </p>

        <div className="flex items-center justify-between">
          <span
            className="text-xs text-[#737373]"
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            {story.sourceCount} sources &middot; {story.countryCount} countries &middot; {story.regionCount} regions
          </span>
          <CostDisplay cost={story.totalCost} />
        </div>
      </article>
    </Link>
  );
}
